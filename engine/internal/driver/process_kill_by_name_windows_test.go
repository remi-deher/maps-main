//go:build windows

package driver

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/driver/exectest"
)

// TestKillProcessesMatchingBuildsPowerShellFilter uses the shared "record"
// scenario (see TestHelperProcess in tunnel_mount_test.go) so the PowerShell
// command is captured instead of actually run — this must never kill a real
// process on the machine running `go test`.
func TestKillProcessesMatchingBuildsPowerShellFilter(t *testing.T) {
	f := t.TempDir() + "\\calls.log"
	t.Setenv("FAKE_RECORD_FILE", f)
	orig := killByNameCommandContext
	killByNameCommandContext = exectest.FakeCommandContext("record")
	t.Cleanup(func() { killByNameCommandContext = orig })

	if err := KillProcessesMatching(context.Background(), "pymobiledevice3"); err != nil {
		t.Fatalf("KillProcessesMatching: %v", err)
	}

	b, err := os.ReadFile(f)
	if err != nil {
		t.Fatalf("read recorded call: %v", err)
	}
	got := string(b)
	if !strings.Contains(got, "Stop-Process") || !strings.Contains(got, "*pymobiledevice3*") {
		t.Errorf("recorded PowerShell command = %q, want it to filter on pymobiledevice3 and Stop-Process", got)
	}
}
