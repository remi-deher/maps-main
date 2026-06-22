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
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

	// echo-args records the CLI args (everything after the bin name) to a file
	// so a test can assert the exact command the driver built.
	if scenario == "echo-args" {
		if f := os.Getenv("FAKE_ARGS_FILE"); f != "" {
			_ = os.WriteFile(f, []byte(strings.Join(args[1:], " ")), 0o644)
		}
		return
	}

	switch scenario {
	case "tunnel-daemon":
		time.Sleep(10 * time.Second) // `remote tunneld` runs until killed
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

// tunneldServer spins up a fake tunneld REST API returning the given JSON body.
func tunneldServer(t *testing.T, body string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/"
}

func TestStartTunnelDiscoversViaTunneldAPIAndKeepsProcessRunning(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	url := tunneldServer(t, `{"udid-1":[{"tunnel-address":"fde6:1234::1","tunnel-port":54321,"interface":"utun6"}]}`)
	d := &Driver{py: "fake-python", tunnelStartTimeout: 5 * time.Second, tunneldURL: url}

	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if ti.Address != "fde6:1234::1" || ti.Port != 54321 {
		t.Errorf("StartTunnel = %+v, want fde6:1234::1:54321", ti)
	}
	if d.udid != "udid-1" {
		t.Errorf("udid after start = %q, want udid-1", d.udid)
	}

	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel: %v", err)
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("expected no active tunnel after StopTunnel")
	}
}

func TestStartTunnelTimesOutWhenNoTunnelAppears(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	url := tunneldServer(t, `{}`) // daemon up, but no tunnel ever registered
	d := &Driver{py: "fake-python", tunnelStartTimeout: 200 * time.Millisecond, tunneldURL: url}

	if _, err := d.StartTunnel(context.Background()); err == nil {
		t.Fatal("expected a timeout error when no tunnel ever appears")
	}
}

func TestStartTunnelRespectsContextCancellation(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	url := tunneldServer(t, `{}`)
	d := &Driver{py: "fake-python", tunnelStartTimeout: 5 * time.Second, tunneldURL: url}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	if _, err := d.StartTunnel(ctx); err == nil {
		t.Fatal("expected an error when ctx is cancelled before the tunnel appears")
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

// echoArgs runs op against a driver wired to the echo-args fake and returns the
// exact CLI args the driver built (everything after the bin name).
func echoArgs(t *testing.T, d *Driver, op func() error) string {
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
	d := &Driver{py: "fake-python", base: []string{}}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "fde6:1234::1", 54321, true
	d.mu.Unlock()

	got := echoArgs(t, d, func() error {
		return d.SetLocation(context.Background(), 48.8566, 2.3522)
	})
	for _, want := range []string{
		"developer dvt simulate-location set",
		"--rsd fde6:1234::1 54321",
		"-- 48.8566 2.3522",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("simulate-location args %q missing %q", got, want)
		}
	}
}

func TestClearLocationBuildsClearCommand(t *testing.T) {
	d := &Driver{py: "fake-python", base: []string{}}
	d.mu.Lock()
	d.tunnel.Address, d.tunnel.Port, d.tunnelOn = "fde6:1234::1", 54321, true
	d.mu.Unlock()

	got := echoArgs(t, d, func() error {
		return d.ClearLocation(context.Background())
	})
	for _, want := range []string{"developer dvt simulate-location clear", "--rsd fde6:1234::1 54321"} {
		if !strings.Contains(got, want) {
			t.Errorf("simulate-location clear args %q missing %q", got, want)
		}
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
