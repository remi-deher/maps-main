package driver

import (
	"context"
	"errors"
	"os/exec"
	"testing"
)

// execCmdSentinel is a non-nil *exec.Cmd used only to make TunnelMount.cmd
// non-nil (DaemonRunning() true) without ever launching a process.
var execCmdSentinel = exec.Cmd{}

// fakeLister is a NetworkDeviceLister returning a canned result.
type fakeLister struct {
	devices []NetworkDevice
	err     error
	calls   int
}

func (f *fakeLister) ListNetworkDevices(context.Context) ([]NetworkDevice, error) {
	f.calls++
	return f.devices, f.err
}

// daemonMount builds a TunnelMount in the "daemon-backed, tunnel up" state with
// the given active UDID and a non-nil cmd sentinel so DaemonRunning() is true.
func daemonMount(udid string, info TunnelInfo) *TunnelMount {
	m := &TunnelMount{}
	// set() requires a *exec.Cmd; a zero-value &exec.Cmd is enough to make
	// cmd != nil without ever running it.
	m.set(info, &execCmdSentinel, udid)
	return m
}

func TestReresolveActiveTunnel_FollowsDeviceToNewAddress(t *testing.T) {
	old := TunnelInfo{Address: "fe80::1", Port: 100, Type: Classify("fe80::1")}
	m := daemonMount("UDID-A", old)
	lister := &fakeLister{devices: []NetworkDevice{
		{UDID: "UDID-OTHER", Address: "fd00::9", Port: 1},
		{UDID: "UDID-A", Address: "fd11::2", Port: 200}, // same device, now WiFi
	}}

	info, found, alive := ReresolveActiveTunnel(context.Background(), m, lister)
	if !found || !alive {
		t.Fatalf("found=%v alive=%v, want true/true", found, alive)
	}
	if info.Address != "fd11::2" || info.Port != 200 {
		t.Fatalf("got %s:%d, want fd11::2:200", info.Address, info.Port)
	}
	if cur, _ := m.Current(); cur.Address != "fd11::2" {
		t.Fatalf("mount not updated in place: %s", cur.Address)
	}
}

func TestReresolveActiveTunnel_DeviceGoneButDaemonAlive(t *testing.T) {
	m := daemonMount("UDID-A", TunnelInfo{Address: "fe80::1", Port: 100})
	lister := &fakeLister{devices: []NetworkDevice{{UDID: "UDID-OTHER", Address: "fd00::9", Port: 1}}}

	_, found, alive := ReresolveActiveTunnel(context.Background(), m, lister)
	if found {
		t.Fatal("found=true, want false (no tunnel for our UDID)")
	}
	if !alive {
		t.Fatal("alive=false, want true (daemon process still running)")
	}
}

func TestReresolveActiveTunnel_DaemonDeadSignalsRestart(t *testing.T) {
	m := daemonMount("UDID-A", TunnelInfo{Address: "fe80::1", Port: 100})
	m.onDaemonExit(&execCmdSentinel) // daemon process died
	lister := &fakeLister{err: errors.New("connection refused")}

	_, found, alive := ReresolveActiveTunnel(context.Background(), m, lister)
	if found {
		t.Fatal("found=true, want false")
	}
	if alive {
		t.Fatal("alive=true, want false so the caller restarts the daemon")
	}
}

func TestReresolveActiveTunnel_ManualLeftUntouched(t *testing.T) {
	m := &TunnelMount{}
	m.SetActive(TunnelInfo{Address: "192.168.1.42", Port: 62078}, "")
	lister := &fakeLister{devices: []NetworkDevice{{UDID: "X", Address: "fd00::1", Port: 9}}}

	_, found, alive := ReresolveActiveTunnel(context.Background(), m, lister)
	if found {
		t.Fatal("found=true, want false (manual address must not be overridden)")
	}
	if !alive {
		t.Fatal("alive=false, want true (nothing to restart for a manual mount)")
	}
	if lister.calls != 0 {
		t.Fatalf("lister called %d times, want 0 for manual mode", lister.calls)
	}
}
