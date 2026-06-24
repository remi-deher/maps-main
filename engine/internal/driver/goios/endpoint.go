package goios

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const (
	// tunnelInfoPort is go-ios's local tunnel-info HTTP API port. We pass it
	// explicitly to `ios tunnel start` (see tunnel.go) so the daemon and our
	// queries always agree on it instead of relying on the CLI default.
	tunnelInfoPort       = 28100
	defaultTunnelInfoURL = "http://127.0.0.1:28100"
)

// tunnelAPIClient is the short-timeout client used to poll go-ios's tunnel-info
// HTTP API. Reading GET /tunnels directly — instead of spawning `ios tunnel ls`
// every poll — avoids a process launch each time and is immune to CLI
// output-format drift between go-ios versions (the JSON shape of the API is
// stable). The old Electron build polled this same API; the v3 rewrite had
// regressed to shelling out, which is what this restores.
var tunnelAPIClient = &http.Client{Timeout: 3 * time.Second}

// tunnelEntry mirrors one element of go-ios's tunnel list (served at GET
// /tunnels and printed by `ios tunnel ls`), e.g.
// [{"address":"fdd7:...:1","rsdPort":65032,"udid":"...","userspaceTun":false}].
type tunnelEntry struct {
	Address      string `json:"address"`
	RsdPort      int    `json:"rsdPort"`
	UDID         string `json:"udid"`
	UserspaceTun bool   `json:"userspaceTun"`
}

func (d *Driver) tunnelsURL() string {
	base := d.tunnelInfoURL
	if base == "" {
		base = defaultTunnelInfoURL
	}
	return base + "/tunnels"
}

// fetchTunnels asks go-ios's tunnel-info HTTP API (GET /tunnels) for the live
// tunnel list. Returns ok=false if the API isn't reachable (daemon not up yet),
// so callers can fall back to the CLI.
func (d *Driver) fetchTunnels(ctx context.Context) ([]tunnelEntry, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.tunnelsURL(), nil)
	if err != nil {
		return nil, false
	}
	resp, err := tunnelAPIClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false
	}
	var entries []tunnelEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, false
	}
	return entries, true
}

// tunnels returns the live tunnel list, preferring the HTTP API and falling
// back to parsing `ios tunnel ls` stdout when the API can't be reached.
func (d *Driver) tunnels(ctx context.Context) []tunnelEntry {
	if entries, ok := d.fetchTunnels(ctx); ok {
		return entries
	}
	return d.tunnelsCLI(ctx)
}

// queryTunnel asks go-ios for the current device tunnel and returns the first
// entry with a usable RSD address+port, honoring the target UDID filter.
func (d *Driver) queryTunnel(ctx context.Context) (driver.TunnelEndpoint, bool) {
	for _, e := range d.tunnels(ctx) {
		if d.targetUDID != "" && e.UDID != d.targetUDID {
			continue
		}
		if endpoint, ok := driver.NewTunnelEndpoint(e.Address, e.RsdPort, e.UDID); ok {
			return endpoint, true
		}
	}
	return driver.TunnelEndpoint{}, false
}

// ListNetworkDevices returns every device go-ios currently has a tunnel for, not
// just the first usable one — go-ios discovers these on its own (USB or LAN),
// this just surfaces what it already found.
func (d *Driver) ListNetworkDevices(ctx context.Context) ([]driver.NetworkDevice, error) {
	var devices []driver.NetworkDevice
	for _, e := range d.tunnels(ctx) {
		if e.Address == "" || e.RsdPort <= 0 {
			continue
		}
		devices = append(devices, driver.NetworkDevice{UDID: e.UDID, Address: e.Address, Port: e.RsdPort})
	}
	return devices, nil
}

// tunnelsCLI is the legacy fallback used when the HTTP API can't be reached:
// run `ios tunnel ls` and parse its stdout.
func (d *Driver) tunnelsCLI(ctx context.Context) []tunnelEntry {
	bin, err := d.binPath()
	if err != nil {
		return nil
	}
	out, err := execCommandContext(ctx, bin, "tunnel", "ls").Output()
	if err != nil {
		return nil
	}
	return parseTunnelList(out)
}

// parseTunnelList decodes `ios tunnel ls` output. go-ios writes its slog lines
// to stderr and the JSON array to stdout, but PowerShell can also interleave
// NativeCommandError text and multiple arrays. Scan every array-shaped value
// and keep the first one that exposes a usable RSD address+port.
func parseTunnelList(out []byte) []tunnelEntry {
	text := string(out)
	for start := strings.Index(text, "["); start >= 0; {
		var entries []tunnelEntry
		if err := json.NewDecoder(strings.NewReader(text[start:])).Decode(&entries); err == nil && hasUsableTunnel(entries) {
			return entries
		}
		next := strings.Index(text[start+1:], "[")
		if next < 0 {
			break
		}
		start += next + 1
	}
	return nil
}

func hasUsableTunnel(entries []tunnelEntry) bool {
	for _, e := range entries {
		if e.Address != "" && e.RsdPort > 0 {
			return true
		}
	}
	return false
}
