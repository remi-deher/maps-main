package engine

import (
	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/cluster"
)

// SetClusterManager attaches the HA cluster manager so Status() reports its
// state and SaveSettings can push live config changes to it.
func (e *Engine) SetClusterManager(m *cluster.Manager) {
	e.mu.Lock()
	e.clusterMgr = m
	e.mu.Unlock()
}

// ClusterManager returns the attached cluster manager, or nil if cluster mode
// is off.
func (e *Engine) ClusterManager() *cluster.Manager {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.clusterMgr
}

// OnEvent registers the outbound event sink.
func (e *Engine) OnEvent(f EmitFunc) {
	e.mu.Lock()
	e.emit = f
	e.mu.Unlock()
}

// statusSnapshotLocked must be called while holding e.mu. It captures the emit
// func and status snapshot, then unlocks so callbacks are not invoked under the
// engine mutex.
func (e *Engine) statusSnapshotLocked() (EmitFunc, api.Status) {
	emit, st := e.emit, e.st
	e.mu.Unlock()
	return emit, st
}

// emitStatusLocked snapshots, unlocks, and broadcasts STATUS.
func (e *Engine) emitStatusLocked() {
	emit, st := e.statusSnapshotLocked()
	emit(api.EventStatus, st)
}

// Status returns a snapshot of the current state.
func (e *Engine) Status() api.Status {
	e.mu.RLock()
	st := e.st
	mgr := e.clusterMgr
	e.mu.RUnlock()

	if mgr != nil {
		info := mgr.Status()
		peers := make([]api.ClusterPeer, len(info.Peers))
		for i, p := range info.Peers {
			peers[i] = api.ClusterPeer{Address: p.Address, Port: p.Port, Online: p.Online, Role: p.Role, Name: p.Name, Discovered: p.Discovered}
		}
		st.Cluster = &api.ClusterInfo{Role: info.Role, Mode: info.Mode, Peers: peers}
	}
	return st
}
