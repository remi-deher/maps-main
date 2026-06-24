package goios

import (
	"context"
	"encoding/json"
	"fmt"
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
		if d.targetUDID != "" && e.UDID != d.targetUDID {
			continue
		}
		if endpoint, ok := driver.NewTunnelEndpoint(e.Address, e.RsdPort, e.UDID); ok {
			return endpoint, true
		}
	}
	return driver.TunnelEndpoint{}, false
}

// ListNetworkDevices runs `ios tunnel ls` and returns every device the daemon
// currently has a tunnel for, not just the first usable one — go-ios discovers
// these on its own (USB or LAN), this just surfaces what it already found.
func (d *Driver) ListNetworkDevices(ctx context.Context) ([]driver.NetworkDevice, error) {
	bin, err := d.binPath()
	if err != nil {
		return nil, err
	}
	out, err := execCommandContext(ctx, bin, "tunnel", "ls").Output()
	if err != nil {
		return nil, fmt.Errorf("go-ios tunnel ls: %w", err)
	}
	var devices []driver.NetworkDevice
	for _, e := range parseTunnelList(out) {
		if e.Address == "" || e.RsdPort <= 0 {
			continue
		}
		devices = append(devices, driver.NetworkDevice{UDID: e.UDID, Address: e.Address, Port: e.RsdPort})
	}
	return devices, nil
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
