package engine

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// newTunnelledEngine returns an engine with an established tunnel, which is the
// precondition for every health-state transition below.
func newTunnelledEngine(t *testing.T) *Engine {
	t.Helper()
	eng := New(&mockDriver{
		id:         domain.DriverPmd3,
		tunnelInfo: driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB},
	}, settings.Default())
	if err := eng.StartTunnel(context.Background()); err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	return eng
}

func TestRecordHealthRTTStoresLatencyAndClearsSearching(t *testing.T) {
	eng := newTunnelledEngine(t)
	eng.setTunnelSearching(true)

	eng.recordHealthRTT(42 * time.Millisecond)

	th := eng.Status().TunnelHealth
	if th == nil {
		t.Fatal("TunnelHealth is nil")
	}
	if th.LastCheckRTTms != 42 {
		t.Errorf("LastCheckRTTms = %d, want 42", th.LastCheckRTTms)
	}
	// A successful dial means we found the device, so the searching flag must
	// not survive it.
	if th.Searching {
		t.Error("Searching = true after a successful health dial")
	}
}

// setTunnelSearching broadcasts only on an actual flip: a device that is away
// for minutes would otherwise push a STATUS on every health tick.
func TestSetTunnelSearchingBroadcastsOnlyOnChange(t *testing.T) {
	eng := newTunnelledEngine(t)

	var mu sync.Mutex
	statusEvents := 0
	eng.OnEvent(func(eventType string, _ any) {
		if eventType != "STATUS" {
			return
		}
		mu.Lock()
		statusEvents++
		mu.Unlock()
	})

	count := func() int {
		mu.Lock()
		defer mu.Unlock()
		return statusEvents
	}

	eng.setTunnelSearching(true)
	afterFirst := count()
	if afterFirst == 0 {
		t.Fatal("entering the searching state did not broadcast a STATUS")
	}

	// Same value again: nothing changed, so nothing should be sent.
	eng.setTunnelSearching(true)
	eng.setTunnelSearching(true)
	if got := count(); got != afterFirst {
		t.Errorf("STATUS broadcasts = %d after repeating the same state, want %d", got, afterFirst)
	}

	eng.setTunnelSearching(false)
	if got := count(); got == afterFirst {
		t.Error("leaving the searching state did not broadcast a STATUS")
	}
	if eng.Status().TunnelHealth.Searching {
		t.Error("Searching = true after clearing it")
	}
}

// applyTunnelUpdate is how the health monitor follows a device moving between
// USB and Wi-Fi. The endpoint must be stored either way, but the reresolve
// timestamp and the log line are reserved for an actual change.
func TestApplyTunnelUpdateStampsOnlyRealChanges(t *testing.T) {
	eng := newTunnelledEngine(t)
	same := driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB}

	eng.applyTunnelUpdate(same)
	if got := eng.Status().TunnelHealth.LastReresolveAt; got != 0 {
		t.Errorf("LastReresolveAt = %d after a no-op update, want 0", got)
	}

	moved := driver.TunnelInfo{Address: "fd00::1", Port: 61234, Type: domain.ConnWiFi}
	eng.applyTunnelUpdate(moved)

	st := eng.Status()
	if st.RSDAddress != moved.Address || st.RSDPort != moved.Port || st.ConnectionType != moved.Type {
		t.Errorf("endpoint = %s:%d (%s), want %s:%d (%s)",
			st.RSDAddress, st.RSDPort, st.ConnectionType, moved.Address, moved.Port, moved.Type)
	}
	if !st.TunnelActive {
		t.Error("TunnelActive = false after a successful re-resolve")
	}
	if st.TunnelHealth.LastReresolveAt == 0 {
		t.Error("LastReresolveAt not stamped after the device changed transport")
	}
	if st.TunnelHealth.Searching {
		t.Error("Searching = true after the device was found again")
	}
}

// A re-resolve is also how the engine recovers from "searching": it must clear
// the flag even when the endpoint is unchanged.
func TestApplyTunnelUpdateClearsSearchingEvenWhenUnchanged(t *testing.T) {
	eng := newTunnelledEngine(t)
	eng.setTunnelSearching(true)

	eng.applyTunnelUpdate(driver.TunnelInfo{Address: "127.0.0.1", Port: 54321, Type: domain.ConnUSB})

	if eng.Status().TunnelHealth.Searching {
		t.Error("Searching = true after the device was re-resolved at the same endpoint")
	}
}

// The tunnel start path treats a permission denial specially (it means "run me
// as admin", not "retry"), so the classifier has to recognise the wordings the
// two daemons and the OS actually produce.
func TestIsPermissionError(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want bool
	}{
		{nil, false},
		{errors.New("permission denied"), true},
		{errors.New("Operation not permitted"), true},
		{errors.New("Access denied."), true},
		{fmt.Errorf("start tunnel: %w", errors.New("permission denied")), true},
		{errors.New("connection refused"), false},
		{errors.New("device not found"), false},
	} {
		if got := isPermissionError(tc.err); got != tc.want {
			t.Errorf("isPermissionError(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

// fakeStore records what the engine persists, so the export path can be checked
// without a SQLite file.
type fakeStore struct {
	mu      sync.Mutex
	saved   settings.Settings
	saves   int
	saveErr error
}

func (f *fakeStore) Load() (settings.Settings, error) { return settings.Default(), nil }

func (f *fakeStore) Save(s settings.Settings) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saves++
	f.saved = s
	return f.saveErr
}

func (f *fakeStore) snapshot() (settings.Settings, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.saved, f.saves
}

// What gets persisted is what the engine will boot with next time, so the
// export has to carry the live values rather than the defaults.
func TestPersistExportsLiveSettings(t *testing.T) {
	store := &fakeStore{}
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	eng.SetStore(store)

	if err := eng.AddFavorite(context.Background(), 48.8566, 2.3522, "Paris"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}

	saved, saves := store.snapshot()
	if saves == 0 {
		t.Fatal("no settings were persisted after a mutating action")
	}
	if len(saved.Favorites) != 1 || saved.Favorites[0].Name != "Paris" {
		t.Errorf("persisted favorites = %+v, want the one just added", saved.Favorites)
	}
	if saved.PreferredDriver == "" {
		t.Error("PreferredDriver was not exported")
	}
}

// A failing store must be logged, never fatal: losing the ability to persist
// settings should not take the running engine down with it.
func TestPersistFailureIsLoggedNotFatal(t *testing.T) {
	store := &fakeStore{saveErr: errors.New("disk full")}
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	eng.SetStore(store)

	if err := eng.AddFavorite(context.Background(), 48.8566, 2.3522, "Paris"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}

	var found bool
	for _, entry := range eng.GetLogs() {
		if entry.Level == "error" && entry.Category == "settings" {
			found = true
			break
		}
	}
	if !found {
		t.Error("a failed persist did not produce an error log entry")
	}
}

// No store attached (the test/embedded configuration) must simply skip
// persistence rather than panic on a nil interface.
func TestPersistWithoutAStoreIsANoop(t *testing.T) {
	eng := New(&mockDriver{id: domain.DriverPmd3}, settings.Default())
	if err := eng.AddFavorite(context.Background(), 48.8566, 2.3522, "Paris"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}

	if got := len(eng.Status().Favorites); got != 1 {
		t.Errorf("favorites = %d, want the action to have applied anyway", got)
	}
}
