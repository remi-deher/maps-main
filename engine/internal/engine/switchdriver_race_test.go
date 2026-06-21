package engine

import (
	"context"
	"sync"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// raceTestDriverA/B are two distinct driver IDs registered against fresh
// mockDriver instances, so SwitchDriver actually swaps e.drv to a new pointer
// on every call instead of rebuilding the same one.
const (
	raceTestDriverA domain.DriverID = "race-test-driver-a"
	raceTestDriverB domain.DriverID = "race-test-driver-b"
)

func init() {
	factory := func(domain.DriverID) driver.Factory {
		return func(cfg driver.Config) (driver.Driver, error) {
			return &mockDriver{}, nil
		}
	}
	driver.Register(raceTestDriverA, factory(raceTestDriverA))
	driver.Register(raceTestDriverB, factory(raceTestDriverB))
}

// TestSwitchDriverRacesWithUnguardedDriverReads is a regression test for a
// data race that existed between SwitchDriver writing e.drv under e.mu and
// injectLocation/ClearLocation/StartTunnel/GetDeviceInfo reading it with no
// lock at all. All reads now go through the driver() accessor, which takes
// e.mu.RLock — this test exercises both paths concurrently under -race to
// guard against that regressing.
//
// Run with `go test -race -run TestSwitchDriverRacesWithUnguardedDriverReads
// ./engine/internal/engine/...` to confirm no race is reported.
func TestSwitchDriverRacesWithUnguardedDriverReads(t *testing.T) {
	drv := &mockDriver{id: domain.DriverPmd3}
	eng := New(drv, settings.Default())
	eng.SetDriverConfigBase(driver.Config{Transport: driver.TransportAuto})

	ctx := context.Background()
	var wg sync.WaitGroup

	// Goroutine 1: repeatedly calls SetLocation, which reaches e.drv.SetLocation
	// via injectLocation (engine.go) with no lock held around the read of e.drv.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			_ = eng.SetLocation(ctx, 48.8566, 2.3522, "Paris")
		}
	}()

	// Goroutine 2: repeatedly calls SwitchDriver, which writes e.drv under
	// e.mu.Lock() (engine.go) — the lock SetLocation's read never takes.
	wg.Add(1)
	go func() {
		defer wg.Done()
		ids := []domain.DriverID{raceTestDriverA, raceTestDriverB}
		for i := 0; i < 50; i++ {
			_ = eng.SwitchDriver(ctx, string(ids[i%2]), "auto")
		}
	}()

	wg.Wait()
}
