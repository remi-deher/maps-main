package discovery

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
)

// serviceControlCommandContext indirects exec.CommandContext so tests can
// substitute a fake child process instead of touching the real OS service.
var serviceControlCommandContext = exec.CommandContext

// serviceControlGOOS indirects runtime.GOOS so tests can exercise every
// platform branch of RestartMDNSService without cross-compiling.
var serviceControlGOOS = runtime.GOOS

// RestartMDNSService restarts the OS-level mDNS/Bonjour responder that
// dns-sd/avahi rely on: the "Bonjour Service" on Windows, avahi-daemon on
// Linux, mDNSResponder (via launchd) on macOS. This is distinct from
// BrowseCommand/lookupInstance/resolveHost above, which only ever act as a
// *client* of that service — this restarts the service itself, for the case
// where it has wedged and stopped answering entirely.
func RestartMDNSService(ctx context.Context) error {
	switch serviceControlGOOS {
	case "windows":
		// Best-effort: the service may already be stopped, so ignore the
		// stop's own error and only report a failure to start it back up.
		_ = serviceControlCommandContext(ctx, "net", "stop", "Bonjour Service").Run()
		if out, err := serviceControlCommandContext(ctx, "net", "start", "Bonjour Service").CombinedOutput(); err != nil {
			return fmt.Errorf("restart Bonjour Service: %w: %s", err, out)
		}
		return nil
	case "linux":
		if out, err := serviceControlCommandContext(ctx, "systemctl", "restart", "avahi-daemon").CombinedOutput(); err != nil {
			return fmt.Errorf("restart avahi-daemon: %w: %s", err, out)
		}
		return nil
	case "darwin":
		if out, err := serviceControlCommandContext(ctx, "launchctl", "kickstart", "-k", "system/com.apple.mDNSResponder").CombinedOutput(); err != nil {
			return fmt.Errorf("restart mDNSResponder: %w: %s", err, out)
		}
		return nil
	default:
		return fmt.Errorf("restart mDNS service: unsupported platform %q", serviceControlGOOS)
	}
}
