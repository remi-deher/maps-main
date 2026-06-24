//go:build !windows

package driver

import (
	"os/exec"
	"syscall"
)

// configureProcAttr puts the process in its own process group (Setpgid) so
// killTree can signal the whole group — the tunnel daemons fork children that
// would otherwise survive a kill aimed only at the launcher.
func configureProcAttr(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// killTree terminates cmd and every descendant. When the process was started in
// its own group (configureProcAttr), signalling the negative PID delivers
// SIGKILL to the entire group; otherwise we fall back to killing the process.
func killTree(cmd *exec.Cmd) error {
	if cmd.SysProcAttr != nil && cmd.SysProcAttr.Setpgid {
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err == nil {
			return nil
		}
	}
	return cmd.Process.Kill()
}
