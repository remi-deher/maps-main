package pmd3

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const defaultTunneldURL = "http://127.0.0.1:49151/"

// tunneldClient is the short-timeout HTTP client used to poll the tunneld API.
var tunneldClient = &http.Client{Timeout: 3 * time.Second}

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
	url := d.tunneldURL
	if url == "" {
		url = defaultTunneldURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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
	return parseTunneld(body)
}

// parseTunneld decodes the tunneld API response (a JSON object keyed by UDID,
// each value a list of tunnels) and returns the first usable tunnel with its
// owning UDID. Degrades gracefully to ok=false on any other shape.
func parseTunneld(body []byte) (driver.TunnelEndpoint, bool) {
	var byUDID map[string][]tunneldEntry
	if err := json.Unmarshal(body, &byUDID); err != nil {
		return driver.TunnelEndpoint{}, false
	}
	for udid, tunnels := range byUDID {
		for _, t := range tunnels {
			if endpoint, ok := driver.NewTunnelEndpoint(t.Address, t.Port, udid); ok {
				return endpoint, true
			}
		}
	}
	return driver.TunnelEndpoint{}, false
}
