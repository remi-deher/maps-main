package goios

import (
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

// parseTunnelList decodes `ios tunnel ls` output. go-ios writes its slog lines
// to stderr and the JSON array to stdout, but PowerShell can also interleave
// NativeCommandError text and multiple arrays (for example an empty [] before
// the usable tunnel list). Scan every array-shaped value and keep the first one
// that exposes a usable RSD address+port.
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

// parseDeviceList decodes the output of `ios list`. go-ios prints
// {"deviceList":["udid1","udid2"]}; we degrade gracefully on any other shape.
func parseDeviceList(out []byte) []driver.Device {
	var payload struct {
		DeviceList []string `json:"deviceList"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil
	}
	devices := make([]driver.Device, 0, len(payload.DeviceList))
	for _, udid := range payload.DeviceList {
		devices = append(devices, driver.Device{UDID: udid, Source: "usb"})
	}
	return devices
}
