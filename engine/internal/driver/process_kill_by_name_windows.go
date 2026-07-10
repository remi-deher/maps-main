//go:build windows

package driver

import (
	"context"
	"fmt"
	"os/exec"
	"syscall"
)

// killByNameCommandContext indirects exec.CommandContext so tests can
// substitute a fake child process, same as pmd3's execCommandContext.
var killByNameCommandContext = exec.CommandContext

// KillProcessesMatching force-kills every process whose command line contains
// substr, regardless of who started it. Unlike killTree (which only tears
// down a process this engine itself launched and is still tracking), this
// catches orphaned pymobiledevice3 python.exe processes left behind by a
// crashed engine, a killed terminal, or a previous run — the case a plain
// tunnel restart can't fix because there is no *exec.Cmd handle to kill.
func KillProcessesMatching(ctx context.Context, substr string) error {
	script := fmt.Sprintf(
		`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*%s*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
		substr,
	)
	cmd := killByNameCommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("kill processes matching %q: %w: %s", substr, err, out)
	}
	return nil
}
