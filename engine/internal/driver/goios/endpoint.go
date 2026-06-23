package goios

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// tunnelEntry mirrors one element of `ios tunnel ls`'s JSON array, e.g.
// [{"address":"fdd7:...:1","rsdPort":65032,"udid":"...","userspaceTun":false}].
type tunnelEntry struct {
	Address      string `json:"address"`
	RsdPort      int    `json:"rsdPort"`
	UDID         string `json:"udid"`
	UserspaceTun bool   `json:"userspaceTun"`
}

// queryTunnel asks the running daemon for the current device tunnel via
// `ios tunnel ls` and returns the first entry with a usable RSD address+port.
func (d *Driver) queryTunnel(ctx context.Context) (driver.TunnelEndpoint, bool) {
	bin, err := d.binPath()
	if err != nil {
		return driver.TunnelEndpoint{}, false
	}
	out, err := execCommandContext(ctx, bin, "tunnel", "ls").Output()
	if err != nil {
		return driver.TunnelEndpoint{}, false
	}
	for _, e := range parseTunnelList(out) {
		if endpoint, ok := driver.NewTunnelEndpoint(e.Address, e.RsdPort, e.UDID); ok {
			return endpoint, true
		}
	}
	return driver.TunnelEndpoint{}, false
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
