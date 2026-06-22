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
// to stderr and the JSON array to stdout, but we still scan line-by-line for
// the array so stray log lines on stdout don't break decoding.
func parseTunnelList(out []byte) []tunnelEntry {
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "[") {
			continue
		}
		var entries []tunnelEntry
		if err := json.Unmarshal([]byte(line), &entries); err == nil {
			return entries
		}
	}
	return nil
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
