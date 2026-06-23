package pmd3

import (
	"encoding/json"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// parseDeviceList decodes the output of `pymobiledevice3 usbmux list`, a JSON
// array of objects keyed by Identifier / DeviceName. Degrades gracefully.
func parseDeviceList(out []byte) []driver.Device {
	var entries []struct {
		Identifier     string `json:"Identifier"`
		DeviceName     string `json:"DeviceName"`
		ConnectionType string `json:"ConnectionType"`
	}
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil
	}
	devices := make([]driver.Device, 0, len(entries))
	for _, e := range entries {
		devices = append(devices, driver.Device{
			UDID:   e.Identifier,
			Name:   e.DeviceName,
			Source: e.ConnectionType,
		})
	}
	return devices
}
