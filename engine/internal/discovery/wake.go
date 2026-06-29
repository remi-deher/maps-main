package discovery

import (
	"context"
	"os/exec"
	"runtime"
	"time"
)

// WakeLogger receives best-effort network discovery lifecycle messages.
type WakeLogger interface {
	LogMDNSWakeUnavailable(tool string)
	LogMDNSWakeActive()
}

// StartMDNSWake spawns passive, persistent mDNS browses for Apple device
// services so iPhones stay discoverable by the tunnel daemons.
func StartMDNSWake(ctx context.Context, logger WakeLogger) {
	tool, argsFor := PassiveBrowseCommand()
	if tool == "" {
		return
	}
	if _, err := exec.LookPath(tool); err != nil {
		if logger != nil {
			logger.LogMDNSWakeUnavailable(tool)
		}
		return
	}

	for _, svc := range AppleMDNSServices {
		go func(svc string) {
			for {
				if ctx.Err() != nil {
					return
				}
				_ = exec.CommandContext(ctx, tool, argsFor(svc)...).Run()
				if ctx.Err() != nil {
					return
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
				}
			}
		}(svc)
	}

	if logger != nil {
		logger.LogMDNSWakeActive()
	}
}

// PassiveBrowseCommand returns the platform's mDNS browse tool and an arg
// builder for a passive browse of one service type.
func PassiveBrowseCommand() (string, func(svc string) []string) {
	switch runtime.GOOS {
	case "windows", "darwin":
		return "dns-sd", func(svc string) []string { return []string{"-B", svc} }
	case "linux":
		return "avahi-browse", func(svc string) []string { return []string{"-r", svc} }
	default:
		return "", nil
	}
}
