package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/cluster"
	"github.com/remi-deher/maps-main/engine/internal/domain"
)

// SaveSettings saves and applies configuration settings
func (e *Engine) SaveSettings(ctx context.Context, payload api.SaveSettingsPayload) error {
	e.mu.Lock()
	if val, ok := payload["companionPort"]; ok {
		if port, ok := val.(float64); ok {
			e.st.RSDPort = int(port)
		}
	}
	if val, ok := payload["preferredDriver"]; ok {
		if drv, ok := val.(string); ok {
			e.st.UsbDriver = domain.DriverID(drv)
			e.st.WifiDriver = domain.DriverID(drv)
		}
	}
	if val, ok := payload["usbDriver"]; ok {
		if drv, ok := val.(string); ok {
			e.st.UsbDriver = domain.DriverID(drv)
		}
	}
	if val, ok := payload["wifiDriver"]; ok {
		if drv, ok := val.(string); ok {
			e.st.WifiDriver = domain.DriverID(drv)
		}
	}
	if val, ok := payload["fallbackEnabled"]; ok {
		if fallback, ok := val.(bool); ok {
			e.st.FallbackEnabled = fallback
		}
	}
	if val, ok := payload["notificationsEnabled"]; ok {
		if notif, ok := val.(bool); ok {
			e.st.NotificationsEnabled = notif
		}
	}
	if val, ok := payload["dynamicIslandEnabled"]; ok {
		if island, ok := val.(bool); ok {
			e.st.DynamicIslandEnabled = island
		}
	}
	if val, ok := payload["jitterEnabled"]; ok {
		if jitter, ok := val.(bool); ok {
			e.st.JitterEnabled = jitter
		}
	}
	if val, ok := payload["osrmBaseUrl"]; ok {
		if url, ok := val.(string); ok {
			url = strings.TrimSuffix(strings.TrimSpace(url), "/")
			e.osrmBaseURL = url
			if url == "" {
				e.st.OsrmBaseURL = defaultOsrmBaseURL()
			} else {
				e.st.OsrmBaseURL = url
			}
		}
	}

	// Cluster heartbeat/failover tuning — apply live (cluster.SetTuning) and
	// mirror into the status so the UI reflects the running values. JSON
	// numbers decode as float64; a zero/negative value leaves that knob alone.
	var hbSec, deadSec, peerSec int
	if val, ok := payload["clusterHeartbeatSeconds"].(float64); ok && val > 0 {
		hbSec = int(val)
		e.st.ClusterHeartbeatSeconds = hbSec
	}
	if val, ok := payload["clusterMasterDeadSeconds"].(float64); ok && val > 0 {
		deadSec = int(val)
		e.st.ClusterMasterDeadSeconds = deadSec
	}
	if val, ok := payload["clusterPeerTimeoutSeconds"].(float64); ok && val > 0 {
		peerSec = int(val)
		e.st.ClusterPeerTimeoutSeconds = peerSec
	}
	if hbSec > 0 || deadSec > 0 || peerSec > 0 {
		cluster.SetTuning(
			time.Duration(hbSec)*time.Second,
			time.Duration(deadSec)*time.Second,
			time.Duration(peerSec)*time.Second,
		)
	}

	mgr := e.clusterMgr
	clusterMode, hasMode := payload["clusterMode"].(string)
	rawNodes, hasNodes := payload["clusterNodes"].([]any)
	syncCerts, hasSyncCerts := payload["clusterSyncCerts"].(bool)
	if mgr != nil && (hasMode || hasNodes || hasSyncCerts) {
		var nodeAddrs []string
		if hasNodes {
			for _, n := range rawNodes {
				if s, ok := n.(string); ok {
					nodeAddrs = append(nodeAddrs, s)
				}
			}
		} else {
			for _, p := range mgr.Status().Peers {
				if !p.Discovered {
					nodeAddrs = append(nodeAddrs, fmt.Sprintf("%s:%d", p.Address, p.Port))
				}
			}
		}
		mode := mgr.Status().Mode
		if hasMode {
			mode = clusterMode
		}
		if !hasSyncCerts {
			syncCerts = mgr.SyncCertsEnabled()
		}
		go mgr.UpdateConfig(ctx, mode, nodeAddrs, syncCerts)
	}

	e.emitStatusLocked()
	e.persist()
	e.LogEvent("info", "admin", "settings", "save", "Réglages sauvegardés", map[string]string{
		"keys": fmt.Sprintf("%d", len(payload)),
	})
	return nil
}
