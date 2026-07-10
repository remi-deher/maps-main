package driver

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver/exectest"
)

// TestHelperProcess is the re-exec'd "fake daemon" driven by exectest — see
// exectest's doc. The "sleep" scenario just blocks until killed, standing in
// for a real tunnel daemon (`ios tunnel start` / pmd3 `remote tunneld`) that
// keeps running until explicitly torn down.
func TestHelperProcess(t *testing.T) {
	args, scenario, ok := exectest.HelperArgs()
	if !ok {
		return
	}
	switch scenario {
	case "sleep":
		time.Sleep(time.Minute)
	case "noisy-sleep":
		for i := 0; i < 5; i++ {
			writeHelperLine(`INFO:     127.0.0.1:53298 - "GET / HTTP/1.1" 200 OK`)
			writeHelperLine("real daemon warning")
			time.Sleep(10 * time.Millisecond)
		}
		time.Sleep(time.Minute)
	case "record":
		// Used by KillProcessesMatching's test: records the exact command it
		// would have run instead of actually running it, so the test never
		// kills a real process on the machine running `go test`.
		if f := os.Getenv("FAKE_RECORD_FILE"); f != "" {
			line := strings.Join(args[1:], " ") + "\n"
			if fh, err := os.OpenFile(f, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
				_, _ = fh.WriteString(line)
				_ = fh.Close()
			}
		}
	}
	os.Exit(0)
}

func writeHelperLine(line string) {
	if _, err := os.Stdout.WriteString(line + "\n"); err != nil {
		os.Exit(2)
	}
}

// TestStopWaitsForDaemonReap is a regression test for the tunnel-restart race:
// Stop() must not return until the killed daemon has actually been reaped, so
// an immediate Start() that follows doesn't race the still-dying old process
// for the same OS resources (tun adapter, device lock, listening port).
func TestStopWaitsForDaemonReap(t *testing.T) {
	m := &TunnelMount{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := m.Start(ctx, TunnelMountConfig{
		DriverName:   "test",
		StartTimeout: 5 * time.Second,
		PollInterval: 10 * time.Millisecond,
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			return exectest.FakeCommand("sleep")("sleep"), nil
		},
		Resolve: func(context.Context) (TunnelEndpoint, bool) {
			return TunnelEndpoint{Info: TunnelInfo{Address: "127.0.0.1", Port: 1234}}, true
		},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	if err := m.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	// White-box check (same package): by the time Stop() returns, the reaper
	// goroutine must already have closed m.exited — confirming Stop() actually
	// waited for the OS to reap the killed process instead of returning the
	// instant the kill signal was merely issued.
	select {
	case <-m.exited:
	default:
		t.Fatal("Stop() returned before the daemon was reaped")
	}
}

func TestStartTimeoutFiltersDaemonNoiseAndAddsHint(t *testing.T) {
	m := &TunnelMount{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := m.Start(ctx, TunnelMountConfig{
		DriverName:   "test",
		StartTimeout: 80 * time.Millisecond,
		PollInterval: 10 * time.Millisecond,
		TimeoutHint:  "actionable hint",
		StartDaemon: func(context.Context) (*exec.Cmd, error) {
			return exectest.FakeCommand("noisy-sleep")("sleep"), nil
		},
		OutputLineFilter: func(line string) bool {
			return !strings.Contains(line, `"GET / HTTP/1.1" 200 OK`)
		},
		Resolve: func(context.Context) (TunnelEndpoint, bool) {
			return TunnelEndpoint{}, false
		},
	})
	if err == nil {
		t.Fatal("expected timeout")
	}
	msg := err.Error()
	if strings.Contains(msg, "GET / HTTP/1.1") {
		t.Fatalf("timeout error kept filtered polling noise:\n%s", msg)
	}
	if !strings.Contains(msg, "actionable hint") {
		t.Fatalf("timeout error missing hint:\n%s", msg)
	}
	if !strings.Contains(msg, "real daemon warning") {
		t.Fatalf("timeout error should keep non-noise daemon output:\n%s", msg)
	}
}
