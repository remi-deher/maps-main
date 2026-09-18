package pmd3

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// defaultTunneldPort is pymobiledevice3's own tunneld default. Configurable so
// two engines on one machine can each run their own daemon instead of fighting
// over a single fixed port.
const defaultTunneldPort = 49151

// tunneldClient is the short-timeout HTTP client used to poll the tunneld API.
var tunneldClient = &http.Client{Timeout: 3 * time.Second}

// port is the tunneld REST API port this driver's daemon owns.
func (d *Driver) port() int {
	if d.tunneldPort > 0 {
		return d.tunneldPort
	}
	return defaultTunneldPort
}

// baseURL is the root of this daemon's REST API. tunneldURL is a test seam; in
// production the URL is derived from the port we launched tunneld on, so the
// two can never drift apart.
func (d *Driver) baseURL() string {
	if d.tunneldURL != "" {
		return d.tunneldURL
	}
	return "http://127.0.0.1:" + driver.Itoa(d.port()) + "/"
}

// tunneldEntry mirrors one tunnel object from the tunneld REST API, e.g.
// {"<udid>":[{"tunnel-address":"fd...:1","tunnel-port":64337,"interface":"utunN"}]}.
type tunneldEntry struct {
	Address   string `json:"tunnel-address"`
	Port      int    `json:"tunnel-port"`
	Interface string `json:"interface"`
}

// queryTunneld asks the running daemon's REST API for the current device tunnel
// and returns the first entry with a usable RSD address+port.
func (d *Driver) queryTunneld(ctx context.Context) (driver.TunnelEndpoint, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.baseURL(), nil)
	if err != nil {
		return driver.TunnelEndpoint{}, false
	}
	resp, err := tunneldClient.Do(req)
	if err != nil {
		return driver.TunnelEndpoint{}, false
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return driver.TunnelEndpoint{}, false
	}
	return parseTunneld(body, d.targetUDID)
}

// ListNetworkDevices asks the running tunneld daemon for every device it
// currently has a tunnel for — tunneld auto-discovers Apple devices paired on
// the LAN via mDNS/Bonjour on its own, this just surfaces what it found.
func (d *Driver) ListNetworkDevices(ctx context.Context) ([]driver.NetworkDevice, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.baseURL(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := tunneldClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pmd3 tunneld: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var byUDID map[string][]tunneldEntry
	if err := json.Unmarshal(body, &byUDID); err != nil {
		return nil, fmt.Errorf("pmd3 tunneld: invalid JSON: %w", err)
	}
	var devices []driver.NetworkDevice
	for _, udid := range sortedUDIDs(byUDID) {
		for _, t := range byUDID[udid] {
			if t.Address == "" || t.Port <= 0 {
				continue
			}
			devices = append(devices, driver.NetworkDevice{UDID: udid, Address: t.Address, Port: t.Port})
		}
	}
	return devices, nil
}

// sortedUDIDs returns the response's UDIDs in a stable order. Go randomizes map
// iteration, so without this the "first usable tunnel" picked for a machine with
// two devices attached — and therefore which iPhone gets the injections — could
// differ between two consecutive polls.
func sortedUDIDs(byUDID map[string][]tunneldEntry) []string {
	udids := make([]string, 0, len(byUDID))
	for udid := range byUDID {
		udids = append(udids, udid)
	}
	sort.Strings(udids)
	return udids
}

// parseTunneld decodes the tunneld API response (a JSON object keyed by UDID,
// each value a list of tunnels) and returns the first usable tunnel with its
// owning UDID. When targetUDID is set, only that device's tunnels are
// considered. Degrades gracefully to ok=false on any other shape.
func parseTunneld(body []byte, targetUDID string) (driver.TunnelEndpoint, bool) {
	var byUDID map[string][]tunneldEntry
	if err := json.Unmarshal(body, &byUDID); err != nil {
		return driver.TunnelEndpoint{}, false
	}
	for _, udid := range sortedUDIDs(byUDID) {
		if targetUDID != "" && udid != targetUDID {
			continue
		}
		for _, t := range byUDID[udid] {
			if endpoint, ok := driver.NewTunnelEndpoint(t.Address, t.Port, udid); ok {
				return endpoint, true
			}
		}
	}
	return driver.TunnelEndpoint{}, false
}
