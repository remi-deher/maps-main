package discovery

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/driver/exectest"
)

// withFakeServiceControl swaps serviceControlCommandContext for a fake child
// process that records every invocation to argsFile (one line per call,
// space-joined) instead of touching a real OS service — RestartMDNSService
// must never run "net stop/start", "systemctl", or "launchctl" for real in a
// test.
func withFakeServiceControl(t *testing.T, argsFile string) {
	t.Helper()
	t.Setenv("FAKE_RECORD_FILE", argsFile)
	orig := serviceControlCommandContext
	serviceControlCommandContext = exectest.FakeCommandContext("record")
	t.Cleanup(func() { serviceControlCommandContext = orig })
}

func TestHelperProcess(t *testing.T) {
	args, scenario, ok := exectest.HelperArgs()
	if !ok {
		return
	}
	defer os.Exit(0)
	if scenario == "record" {
		if f := os.Getenv("FAKE_RECORD_FILE"); f != "" {
			line := strings.Join(args[1:], " ") + "\n"
			fh, err := os.OpenFile(f, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
			if err == nil {
				_, _ = fh.WriteString(line)
				_ = fh.Close()
			}
		}
	}
}

func readRecordedCalls(t *testing.T, path string) []string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

func TestRestartMDNSServiceWindows(t *testing.T) {
	f := t.TempDir() + "/calls.log"
	withFakeServiceControl(t, f)
	orig := serviceControlGOOS
	serviceControlGOOS = "windows"
	t.Cleanup(func() { serviceControlGOOS = orig })

	if err := RestartMDNSService(context.Background()); err != nil {
		t.Fatalf("RestartMDNSService: %v", err)
	}
	calls := readRecordedCalls(t, f)
	if len(calls) != 2 {
		t.Fatalf("calls = %v, want 2 (stop + start)", calls)
	}
	if !strings.Contains(calls[0], "stop Bonjour Service") {
		t.Errorf("first call = %q, want a 'net stop Bonjour Service'", calls[0])
	}
	if !strings.Contains(calls[1], "start Bonjour Service") {
		t.Errorf("second call = %q, want a 'net start Bonjour Service'", calls[1])
	}
}

func TestRestartMDNSServiceLinux(t *testing.T) {
	f := t.TempDir() + "/calls.log"
	withFakeServiceControl(t, f)
	orig := serviceControlGOOS
	serviceControlGOOS = "linux"
	t.Cleanup(func() { serviceControlGOOS = orig })

	if err := RestartMDNSService(context.Background()); err != nil {
		t.Fatalf("RestartMDNSService: %v", err)
	}
	calls := readRecordedCalls(t, f)
	if len(calls) != 1 || !strings.Contains(calls[0], "restart avahi-daemon") {
		t.Errorf("calls = %v, want a single 'systemctl restart avahi-daemon'", calls)
	}
}

func TestRestartMDNSServiceMacOS(t *testing.T) {
	f := t.TempDir() + "/calls.log"
	withFakeServiceControl(t, f)
	orig := serviceControlGOOS
	serviceControlGOOS = "darwin"
	t.Cleanup(func() { serviceControlGOOS = orig })

	if err := RestartMDNSService(context.Background()); err != nil {
		t.Fatalf("RestartMDNSService: %v", err)
	}
	calls := readRecordedCalls(t, f)
	if len(calls) != 1 || !strings.Contains(calls[0], "kickstart -k system/com.apple.mDNSResponder") {
		t.Errorf("calls = %v, want a single 'launchctl kickstart -k system/com.apple.mDNSResponder'", calls)
	}
}

func TestRestartMDNSServiceUnsupportedPlatform(t *testing.T) {
	orig := serviceControlGOOS
	serviceControlGOOS = "plan9"
	t.Cleanup(func() { serviceControlGOOS = orig })

	if err := RestartMDNSService(context.Background()); err == nil {
		t.Error("expected an error on an unsupported platform")
	}
}
