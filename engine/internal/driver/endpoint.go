package driver

import (
	"context"
	"strings"
	"time"
)

// TunnelEndpoint is the normalized RSD endpoint discovered by a backend.
// Backend-specific parsers should convert their raw shape into this type as
// early as possible so lifecycle code can stay driver-agnostic.
type TunnelEndpoint struct {
	Info TunnelInfo
	UDID string
}

func NewTunnelEndpoint(address string, port int, udid string) (TunnelEndpoint, bool) {
	address = strings.TrimSpace(address)
	if address == "" || port <= 0 {
		return TunnelEndpoint{}, false
	}
	return TunnelEndpoint{
		Info: TunnelInfo{
			Address: address,
			Port:    port,
			Type:    Classify(address),
			Since:   time.Now(),
		},
		UDID: strings.TrimSpace(udid),
	}, true
}

type TunnelEndpointResolver func(ctx context.Context) (TunnelEndpoint, bool)

// ReresolveActiveTunnel refreshes a mount's cached endpoint by asking the
// daemon (via lister) for the tunnel it currently holds for the mount's device,
// without restarting the daemon. It follows a device that moved between USB and
// WiFi: the UDID stays, the RSD address/port change. Returns:
//   - info, found=true when a tunnel for the device exists now (mount updated);
//   - found=false otherwise, with daemonAlive telling the caller whether the
//     underlying daemon is still running (false ⇒ restart it).
//
// Manual-address mounts are left untouched (no daemon to query, and the user
// explicitly pinned the endpoint) and report daemonAlive=true so the caller
// never tears them down.
func ReresolveActiveTunnel(ctx context.Context, mount *TunnelMount, lister NetworkDeviceLister) (TunnelInfo, bool, bool) {
	if mount.IsManual() {
		return TunnelInfo{}, false, true
	}
	alive := mount.DaemonRunning()
	devices, err := lister.ListNetworkDevices(ctx)
	if err != nil || len(devices) == 0 {
		return TunnelInfo{}, false, alive
	}
	want := mount.UDID()
	for i := range devices {
		if want != "" && devices[i].UDID != want {
			continue
		}
		info := TunnelInfo{
			Address: devices[i].Address,
			Port:    devices[i].Port,
			Type:    Classify(devices[i].Address),
			Since:   time.Now(),
		}
		mount.UpdateInfo(info)
		return info, true, true
	}
	return TunnelInfo{}, false, alive
}
