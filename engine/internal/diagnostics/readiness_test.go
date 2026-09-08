package diagnostics

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

type stubLister struct {
	devices []driver.Device
	err     error
}

func (s stubLister) ListDevices(context.Context) ([]driver.Device, error) {
	return s.devices, s.err
}

type stubProber struct{ state driver.DeviceState }

func (s stubProber) ProbeDeviceState(context.Context) driver.DeviceState { return s.state }

func boolPtr(v bool) *bool { return &v }

func requirement(t *testing.T, report Readiness, id string) Requirement {
	t.Helper()
	for _, req := range report.Requirements {
		if req.ID == id {
			return req
		}
	}
	t.Fatalf("no requirement %q in %+v", id, report.Requirements)
	return Requirement{}
}

// The point of the report: the four prerequisites are answered separately,
// instead of all collapsing into the same tunnel timeout.
func TestReadinessReportsEveryPrerequisite(t *testing.T) {
	report := CheckReadiness(context.Background(), stubLister{}, nil)

	for _, id := range []string{"device", "pairing", "developer-mode", "developer-image"} {
		req := requirement(t, report, id)
		if req.Label == "" || req.Detail == "" {
			t.Errorf("requirement %q is missing a label or detail: %+v", id, req)
		}
	}
}

func TestReadinessWithNoDevice(t *testing.T) {
	report := CheckReadiness(context.Background(), stubLister{}, nil)

	if report.Ready {
		t.Error("Ready = true with no device connected")
	}
	dev := requirement(t, report, "device")
	if dev.Status != RequirementFailed {
		t.Errorf("device status = %q, want failed", dev.Status)
	}
	if dev.Fix == "" {
		t.Error("a failed device check must say what to do about it")
	}
	// Nothing to pair with, so pairing is unanswerable rather than failed —
	// reporting it as failed would send the user chasing the wrong step.
	if got := requirement(t, report, "pairing").Status; got != RequirementUnknown {
		t.Errorf("pairing status = %q, want unknown when no device is present", got)
	}
}

func TestReadinessSurfacesAUsbmuxFailureSeparately(t *testing.T) {
	report := CheckReadiness(context.Background(), stubLister{err: errors.New("usbmuxd down")}, nil)

	dev := requirement(t, report, "device")
	if dev.Status != RequirementFailed {
		t.Fatalf("device status = %q, want failed", dev.Status)
	}
	if !strings.Contains(dev.Detail, "usbmuxd down") {
		t.Errorf("detail = %q, want it to carry the underlying error", dev.Detail)
	}
}

// Developer Mode is the prerequisite nothing could previously see: with it off
// the tunnel comes up and every DVT service is then refused.
func TestReadinessReportsDeveloperModeOff(t *testing.T) {
	report := CheckReadiness(context.Background(),
		stubLister{devices: []driver.Device{{UDID: "udid-1", Name: "iPhone"}}},
		stubProber{driver.DeviceState{
			DeveloperModeEnabled:  boolPtr(false),
			DeveloperImageMounted: boolPtr(true),
		}})

	if report.Ready {
		t.Error("Ready = true with developer mode disabled")
	}
	req := requirement(t, report, "developer-mode")
	if req.Status != RequirementFailed {
		t.Errorf("status = %q, want failed", req.Status)
	}
	if !strings.Contains(req.Fix, "Mode développeur") {
		t.Errorf("fix = %q, want it to point at the iPhone setting", req.Fix)
	}
	// The one that passed must not carry advice — that reads as a warning.
	if got := requirement(t, report, "developer-image"); got.Fix != "" {
		t.Errorf("a passing requirement carries a fix: %q", got.Fix)
	}
}

// A probe that couldn't ask must not be presented as the user's fault, and must
// not count as a pass either.
func TestReadinessDistinguishesUnknownFromFailed(t *testing.T) {
	report := CheckReadiness(context.Background(),
		stubLister{devices: []driver.Device{{UDID: "udid-1"}}},
		stubProber{driver.DeviceState{}}) // both nil: couldn't tell

	if report.Ready {
		t.Error("Ready = true while two prerequisites are unverified")
	}
	for _, id := range []string{"developer-mode", "developer-image"} {
		if got := requirement(t, report, id).Status; got != RequirementUnknown {
			t.Errorf("%s status = %q, want unknown", id, got)
		}
	}
}

func TestReadinessAllGreen(t *testing.T) {
	t.Setenv("GPSMOCK_LOCKDOWN_DIR", t.TempDir()) // no pairing records here
	report := CheckReadiness(context.Background(),
		stubLister{devices: []driver.Device{{UDID: "", Name: "iPhone"}}}, // no UDID => nothing to pair
		stubProber{driver.DeviceState{
			DeveloperModeEnabled:  boolPtr(true),
			DeveloperImageMounted: boolPtr(true),
		}})

	if !report.Ready {
		var failing []string
		for _, req := range report.Requirements {
			if req.Status != RequirementOK {
				failing = append(failing, req.ID+"="+string(req.Status))
			}
		}
		t.Errorf("Ready = false, failing: %v", failing)
	}
}
