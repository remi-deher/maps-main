package goios

import (
	"encoding/json"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

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
