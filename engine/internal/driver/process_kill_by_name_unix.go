//go:build !windows

package driver

import (
	"context"
	"fmt"
	"os/exec"
)

// killByNameCommandContext indirects exec.CommandContext so tests can
// substitute a fake child process, same as pmd3's execCommandContext.
var killByNameCommandContext = exec.CommandContext

// KillProcessesMatching force-kills every process whose command line contains
// substr, regardless of who started it. Unlike killTree (which only tears
// down a process this engine itself launched and is still tracking), this
// catches orphaned pymobiledevice3 processes left behind by a crashed engine,
// a killed terminal, or a previous run — the case a plain tunnel restart
// can't fix because there is no *exec.Cmd handle to kill.
func KillProcessesMatching(ctx context.Context, substr string) error {
	cmd := killByNameCommandContext(ctx, "pkill", "-f", substr)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	// pkill exits 1 when no process matched — not an error for our purposes.
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
		return nil
	}
	return fmt.Errorf("kill processes matching %q: %w: %s", substr, err, out)
}
