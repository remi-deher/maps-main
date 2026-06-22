package pmd3

import (
	"encoding/json"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// tunneldEntry mirrors one tunnel object from the tunneld REST API, e.g.
// {"<udid>":[{"tunnel-address":"fd...:1","tunnel-port":64337,"interface":"utunN"}]}.
type tunneldEntry struct {
	Address   string `json:"tunnel-address"`
	Port      int    `json:"tunnel-port"`
	Interface string `json:"interface"`
}

// parseTunneld decodes the tunneld API response (a JSON object keyed by UDID,
// each value a list of tunnels) and returns the first usable tunnel with its
// owning UDID. Degrades gracefully to ok=false on any other shape.
func parseTunneld(body []byte) (driver.TunnelInfo, string, bool) {
	var byUDID map[string][]tunneldEntry
	if err := json.Unmarshal(body, &byUDID); err != nil {
		return driver.TunnelInfo{}, "", false
	}
	for udid, tunnels := range byUDID {
		for _, t := range tunnels {
			if t.Address != "" && t.Port > 0 {
				return driver.TunnelInfo{
					Address: t.Address,
					Port:    t.Port,
					Type:    driver.Classify(t.Address),
					Since:   time.Now(),
				}, udid, true
			}
		}
	}
	return driver.TunnelInfo{}, "", false
}

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
