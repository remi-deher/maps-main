package discovery

import (
	"context"
	"os/exec"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// Passive mDNS browsing, which is what keeps an iPhone reachable over Wi-Fi.
//
// iOS powers its mDNS responder down when nothing is asking, and a silent
// responder is the usual reason a tunnel daemon can't find a device that is
// plainly on the same network. Holding a browse open nudges it to keep
// announcing.
//
// The browse tool is expected to run until cancelled, so an immediate exit
// means it is failing — the Bonjour service being stopped is the common case on
// Windows, which is exactly why the engine ships a "restart Bonjour" action.
// Respawning on a fixed short delay then turns into a process-spawn storm that
// runs all night and reports nothing, so failures back off and are surfaced.

const (
	// browseRestartDelay is the pause before restarting a browse that ran for a
	// healthy stretch — it exited for an ordinary reason, so retry promptly.
	browseRestartDelay = 2 * time.Second
	// browseRestartMax caps the backoff applied to a browse that keeps dying
	// immediately, so a machine with no working mDNS stack costs one process
	// per minute instead of one every two seconds.
	browseRestartMax = 60 * time.Second
	// minHealthyRun is how long a browse must survive to count as working
	// rather than as an instant failure. A real browse blocks until cancelled;
	// anything this short means the tool refused to start.
	minHealthyRun = 3 * time.Second
	// failuresBeforeWarning is how many instant failures in a row are tolerated
	// before saying so. A single failure during a Bonjour restart is normal and
	// self-corrects; a run of them is not.
	failuresBeforeWarning = 3
)

// WakeLogger receives best-effort network discovery lifecycle messages.
type WakeLogger interface {
	LogMDNSWakeUnavailable(tool string)
	LogMDNSWakeActive()
}

// WakeFailureLogger is an optional extension: loggers implementing it are told
// when the browses stop working and when they recover, instead of the wake
// failing silently after its one "active" line.
type WakeFailureLogger interface {
	LogMDNSWakeFailing(tool string, err string)
	LogMDNSWakeRecovered()
}

// MDNSWaker owns the passive browses. One instance holds every service's
// browse, and starting it again replaces the previous run rather than adding to
// it — RestartMdns calls Start on every invocation, and without this each call
// leaked three goroutines that kept respawning processes forever.
type MDNSWaker struct {
	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}

	// activeBrowses counts the browse loops currently running. It is what makes
	// the "Start replaces, never stacks" guarantee observable — the leak this
	// type exists to fix showed up as this number growing with every restart.
	activeBrowses atomic.Int64
}

// ActiveBrowses reports how many browse loops are running.
func (w *MDNSWaker) ActiveBrowses() int { return int(w.activeBrowses.Load()) }

// Start begins browsing, stopping any previous run first. Safe to call
// repeatedly; ctx cancellation stops everything.
func (w *MDNSWaker) Start(ctx context.Context, logger WakeLogger) {
	w.Stop()

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

	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})

	w.mu.Lock()
	w.cancel = cancel
	w.done = done
	w.mu.Unlock()

	// A shared health view across the services: one warning for "mDNS is not
	// working here", not one per service type.
	health := &wakeHealth{logger: logger, tool: tool}

	var wg sync.WaitGroup
	for _, svc := range AppleMDNSServices {
		wg.Add(1)
		go func(svc string) {
			defer wg.Done()
			w.activeBrowses.Add(1)
			defer w.activeBrowses.Add(-1)
			browseLoop(runCtx, tool, argsFor(svc), health)
		}(svc)
	}
	go func() {
		wg.Wait()
		close(done)
	}()

	if logger != nil {
		logger.LogMDNSWakeActive()
	}
}

// Stop cancels the browses and waits for their processes to be reaped, so a
// caller that immediately restarts doesn't briefly run two sets at once.
func (w *MDNSWaker) Stop() {
	w.mu.Lock()
	cancel, done := w.cancel, w.done
	w.cancel, w.done = nil, nil
	w.mu.Unlock()

	if cancel == nil {
		return
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

// browseLoop keeps one service's browse running, backing off when it can't stay
// up.
func browseLoop(ctx context.Context, tool string, args []string, health *wakeHealth) {
	delay := browseRestartDelay
	for {
		if ctx.Err() != nil {
			return
		}
		started := time.Now()
		err := exec.CommandContext(ctx, tool, args...).Run()
		if ctx.Err() != nil {
			return
		}

		if time.Since(started) >= minHealthyRun {
			// It ran for a while, so the tool works here; treat the exit as
			// ordinary and retry promptly.
			delay = browseRestartDelay
			health.recordSuccess()
		} else {
			health.recordFailure(err)
			delay *= 2
			if delay > browseRestartMax {
				delay = browseRestartMax
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

// wakeHealth turns a run of instant failures into exactly one warning, and the
// first success after that into exactly one recovery message.
type wakeHealth struct {
	logger WakeLogger
	tool   string

	mu       sync.Mutex
	failures int
	warned   bool
}

func (h *wakeHealth) recordFailure(err error) {
	h.mu.Lock()
	h.failures++
	shouldWarn := h.failures >= failuresBeforeWarning && !h.warned
	if shouldWarn {
		h.warned = true
	}
	h.mu.Unlock()

	if !shouldWarn {
		return
	}
	if fl, ok := h.logger.(WakeFailureLogger); ok && fl != nil {
		message := "sortie immédiate"
		if err != nil {
			message = err.Error()
		}
		fl.LogMDNSWakeFailing(h.tool, message)
	}
}

func (h *wakeHealth) recordSuccess() {
	h.mu.Lock()
	wasWarned := h.warned
	h.failures, h.warned = 0, false
	h.mu.Unlock()

	if !wasWarned {
		return
	}
	if fl, ok := h.logger.(WakeFailureLogger); ok && fl != nil {
		fl.LogMDNSWakeRecovered()
	}
}

// StartMDNSWake spawns passive, persistent mDNS browses for Apple device
// services so iPhones stay discoverable by the tunnel daemons.
//
// Deprecated: prefer an MDNSWaker, which can be restarted without leaking the
// previous run's goroutines. Kept for callers that only ever start once.
func StartMDNSWake(ctx context.Context, logger WakeLogger) {
	(&MDNSWaker{}).Start(ctx, logger)
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
