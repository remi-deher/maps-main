package engine

import (
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// SetStore attaches the settings persistence store. Call once at startup,
// before any mutating action runs.
func (e *Engine) SetStore(store settings.Store) {
	e.mu.Lock()
	e.store = store
	e.mu.Unlock()
}

// SetSecretStore attaches server-only secret persistence. Call once at startup,
// before SaveSettings can mutate routing API keys.
func (e *Engine) SetSecretStore(store settings.SecretStore) {
	e.mu.Lock()
	e.secretStore = store
	e.mu.Unlock()
}

// exportSettingsLocked builds a full Settings snapshot from the live status,
// for persistence. Caller must hold e.mu (read or write lock).
func (e *Engine) exportSettingsLocked() settings.Settings {
	cfg := settings.Default()
	cfg.UsbDriver = e.st.UsbDriver
	cfg.WifiDriver = e.st.WifiDriver
	// PreferredDriver drives the --driver flag default on next startup.
	// We use UsbDriver as the canonical "preferred" choice (SwitchDriver sets
	// both when transport=auto, which is the common case).
	if e.st.UsbDriver != "" {
		cfg.PreferredDriver = e.st.UsbDriver
	}
	cfg.FallbackEnabled = e.st.FallbackEnabled
	cfg.NotificationsEnabled = e.st.NotificationsEnabled
	cfg.DynamicIslandEnabled = e.st.DynamicIslandEnabled
	cfg.JitterEnabled = e.st.JitterEnabled
	cfg.Favorites = e.st.Favorites
	cfg.RecentHistory = e.st.RecentHistory
	routingCfg := e.routingRegistry.Config()
	cfg.OsrmBaseURL = routingCfg.OSRMBaseURL
	cfg.RoutingMode = routingCfg.Mode
	cfg.RoutingProvider = routingCfg.Provider
	cfg.RoutingProviderPriority = append([]string(nil), routingCfg.ProviderPriority...)
	cfg.ClusterHeartbeatSeconds = e.st.ClusterHeartbeatSeconds
	cfg.ClusterMasterDeadSeconds = e.st.ClusterMasterDeadSeconds
	cfg.ClusterPeerTimeoutSeconds = e.st.ClusterPeerTimeoutSeconds
	if e.clusterMgr != nil {
		cs := e.clusterMgr.Status()
		cfg.ClusterMode = cs.Mode
		cfg.ClusterSyncCerts = e.clusterMgr.SyncCertsEnabled()
		var nodes []string
		for _, p := range cs.Peers {
			if !p.Discovered {
				nodes = append(nodes, fmt.Sprintf("%s:%d", p.Address, p.Port))
			}
		}
		cfg.ClusterNodes = nodes
	}
	return cfg
}

func (e *Engine) persistSecrets() {
	e.mu.RLock()
	store := e.secretStore
	if store == nil {
		e.mu.RUnlock()
		return
	}
	routingCfg := e.routingRegistry.Config()
	secrets := settings.Secrets{
		GoogleRoutesAPIKey: routingCfg.GoogleRoutesAPIKey,
		MapboxAccessToken:  routingCfg.MapboxAccessToken,
	}
	e.mu.RUnlock()
	if err := store.SaveSecrets(secrets); err != nil {
		e.LogEvent("error", "settings", "secrets", "persist", fmt.Sprintf("Échec de la sauvegarde des secrets : %v", err), nil)
	}
}

// persist saves the current settings snapshot to disk. No-op if no store is
// attached. Must NOT be called while holding e.mu.
func (e *Engine) persist() {
	e.mu.RLock()
	store := e.store
	if store == nil {
		e.mu.RUnlock()
		return
	}
	cfg := e.exportSettingsLocked()
	e.mu.RUnlock()
	if err := store.Save(cfg); err != nil {
		e.LogEvent("error", "settings", "settings", "persist", fmt.Sprintf("Échec de la sauvegarde des réglages : %v", err), nil)
	}
}
