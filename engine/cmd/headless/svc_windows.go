//go:build windows

package main

import (
	"context"

	"golang.org/x/sys/windows/svc"
)

// isWindowsService reports whether the process was started by the Windows
// Service Control Manager.
func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// runService runs the engine under the Windows service control protocol.
func runService(cfg runConfig) error {
	return svc.Run("gpsmock", &serviceHandler{cfg: cfg})
}

type serviceHandler struct{ cfg runConfig }

func (h *serviceHandler) Execute(_ []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown

	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		_ = runEngine(ctx, h.cfg)
		close(done)
	}()

	status <- svc.Status{State: svc.Running, Accepts: accepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			}
		case <-done:
			return false, 0
		}
	}
}
