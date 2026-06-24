//go:build windows

package driver

import (
	"os/exec"
	"strconv"
	"syscall"
)

// configureProcAttr starts the process in a new process group so taskkill can
// target its whole tree and so a Ctrl-C in the parent console doesn't propagate
// to it prematurely.
func configureProcAttr(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP
}

// killTree terminates cmd and every descendant. taskkill /T walks the process
// tree from the given PID; /F forces termination. We fall back to a direct kill
// if taskkill is unavailable (e.g. stripped-down Windows images).
func killTree(cmd *exec.Cmd) error {
	pid := cmd.Process.Pid
	kc := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
	kc.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := kc.Run(); err != nil {
		return cmd.Process.Kill()
	}
	return nil
}
