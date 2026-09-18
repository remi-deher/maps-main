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
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
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
	case "image-mounted":
		// `ios image list` reports one mounted image; every other command is a
		// no-op so a caller can assert which ones were spawned at all.
		if sub == "image list" {
			fmt.Println(`[{"ImageSignature":"deadbeef"}]`)
		}
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
	if got := d.mount.UDID(); got != "udid-1" {
		t.Errorf("udid after start = %q, want udid-1", got)
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
	d.mount.SetActive(driver.TunnelInfo{Address: "10.0.0.1", Port: 1234}, "")

	if err := d.SetLocation(context.Background(), 48.8566, 2.3522); err != nil {
		t.Errorf("SetLocation: %v", err)
	}
}

func TestSetLocationSurfacesCommandFailure(t *testing.T) {
	withFakeExec(t, "cmd-fail")
	d := &Driver{bin: "fake-ios"}
	d.mount.SetActive(driver.TunnelInfo{Address: "10.0.0.1", Port: 1234}, "")

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
	// lockdownArgs set (as New() does whenever LockdownDir() finds a real
	// pairing folder) to catch the regression where --pair-record-path was
	// appended to setlocation: go-ios only recognizes that flag on `tunnel
	// start` and rejects any other command using it as invalid usage.
	d := &Driver{bin: "fake-ios", lockdownArgs: []string{"--pair-record-path=/some/dir"}}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321}, "")

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
	if strings.Contains(got, "pair-record-path") {
		t.Errorf("setlocation args %q must not include --pair-record-path (only valid on tunnel start)", got)
	}
}

func TestSetLocationAddsUserspacePortForUserspaceTunnel(t *testing.T) {
	d := &Driver{bin: "fake-ios"}
	// A userspace tunnel: SetLocation must reach the device through the local
	// proxy port via --userspace-port, on top of the usual address/rsd-port.
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321, UserspacePort: 61000}, "")

	got := echoArgs(t, func() error {
		return d.SetLocation(context.Background(), 48.8566, 2.3522)
	})
	if !strings.Contains(got, "--userspace-port=61000") {
		t.Errorf("setlocation args %q missing --userspace-port for a userspace tunnel", got)
	}
}

func TestSetLocationOmitsUserspacePortForKernelTunnel(t *testing.T) {
	d := &Driver{bin: "fake-ios"}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321}, "") // UserspacePort 0

	got := echoArgs(t, func() error {
		return d.SetLocation(context.Background(), 48.8566, 2.3522)
	})
	if strings.Contains(got, "userspace-port") {
		t.Errorf("setlocation args %q must not include --userspace-port for a kernel-TUN tunnel", got)
	}
}

func TestTunnelStartArgsAddsUserspaceOnlyInUserspaceMode(t *testing.T) {
	d := &Driver{bin: "fake-ios", udid: "udid-1", lockdownArgs: []string{"--pair-record-path=/some/dir"}}

	kernel := strings.Join(d.tunnelStartArgs(false), " ")
	if strings.Contains(kernel, "--userspace") {
		t.Errorf("kernel-TUN args %q must not include --userspace", kernel)
	}
	for _, want := range []string{"tunnel start", "--pair-record-path=/some/dir", "--tunnel-info-port=", "--udid=udid-1"} {
		if !strings.Contains(kernel, want) {
			t.Errorf("kernel-TUN args %q missing %q", kernel, want)
		}
	}

	userspace := strings.Join(d.tunnelStartArgs(true), " ")
	if !strings.Contains(userspace, "--userspace") {
		t.Errorf("userspace args %q must include --userspace", userspace)
	}
}

func TestClearLocationBuildsResetCommand(t *testing.T) {
	d := &Driver{bin: "fake-ios", lockdownArgs: []string{"--pair-record-path=/some/dir"}}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321}, "")

	got := echoArgs(t, func() error {
		return d.ClearLocation(context.Background())
	})
	for _, want := range []string{"resetlocation", "--address=fde6:1234::1", "--rsd-port=54321"} {
		if !strings.Contains(got, want) {
			t.Errorf("resetlocation args %q missing %q", got, want)
		}
	}
	if strings.Contains(got, "pair-record-path") {
		t.Errorf("resetlocation args %q must not include --pair-record-path (only valid on tunnel start)", got)
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
	_ = ln.Close() // close it immediately so nothing is listening

	d := &Driver{}
	d.mount.SetActive(driver.TunnelInfo{Address: host, Port: portNum}, "")

	if d.CheckHealth(context.Background()) {
		t.Error("expected CheckHealth to fail against a closed port")
	}
}

// TestDeviceDetailsKeepsPinnedUDID guards the regression where DeviceDetails
// took devices[0] unconditionally and wrote it back to d.udid: on a machine
// with two devices attached, one diagnostics request re-pointed every
// subsequent `setlocation --udid=` at the wrong iPhone.
func TestDeviceDetailsKeepsPinnedUDID(t *testing.T) {
	withFakeExec(t, "info-ok")
	d := &Driver{bin: "fake-ios", targetUDID: "udid-2", udid: "udid-2"}

	if _, err := d.DeviceDetails(context.Background()); err != nil {
		t.Fatalf("DeviceDetails: %v", err)
	}
	if got := d.getUDID(context.Background()); got != "udid-2" {
		t.Errorf("pinned UDID became %q after DeviceDetails, want it untouched", got)
	}
}

// TestDeviceDetailsQueriesPinnedDevice checks the pinned UDID is the one `ios
// info` is actually asked about — and that no `ios list` round-trip is needed
// to find it.
func TestDeviceDetailsQueriesPinnedDevice(t *testing.T) {
	d := &Driver{bin: "fake-ios", targetUDID: "udid-2", udid: "udid-2"}
	got := echoArgs(t, func() error {
		_, err := d.DeviceDetails(context.Background())
		// The echo-args fake prints nothing, so the JSON decode fails; the args
		// it recorded are what this test is about.
		_ = err
		return nil
	})
	if !strings.Contains(got, "--udid=udid-2") {
		t.Errorf("info args %q must target the pinned device", got)
	}
}

// TestConcurrentDriverAccessIsRaceFree exercises the access pattern the engine
// actually produces: the health monitor probing device state every few seconds,
// the simulation ticker injecting once a second, and inbound diagnostics
// requests — all on one shared Driver. The lazily-resolved binary path and the
// discovered UDID were plain fields written from each of those paths, so this
// only means anything under -race.
func TestConcurrentDriverAccessIsRaceFree(t *testing.T) {
	withFakeExec(t, "list-ok")
	d := &Driver{binPaths: map[string]string{}, bin: "fake-ios"}
	d.mount.SetActive(driver.TunnelInfo{Address: "fde6:1234::1", Port: 54321}, "udid-1")

	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); _ = d.SetLocation(ctx, 48.85, 2.35) }()
		go func() { defer wg.Done(); d.ProbeDeviceState(ctx) }()
		go func() { defer wg.Done(); _, _ = d.DeviceDetails(ctx) }()
	}
	wg.Wait()
}

// recordExec swaps the package's exec indirection for one that records every
// argument list the driver builds, while each spawned "process" exits
// immediately (so a tunnel daemon is always seen as dying before a tunnel
// appears). Returns a snapshot function for the recorded invocations.
func recordExec(t *testing.T) func() []string {
	t.Helper()
	return recordExecScenario(t, "cmd-ok")
}

// recordExecScenario is recordExec with a caller-chosen fake scenario, for
// tests that need the child process to answer with something specific.
func recordExecScenario(t *testing.T, scenario string) func() []string {
	t.Helper()
	var mu sync.Mutex
	var calls []string

	record := func(arg []string) {
		mu.Lock()
		calls = append(calls, strings.Join(arg, " "))
		mu.Unlock()
	}
	origCommand, origCommandContext := execCommand, execCommandContext
	execCommand = func(name string, arg ...string) *exec.Cmd {
		record(arg)
		return exectest.FakeCommand(scenario)(name, arg...)
	}
	execCommandContext = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		record(arg)
		return exectest.FakeCommandContext(scenario)(ctx, name, arg...)
	}
	t.Cleanup(func() { execCommand, execCommandContext = origCommand, origCommandContext })

	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), calls...)
	}
}

func containsArg(calls []string, want string) bool {
	for _, c := range calls {
		if strings.Contains(c, want) {
			return true
		}
	}
	return false
}

// TestStartTunnelFallsBackToUserspace is the regression for the bug that made
// the no-admin path unreachable: when the kernel-TUN attempt fails, StartTunnel
// must retry with --userspace. Creating the kernel TUN adapter needs
// administrator rights, so on a machine without them this second attempt is the
// only one that can ever succeed.
func TestStartTunnelFallsBackToUserspace(t *testing.T) {
	calls := recordExec(t)
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 500 * time.Millisecond}

	if _, err := d.StartTunnel(context.Background()); err == nil {
		t.Fatal("expected StartTunnel to fail when no tunnel ever appears")
	}
	got := calls()
	if !containsArg(got, "tunnel start") {
		t.Fatalf("no kernel-TUN attempt in %v", got)
	}
	if !containsArg(got, "--userspace") {
		t.Errorf("no userspace fallback attempt in %v", got)
	}
}

// TestStartTunnelSkipsFallbackOnCancelledContext is the other half of the
// contract: a caller that cancelled (shutdown, driver switch) must not have a
// second tunnel started behind its back. This is also why the *caller's*
// deadline has to cover both attempts — see driver.StartBudget.
func TestStartTunnelSkipsFallbackOnCancelledContext(t *testing.T) {
	calls := recordExec(t)
	d := &Driver{bin: "fake-ios", tunnelStartTimeout: 5 * time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.StartTunnel(ctx); err == nil {
		t.Fatal("expected StartTunnel to fail once the context is done")
	}
	if got := calls(); containsArg(got, "--userspace") {
		t.Errorf("userspace fallback must not run after the caller gave up: %v", got)
	}
}

// TestTunnelInfoPortIsConfigurable pins that the agent is launched on the port
// we then query. The port used to be a package constant, so two engines on one
// machine (a Windows service beside the desktop app, two cluster nodes) fought
// over it — the arrangement go-ios itself recommends is one agent per device on
// its own --tunnel-info-port.
func TestTunnelInfoPortIsConfigurable(t *testing.T) {
	d := &Driver{bin: "fake-ios", tunnelInfoPort: 28777}

	if got := d.tunnelsURL(); got != "http://127.0.0.1:28777/tunnels" {
		t.Errorf("tunnelsURL = %q, must follow the configured port", got)
	}
	args := strings.Join(d.tunnelStartArgs(false), " ")
	if !strings.Contains(args, "--tunnel-info-port=28777") {
		t.Errorf("tunnel start args %q must launch the agent on the configured port", args)
	}
}

// TestBeforeStartDoesNotSpawnStopagent covers the switch away from `ios tunnel
// stopagent`: that command accepts no options, so it could only ever target
// go-ios's default port — missing our own agent on a custom port while killing
// agents belonging to another engine or to a tunnel the user started by hand.
func TestBeforeStartDoesNotSpawnStopagent(t *testing.T) {
	calls := recordExec(t)
	d := &Driver{bin: "fake-ios", tunnelInfoPort: 28778, tunnelStartTimeout: 200 * time.Millisecond}

	_, _ = d.StartTunnel(context.Background())
	if got := calls(); containsArg(got, "stopagent") {
		t.Errorf("stopagent must not be spawned any more, got %v", got)
	}
}

// TestMountIsSkippedWhenTheImageIsAlreadyMounted covers the expensive step the
// retry loop used to repeat: `ios image auto` personalizes the image through
// Apple's signing server (bounded at 60s) and ran before every tunnel attempt,
// holding the engine's tunnel lock, to redo device-side state that had not
// changed. The cheap `ios image list` answers the question instead.
func TestMountIsSkippedWhenTheImageIsAlreadyMounted(t *testing.T) {
	calls := recordExecScenario(t, "image-mounted")
	d := &Driver{bin: "fake-ios", udid: "udid-1", tunnelStartTimeout: 200 * time.Millisecond}

	_, _ = d.StartTunnel(context.Background())
	got := calls()
	if !containsArg(got, "image list") {
		t.Fatalf("expected the cheap mount check to run, got %v", got)
	}
	if containsArg(got, "image auto") {
		t.Errorf("must not re-mount an image already reported as mounted: %v", got)
	}
	if !d.mountGate.Mounted("udid-1") {
		t.Error("an observed mount must be remembered so the next retry skips the check too")
	}
}

// TestMountRunsWhenTheImageIsMissing is the other half: a failure to observe a
// mounted image must never be cached, because that is exactly the case where
// retrying is what fixes it (device locked, or offline at the time).
func TestMountRunsWhenTheImageIsMissing(t *testing.T) {
	calls := recordExec(t) // "cmd-ok" prints no JSON, so the probe cannot conclude
	d := &Driver{bin: "fake-ios", udid: "udid-1", tunnelStartTimeout: 200 * time.Millisecond}

	_, _ = d.StartTunnel(context.Background())
	if got := calls(); !containsArg(got, "image auto") {
		t.Errorf("expected a mount attempt when the image state is unknown, got %v", got)
	}
}
