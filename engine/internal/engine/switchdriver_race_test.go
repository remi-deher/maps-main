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

// TestSwitchDriverRacesWithUnguardedDriverReads is a regression test for the
// data race introduced alongside SwitchDriver: e.drv is written under e.mu in
// SwitchDriver, but read without any lock everywhere else (injectLocation,
// ClearLocation, StartTunnel, GetDeviceInfo). Before SwitchDriver existed,
// e.drv was effectively immutable after New(), so those unguarded reads were
// safe; SwitchDriver makes them a race.
//
// Run with `go test -race -run TestSwitchDriverRacesWithUnguardedDriverReads
// ./engine/internal/engine/...` — the race detector should report a
// read/write race on e.drv between this test's two goroutines. This test
// passes (silently) without -race; the regression is the race itself, not a
// wrong return value.
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
