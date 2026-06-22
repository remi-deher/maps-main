package goios

// Exercises the real exec.Command/exec.CommandContext code paths (tunnel
// spawn + RSD parsing, timeout, context cancellation, list/info/run failures)
// without a real go-ios binary, using the same fake-subprocess technique
// os/exec's own tests use: re-exec this test binary as a child process with
// -test.run=TestHelperProcess, and have that one test masquerade as go-ios
// based on a scenario picked via env var.

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver/exectest"
)

// withFakeExec swaps the package's exec indirection for the duration of a
// test, restoring it on cleanup so other tests still exercise the real
// exec.Command/CommandContext defaults.
func withFakeExec(t *testing.T, scenario string) {
	t.Helper()
	origCommand, origCommandContext := execCommand, execCommandContext
	execCommand = exectest.FakeCommand(scenario)
	execCommandContext = exectest.FakeCommandContext(scenario)
	t.Cleanup(func() {
		execCommand, execCommandContext = origCommand, origCommandContext
	})
}

// TestHelperProcess is not a real test: it's invoked as the child process by
// exectest.FakeCommand/FakeCommandContext above, and exits before any
// assertion in this file would run. Skips immediately under a normal `go
// test` invocation (GO_WANT_HELPER_PROCESS unset).
func TestHelperProcess(t *testing.T) {
	args, scenario, ok := exectest.HelperArgs()
	if !ok {
		return
	}
	defer os.Exit(0)

	// args[0] is the "name" passed to exec.Command (d.bin); args[1:] are the
	// real go-ios CLI args (tunnel start, tunnel ls, list, info, setlocation...).
	sub := ""
	if len(args) >= 3 {
		sub = args[1] + " " + args[2] // e.g. "tunnel start", "tunnel ls"
	}

	// echo-args records the CLI args (everything after the bin name) to a file
	// so a test can assert the exact command the driver built.
	if scenario == "echo-args" {
		if f := os.Getenv("FAKE_ARGS_FILE"); f != "" {
			_ = os.WriteFile(f, []byte(strings.Join(args[1:], " ")), 0o644)
		}
		return
	}

	switch scenario {
	case "tunnel-ok":
		switch sub {
		case "tunnel start":
			time.Sleep(10 * time.Second) // long-running daemon
		case "tunnel ls":
			fmt.Println(`[{"address":"fde6:1234::1","rsdPort":54321,"udid":"udid-1","userspaceTun":false,"userspaceTunPort":0}]`)
		}
	case "tunnel-never":
		switch sub {
		case "tunnel start":
			time.Sleep(10 * time.Second) // daemon up, but no device tunnel ever appears
		case "tunnel ls":
			fmt.Println(`[]`)
		}
	case "list-ok":
		fmt.Println(`{"deviceList":["udid-1","udid-2"]}`)
	case "list-empty":
		fmt.Println(`{"deviceList":[]}`)
	case "info-ok":
		fmt.Println(`{"DeviceName":"Test iPhone","ProductType":"iPhone15,2","ProductVersion":"17.0","SerialNumber":"SN123","WiFiAddress":"aa:bb:cc:dd:ee:ff"}`)
	case "cmd-fail":
		fmt.Fprintln(os.Stderr, "boom: command failed")
		os.Exit(1)
	case "cmd-ok":
		fmt.Println("ok")
	default:
		os.Exit(0)
	}
}

func TestStartTunnelDiscoversTunnelViaListAndKeepsProcessRunning(t *testing.T) {
	withFakeExec(t, "tunnel-ok")
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 5 * time.Second}

	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if ti.Address != "fde6:1234::1" || ti.Port != 54321 {
		t.Errorf("StartTunnel = %+v, want fde6:1234::1:54321", ti)
	}
	if got, ok := d.Tunnel(); !ok || got.Address != "fde6:1234::1" {
		t.Errorf("Tunnel() after start = %+v, %v", got, ok)
	}
	if d.udid != "udid-1" {
		t.Errorf("udid after start = %q, want udid-1", d.udid)
	}

	// Clean up the still-running fake tunnel process.
	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel: %v", err)
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("expected no active tunnel after StopTunnel")
	}
}

func TestStartTunnelTimesOutWhenNoTunnelAppears(t *testing.T) {
	withFakeExec(t, "tunnel-never")
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 200 * time.Millisecond}

	_, err := d.StartTunnel(context.Background())
	if err == nil {
		t.Fatal("expected a timeout error when no device tunnel ever appears")
	}
}

func TestStartTunnelRespectsContextCancellation(t *testing.T) {
	withFakeExec(t, "tunnel-never")
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 5 * time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	_, err := d.StartTunnel(ctx)
	if err == nil {
		t.Fatal("expected an error when ctx is cancelled before the RSD line appears")
	}
}

func TestListDevicesParsesRealCommandOutput(t *testing.T) {
	withFakeExec(t, "list-ok")
	d := &Driver{bin: "fake-ios"}

	devices, err := d.ListDevices(context.Background())
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	if len(devices) != 2 || devices[0].UDID != "udid-1" {
		t.Errorf("ListDevices = %+v, want 2 devices starting with udid-1", devices)
	}
}

func TestListDevicesCommandFailureIsAnError(t *testing.T) {
	withFakeExec(t, "cmd-fail")
	d := &Driver{bin: "fake-ios"}

	if _, err := d.ListDevices(context.Background()); err == nil {
		t.Error("expected an error when the underlying command fails")
	}
}

func TestDeviceDetailsNoDeviceIsAnError(t *testing.T) {
	withFakeExec(t, "list-empty")
	d := &Driver{bin: "fake-ios"}

	if _, err := d.DeviceDetails(context.Background()); err == nil {
		t.Error("expected an error when no device is detected")
	}
}

func TestSetLocationRunsRealCommand(t *testing.T) {
	withFakeExec(t, "cmd-ok")
	d := &Driver{bin: "fake-ios"}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "10.0.0.1", 1234, true
	d.mu.Unlock()

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Errorf("SetLocation: %v", err)
	}
}

func TestSetLocationSurfacesCommandFailure(t *testing.T) {
	withFakeExec(t, "cmd-fail")
	d := &Driver{bin: "fake-ios"}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "10.0.0.1", 1234, true
	d.mu.Unlock()

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err == nil {
		t.Error("expected an error when the underlying setlocation command fails")
	}
}

// echoArgs runs op against a driver wired to the echo-args fake and returns the
// exact CLI args the driver built (everything after the bin name).
func echoArgs(t *testing.T, op func() error) string {
	t.Helper()
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("FAKE_ARGS_FILE", argsFile)
	withFakeExec(t, "echo-args")
	if err := op(); err != nil {
		t.Fatalf("op: %v", err)
	}
	b, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args file: %v", err)
	}
	return string(b)
}

func TestSetLocationBuildsCorrectCommand(t *testing.T) {
	d := &Driver{bin: "fake-ios"}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "fde6:1234::1", 54321, true
	d.mu.Unlock()

	got := echoArgs(t, func() error {
		return d.SetLocation(context.Background(), 48.8566, 2.3522)
	})
	for _, want := range []string{
		"setlocation",
		"--address=fde6:1234::1",
		"--rsd-port=54321",
		"--lat=48.8566",
		"--lon=2.3522",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("setlocation args %q missing %q", got, want)
		}
	}
}

func TestClearLocationBuildsResetCommand(t *testing.T) {
	d := &Driver{bin: "fake-ios"}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "fde6:1234::1", 54321, true
	d.mu.Unlock()

	got := echoArgs(t, func() error {
		return d.ClearLocation(context.Background())
	})
	for _, want := range []string{"resetlocation", "--address=fde6:1234::1", "--rsd-port=54321"} {
		if !strings.Contains(got, want) {
			t.Errorf("resetlocation args %q missing %q", got, want)
		}
	}
}

// TestEndToEndTunnelLifecycle chains StartTunnel -> SetLocation -> ClearLocation
// -> StopTunnel against the fake CLI, asserting the driver's state transitions
// at each step (the closest thing to a mocked-device conformance check without
// a real iPhone).
func TestEndToEndTunnelLifecycle(t *testing.T) {
	withFakeExec(t, "tunnel-ok")
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 5 * time.Second}

	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if ti.Address != "fde6:1234::1" || ti.Port != 54321 {
		t.Fatalf("StartTunnel = %+v, want fde6:1234::1:54321", ti)
	}
	if got, ok := d.Tunnel(); !ok || got != ti {
		t.Fatalf("Tunnel() after start = %+v, %v, want %+v, true", got, ok, ti)
	}

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Fatalf("SetLocation: %v", err)
	}
	if err := d.ClearLocation(context.Background()); err != nil {
		t.Fatalf("ClearLocation: %v", err)
	}

	if err := d.StopTunnel(context.Background()); err != nil {
		t.Fatalf("StopTunnel: %v", err)
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("expected no active tunnel after StopTunnel")
	}
	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err == nil {
		t.Error("expected SetLocation to fail after StopTunnel (no tunnel)")
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
	_ = ln.Close() // close it immediately so nothing is listening

	d := &Driver{}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = host, portNum, true
	d.mu.Unlock()

	if d.CheckHealth(context.Background()) {
		t.Error("expected CheckHealth to fail against a closed port")
	}
}
