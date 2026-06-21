package pmd3

// Mirrors goios's exec_test.go: exercises the real exec.Command/CommandContext
// code paths (tunnel spawn + RSD parsing, mounter best-effort, timeout, ctx
// cancellation, list/run failures) without a real python/pymobiledevice3
// install, using the same fake-subprocess re-exec technique os/exec's own
// tests use.

import (
	"context"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver/exectest"
)

func withFakeExec(t *testing.T, scenario string) {
	t.Helper()
	origCommand, origCommandContext := execCommand, execCommandContext
	execCommand = exectest.FakeCommand(scenario)
	execCommandContext = exectest.FakeCommandContext(scenario)
	t.Cleanup(func() {
		execCommand, execCommandContext = origCommand, origCommandContext
	})
}

// TestHelperProcess is invoked as the child process by exectest.FakeCommand/
// FakeCommandContext above; it exits before any assertion in this file
// runs. Skips immediately under a normal `go test` invocation.
func TestHelperProcess(t *testing.T) {
	args, scenario, ok := exectest.HelperArgs()
	if !ok {
		return
	}
	defer os.Exit(0)

	// StartTunnel's best-effort "mounter auto-mount" call ignores its result
	// (`_ = execCommandContext(...).Run()`) — exit immediately for it
	// regardless of scenario, so it doesn't also sleep/print like the real
	// tunneld spawn this scenario is meant to simulate.
	for _, a := range args {
		if a == "auto-mount" {
			return
		}
	}

	switch scenario {
	case "rsd-ok":
		fmt.Println("Created tunnel --rsd fde6:1234::1 54321")
		time.Sleep(10 * time.Second)
	case "rsd-never":
		time.Sleep(10 * time.Second)
	case "list-ok":
		fmt.Println(`[{"Identifier":"udid-1","DeviceName":"iPhone","ConnectionType":"USB"}]`)
	case "cmd-fail":
		fmt.Fprintln(os.Stderr, "boom: command failed")
		os.Exit(1)
	case "cmd-ok":
		fmt.Println("ok")
	default:
		os.Exit(0)
	}
}

func TestStartTunnelParsesRSDAddressAndKeepsProcessRunning(t *testing.T) {
	withFakeExec(t, "rsd-ok")
	d := &Driver{py: "fake-python", tunnelStartTimeout: 5 * time.Second}

	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if ti.Address != "fde6:1234::1" || ti.Port != 54321 {
		t.Errorf("StartTunnel = %+v, want fde6:1234::1:54321", ti)
	}

	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel: %v", err)
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("expected no active tunnel after StopTunnel")
	}
}

func TestStartTunnelTimesOutWhenRSDNeverAppears(t *testing.T) {
	withFakeExec(t, "rsd-never")
	d := &Driver{py: "fake-python", tunnelStartTimeout: 200 * time.Millisecond}

	if _, err := d.StartTunnel(context.Background()); err == nil {
		t.Fatal("expected a timeout error when the RSD line never appears")
	}
}

func TestStartTunnelRespectsContextCancellation(t *testing.T) {
	withFakeExec(t, "rsd-never")
	d := &Driver{py: "fake-python", tunnelStartTimeout: 5 * time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	if _, err := d.StartTunnel(ctx); err == nil {
		t.Fatal("expected an error when ctx is cancelled before the RSD line appears")
	}
}

func TestListDevicesParsesRealCommandOutput(t *testing.T) {
	withFakeExec(t, "list-ok")
	d := &Driver{py: "fake-python", base: []string{}}

	devices, err := d.ListDevices(context.Background())
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	if len(devices) != 1 || devices[0].UDID != "udid-1" {
		t.Errorf("ListDevices = %+v, want 1 device udid-1", devices)
	}
}

func TestListDevicesCommandFailureIsAnError(t *testing.T) {
	withFakeExec(t, "cmd-fail")
	d := &Driver{py: "fake-python", base: []string{}}

	if _, err := d.ListDevices(context.Background()); err == nil {
		t.Error("expected an error when the underlying command fails")
	}
}

func TestSetLocationRunsRealCommand(t *testing.T) {
	withFakeExec(t, "cmd-ok")
	d := &Driver{py: "fake-python", base: []string{}}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "10.0.0.1", 1234, true
	d.mu.Unlock()

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Errorf("SetLocation: %v", err)
	}
}

func TestSetLocationSurfacesCommandFailure(t *testing.T) {
	withFakeExec(t, "cmd-fail")
	d := &Driver{py: "fake-python", base: []string{}}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "10.0.0.1", 1234, true
	d.mu.Unlock()

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err == nil {
		t.Error("expected an error when the underlying simulate-location command fails")
	}
}

func TestCheckHealthDialsRealEndpoint(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()

	host, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split listener addr: %v", err)
	}
	portNum := 0
	if _, err := fmt.Sscanf(port, "%d", &portNum); err != nil {
		t.Fatalf("parse port: %v", err)
	}

	d := &Driver{}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = host, portNum, true
	d.mu.Unlock()

	if !d.CheckHealth(context.Background()) {
		t.Error("expected CheckHealth to succeed against a real listening port")
	}
}

func TestCheckHealthFailsAgainstClosedPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	host, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split listener addr: %v", err)
	}
	portNum := 0
	if _, err := fmt.Sscanf(port, "%d", &portNum); err != nil {
		t.Fatalf("parse port: %v", err)
	}
	_ = ln.Close()

	d := &Driver{}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = host, portNum, true
	d.mu.Unlock()

	if d.CheckHealth(context.Background()) {
		t.Error("expected CheckHealth to fail against a closed port")
	}
}
