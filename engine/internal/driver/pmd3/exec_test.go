package pmd3

// Mirrors goios's exec_test.go: exercises the real exec.Command/CommandContext
// code paths (tunnel spawn + RSD parsing, mounter best-effort, timeout, ctx
// cancellation, list/run failures) without a real python/pymobiledevice3
// install, using the same fake-subprocess re-exec technique os/exec's own
// tests use.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
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

	// args[0] is the python interpreter ("name" passed to exec.Command);
	// args[1:] are the pymobiledevice3 CLI args. Only "remote tunneld" should
	// block like the real long-running daemon — other commands (e.g.
	// simulate-location, run under the same "tunnel-daemon" scenario in an
	// end-to-end test) must return immediately.
	isTunneld := len(args) >= 3 && args[1] == "remote" && args[2] == "tunneld"
	isLocationWorker := len(args) >= 4 && args[1] == "-u" && args[2] == "-c"

	if isLocationWorker {
		runLocationWorkerHelper()
		return
	}

	switch scenario {
	case "tunnel-daemon":
		if isTunneld {
			time.Sleep(10 * time.Second) // `remote tunneld` runs until killed
		}
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

func runLocationWorkerHelper() {
	// Simulates a worker that never reaches the ready handshake — e.g. a
	// userspace tunnel that can't be built because the device isn't there.
	if os.Getenv("FAKE_WORKER_NO_READY") != "" {
		time.Sleep(30 * time.Second)
		return
	}
	fmt.Println(`{"ok":true,"ready":true}`)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		line := sc.Text()
		if f := os.Getenv("FAKE_LOCATION_FILE"); f != "" {
			_ = appendLine(f, line)
		}
		var req struct {
			Action string `json:"action"`
		}
		_ = json.Unmarshal([]byte(line), &req)
		if req.Action == os.Getenv("FAKE_LOCATION_FAIL_ACTION") {
			fmt.Println(`{"ok":false,"error":"simulated worker failure"}`)
			continue
		}
		fmt.Println(`{"ok":true}`)
		if req.Action == "stop" {
			return
		}
	}
}

func appendLine(path, line string) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	_, err = f.WriteString(line + "\n")
	return err
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
	if got := d.mount.UDID(); got != "udid-1" {
		t.Errorf("udid after start = %q, want udid-1", got)
	}

	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel: %v", err)
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("expected no active tunnel after StopTunnel")
	}
}

// tunneld needs administrator rights to create its TUN adapter. When it can't
// (no elevation), the driver must not give up: it falls back to the no-admin
// tunnel that the location worker builds in-process.
func TestStartTunnelFallsBackToUserspaceWhenTunneldPublishesNothing(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	url := tunneldServer(t, `{}`) // daemon up, but no tunnel ever registered
	d := &Driver{py: "fake-python", tunnelStartTimeout: 200 * time.Millisecond, tunneldURL: url}

	ti, err := d.StartTunnel(context.Background())
	if err != nil {
		t.Fatalf("StartTunnel: %v", err)
	}
	if !d.IsUserspace() {
		t.Error("expected the driver to be in userspace mode after the tunneld attempt failed")
	}
	if ti.Address != userspaceEndpoint.Address {
		t.Errorf("endpoint = %+v, want the in-process marker %q", ti, userspaceEndpoint.Address)
	}
	if _, ok := d.Tunnel(); !ok {
		t.Error("expected an active tunnel after the userspace fallback")
	}

	// The worker built the tunnel, so it is already open and injection must
	// reuse it rather than try to rebuild a session from an endpoint.
	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Errorf("SetLocation over the userspace tunnel: %v", err)
	}
	// There is no socket to dial, so health is the worker answering.
	if !d.CheckHealth(context.Background()) {
		t.Error("CheckHealth = false while the userspace worker is alive")
	}

	if err := d.StopTunnel(context.Background()); err != nil {
		t.Errorf("StopTunnel: %v", err)
	}
	if d.IsUserspace() {
		t.Error("userspace mode should be cleared once the tunnel is stopped")
	}
}

// The fallback is a fallback, not a mask: when the worker can't build a tunnel
// either, StartTunnel has to fail rather than report a tunnel that isn't there.
func TestStartTunnelFailsWhenBothTunneldAndUserspaceFail(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	t.Setenv("FAKE_WORKER_NO_READY", "1")
	url := tunneldServer(t, `{}`)
	d := &Driver{py: "fake-python", tunnelStartTimeout: 200 * time.Millisecond, tunneldURL: url}

	if _, err := d.StartTunnel(context.Background()); err == nil {
		t.Fatal("expected an error when neither tunneld nor the userspace tunnel comes up")
	}
	if _, ok := d.Tunnel(); ok {
		t.Error("no tunnel should be registered after both attempts failed")
	}
}

// The worker is told which tunnel to use, and how. Locks the invocation the
// same way the other driver command shapes are locked.
func TestUserspaceWorkerArgs(t *testing.T) {
	d := &Driver{}
	if got := d.userspaceWorkerArgs(); strings.Join(got, " ") != "--userspace" {
		t.Errorf("userspaceWorkerArgs() = %v, want [--userspace]", got)
	}

	d = &Driver{targetUDID: "udid-1"}
	if got := strings.Join(d.userspaceWorkerArgs(), " "); got != "--userspace --udid udid-1" {
		t.Errorf("userspaceWorkerArgs() = %q, want \"--userspace --udid udid-1\"", got)
	}

	ti := driver.TunnelInfo{Address: "fde6::1", Port: 54321}
	if got := strings.Join(rsdWorkerArgs(ti), " "); got != "--rsd fde6::1 54321" {
		t.Errorf("rsdWorkerArgs() = %q, want \"--rsd fde6::1 54321\"", got)
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

func TestSetLocationUsesPersistentWorker(t *testing.T) {
	withFakeExec(t, "cmd-ok")
	d := &Driver{py: "fake-python", base: []string{}}
	d.mount.SetActive(driver.TunnelInfo{Address: "10.0.0.1", Port: 1234}, "")

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Errorf("SetLocation: %v", err)
	}
	t.Cleanup(func() { _ = d.stopLocationSession(context.Background()) })
	first := d.location
	if first == nil {
		t.Fatal("expected a persistent location worker")
	}
	if err := d.SetLocation(context.Background(), 40.6892, -74.0445); err != nil {
		t.Errorf("second SetLocation: %v", err)
	}
	if d.location != first {
		t.Error("expected second SetLocation to reuse the same worker")
	}
}

func TestSetLocationSurfacesWorkerFailure(t *testing.T) {
	t.Setenv("FAKE_LOCATION_FAIL_ACTION", "set")
	withFakeExec(t, "cmd-ok")
	d := &Driver{py: "fake-python", base: []string{}}
	d.mount.SetActive(driver.TunnelInfo{Address: "10.0.0.1", Port: 1234}, "")
	t.Cleanup(func() { _ = d.stopLocationSession(context.Background()) })

	err := d.SetLocation(context.Background(), 48.8566, 2.3522)
	if err == nil || !strings.Contains(err.Error(), "simulated worker failure") {
		t.Fatalf("SetLocation error = %v, want simulated worker failure", err)
	}
}

func TestLocationWorkerReceivesSetClearStopProtocol(t *testing.T) {
	commandsFile := filepath.Join(t.TempDir(), "commands.jsonl")
	t.Setenv("FAKE_LOCATION_FILE", commandsFile)
	withFakeExec(t, "cmd-ok")

	d := &Driver{py: "fake-python", base: []string{}}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321}, "")

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Fatalf("SetLocation: %v", err)
	}
	if err := d.SetLocation(context.Background(), 40.6892, -74.0445); err != nil {
		t.Fatalf("second SetLocation: %v", err)
	}
	if err := d.ClearLocation(context.Background()); err != nil {
		t.Fatalf("ClearLocation: %v", err)
	}

	got := readLines(t, commandsFile)
	wantActions := []string{"set", "set", "clear", "stop"}
	if len(got) != len(wantActions) {
		t.Fatalf("commands = %v, want %d commands", got, len(wantActions))
	}
	for i, want := range wantActions {
		if !strings.Contains(got[i], `"action":"`+want+`"`) {
			t.Errorf("command[%d] = %q, want action %q", i, got[i], want)
		}
	}
	if !strings.Contains(got[0], `"lat":48.8566`) || !strings.Contains(got[0], `"lon":2.3522`) {
		t.Errorf("first set command = %q, want Paris coordinates", got[0])
	}
}

// TestEndToEndTunnelLifecycle chains StartTunnel -> SetLocation -> ClearLocation
// -> StopTunnel against the fake CLI + a mocked tunneld API, asserting the
// driver's state transitions at each step (the closest thing to a
// mocked-device conformance check without a real iPhone).
func TestEndToEndTunnelLifecycle(t *testing.T) {
	withFakeExec(t, "tunnel-daemon")
	url := tunneldServer(t, `{"udid-1":[{"tunnel-address":"fde6:1234::1","tunnel-port":54321,"interface":"utun6"}]}`)
	d := &Driver{py: "fake-python", tunnelStartTimeout: 5 * time.Second, tunneldURL: url}

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
	if got := d.mount.UDID(); got != "udid-1" {
		t.Fatalf("udid after start = %q, want udid-1", got)
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
	d.mount.SetActive(driver.TunnelInfo{Address: host, Port: portNum}, "")

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
	d.mount.SetActive(driver.TunnelInfo{Address: host, Port: portNum}, "")

	if d.CheckHealth(context.Background()) {
		t.Error("expected CheckHealth to fail against a closed port")
	}
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// While the device screen is locked the tunnel daemon reassigns the RSD address
// repeatedly. Each move discards the worker bound to the old address — and that
// worker is the one most likely to be stuck mid-connect on it, so asking it to
// stop is asking the question it can't answer. The wait was bounded, but it was
// held under locMu, freezing every injection for up to workerStartTimeout each
// time the address changed. It is killed outright instead.
func TestMovedEndpointDiscardsTheWorkerWithoutAskingItToStop(t *testing.T) {
	commandsFile := filepath.Join(t.TempDir(), "commands.jsonl")
	t.Setenv("FAKE_LOCATION_FILE", commandsFile)
	withFakeExec(t, "cmd-ok")

	d := &Driver{py: "fake-python", base: []string{}}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6::1", Port: 54321}, "")
	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Fatalf("SetLocation: %v", err)
	}
	first := d.location
	if first == nil {
		t.Fatal("expected a worker after the first injection")
	}

	// The daemon moved the device to a new RSD port.
	d.mount.UpdateInfo(driver.TunnelInfo{Address: "fde6::1", Port: 65000})

	start := time.Now()
	if err := d.SetLocation(context.Background(), 40.6892, -74.0445); err != nil {
		t.Fatalf("SetLocation after the endpoint moved: %v", err)
	}
	elapsed := time.Since(start)
	t.Cleanup(func() { _ = d.stopLocationSession(context.Background()) })

	if d.location == first {
		t.Error("expected a fresh worker bound to the new endpoint")
	}
	if elapsed >= workerStartTimeout {
		t.Errorf("rebinding took %s, want well under the %s stop timeout", elapsed, workerStartTimeout)
	}

	// The discarded worker must not have been sent a "stop" — that round-trip
	// is the thing that used to hang.
	for _, line := range readLines(t, commandsFile) {
		if strings.Contains(line, `"action":"stop"`) {
			t.Errorf("a stop was sent to the stale worker: %q", line)
		}
	}
}
