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
	if payload.CompanionPort != nil {
		e.st.RSDPort = *payload.CompanionPort
	}
	if payload.PreferredDriver != nil {
		e.st.UsbDriver = domain.DriverID(*payload.PreferredDriver)
		e.st.WifiDriver = domain.DriverID(*payload.PreferredDriver)
	}
	if payload.UsbDriver != nil {
		e.st.UsbDriver = domain.DriverID(*payload.UsbDriver)
	}
	if payload.WifiDriver != nil {
		e.st.WifiDriver = domain.DriverID(*payload.WifiDriver)
	}
	if payload.FallbackEnabled != nil {
		e.st.FallbackEnabled = *payload.FallbackEnabled
	}
	if payload.NotificationsEnabled != nil {
		e.st.NotificationsEnabled = *payload.NotificationsEnabled
	}
	if payload.DynamicIslandEnabled != nil {
		e.st.DynamicIslandEnabled = *payload.DynamicIslandEnabled
	}
	if payload.JitterEnabled != nil {
		e.st.JitterEnabled = *payload.JitterEnabled
	}
	if payload.OsrmBaseURL != nil {
		url := strings.TrimSuffix(strings.TrimSpace(*payload.OsrmBaseURL), "/")
		e.osrmBaseURL = url
		if url == "" {
			e.st.OsrmBaseURL = defaultOsrmBaseURL()
		} else {
			e.st.OsrmBaseURL = url
		}
	}

	// Cluster heartbeat/failover tuning — apply live (cluster.SetTuning) and
	// mirror into the status so the UI reflects the running values.
	var hbSec, deadSec, peerSec int
	if payload.ClusterHeartbeatSeconds != nil && *payload.ClusterHeartbeatSeconds > 0 {
		hbSec = *payload.ClusterHeartbeatSeconds
		e.st.ClusterHeartbeatSeconds = hbSec
	}
	if payload.ClusterMasterDeadSeconds != nil && *payload.ClusterMasterDeadSeconds > 0 {
		deadSec = *payload.ClusterMasterDeadSeconds
		e.st.ClusterMasterDeadSeconds = deadSec
	}
	if payload.ClusterPeerTimeoutSeconds != nil && *payload.ClusterPeerTimeoutSeconds > 0 {
		peerSec = *payload.ClusterPeerTimeoutSeconds
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
	if mgr != nil && (payload.ClusterMode != nil || payload.ClusterNodes != nil || payload.ClusterSyncCerts != nil) {
		var nodeAddrs []string
		if payload.ClusterNodes != nil {
			nodeAddrs = payload.ClusterNodes
		} else {
			for _, p := range mgr.Status().Peers {
				if !p.Discovered {
					nodeAddrs = append(nodeAddrs, fmt.Sprintf("%s:%d", p.Address, p.Port))
				}
			}
		}
		mode := mgr.Status().Mode
		if payload.ClusterMode != nil {
			mode = *payload.ClusterMode
		}
		syncCerts := mgr.SyncCertsEnabled()
		if payload.ClusterSyncCerts != nil {
			syncCerts = *payload.ClusterSyncCerts
		}
		go mgr.UpdateConfig(ctx, mode, nodeAddrs, syncCerts)
	}

	e.emitStatusLocked()
	e.persist()
	e.LogEvent("info", "admin", "settings", "save", "Réglages sauvegardés", nil)
	return nil
}
