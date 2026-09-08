package discovery

import (
	"errors"
	"os/exec"
	"sync"
	"testing"
	"time"
)

type recordingLogger struct {
	mu          sync.Mutex
	unavailable []string
	active      int
	failing     []string
	recovered   int
}

func (l *recordingLogger) LogMDNSWakeUnavailable(tool string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.unavailable = append(l.unavailable, tool)
}

func (l *recordingLogger) LogMDNSWakeActive() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.active++
}

func (l *recordingLogger) LogMDNSWakeFailing(_, reason string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failing = append(l.failing, reason)
}

func (l *recordingLogger) LogMDNSWakeRecovered() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.recovered++
}

func (l *recordingLogger) counts() (failing, recovered int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.failing), l.recovered
}

// The browses are meant to run until cancelled, so a run of instant exits means
// the host's mDNS stack is down. That has to be said — once — instead of the
// wake failing silently behind its one "active" line.
func TestWakeHealthWarnsOnceThenRecoversOnce(t *testing.T) {
	logger := &recordingLogger{}
	health := &wakeHealth{logger: logger, tool: "dns-sd"}

	// Below the threshold: a single failure during a Bonjour restart is normal
	// and must not cry wolf.
	for range failuresBeforeWarning - 1 {
		health.recordFailure(errors.New("exit status 1"))
	}
	if failing, _ := logger.counts(); failing != 0 {
		t.Fatalf("warned after %d failures, want silence below the threshold", failuresBeforeWarning-1)
	}

	health.recordFailure(errors.New("exit status 1"))
	if failing, _ := logger.counts(); failing != 1 {
		t.Fatalf("failing warnings = %d, want exactly 1", failing)
	}

	// Still broken: keep quiet rather than repeat every couple of seconds.
	for range 10 {
		health.recordFailure(errors.New("exit status 1"))
	}
	if failing, _ := logger.counts(); failing != 1 {
		t.Errorf("failing warnings = %d, want the warning not to repeat", failing)
	}

	health.recordSuccess()
	if _, recovered := logger.counts(); recovered != 1 {
		t.Errorf("recovered messages = %d, want exactly 1", recovered)
	}

	// A success with nothing to recover from must stay silent.
	health.recordSuccess()
	if _, recovered := logger.counts(); recovered != 1 {
		t.Errorf("recovered messages = %d, want no message when nothing was broken", recovered)
	}
}

// A browse that has been running fine and then exits is an ordinary event, not
// a failure — it must not count towards the outage warning.
func TestWakeHealthResetsAfterAHealthyRun(t *testing.T) {
	logger := &recordingLogger{}
	health := &wakeHealth{logger: logger, tool: "dns-sd"}

	for range failuresBeforeWarning - 1 {
		health.recordFailure(nil)
	}
	health.recordSuccess()
	health.recordFailure(nil)

	if failing, _ := logger.counts(); failing != 0 {
		t.Errorf("failing warnings = %d, want the counter reset by the healthy run", failing)
	}
}

// Start replaces the previous run. RestartMdns calls it on every invocation, and
// before the waker owned its browses each call leaked a set of goroutines that
// went on respawning processes for the life of the engine — so restarting a few
// times multiplied the browse count instead of keeping it constant.
func TestWakerStartReplacesRatherThanStacks(t *testing.T) {
	if tool, _ := PassiveBrowseCommand(); tool == "" {
		t.Skip("no passive browse tool on this platform")
	}
	if _, err := exec.LookPath(mustTool(t)); err != nil {
		t.Skip("browse tool not installed on this machine")
	}

	var waker MDNSWaker
	t.Cleanup(waker.Stop)
	want := len(AppleMDNSServices)

	for attempt := range 3 {
		waker.Start(t.Context(), &recordingLogger{})
		if got := waitForBrowses(t, &waker, want); got != want {
			t.Fatalf("after start #%d: %d browses running, want %d", attempt+1, got, want)
		}
	}

	waker.Stop()
	if got := waitForBrowses(t, &waker, 0); got != 0 {
		t.Errorf("after Stop: %d browses still running, want 0", got)
	}
}

func TestWakerStopWithoutStartIsANoop(t *testing.T) {
	var waker MDNSWaker
	waker.Stop() // must not panic or block
	if got := waker.ActiveBrowses(); got != 0 {
		t.Errorf("ActiveBrowses = %d on an unstarted waker, want 0", got)
	}
}

// Backoff must actually grow, or a machine with no working mDNS stack spawns a
// process every couple of seconds all night.
func TestBrowseBackoffIsBounded(t *testing.T) {
	delay := browseRestartDelay
	for range 20 {
		delay *= 2
		if delay > browseRestartMax {
			delay = browseRestartMax
		}
	}
	if delay != browseRestartMax {
		t.Errorf("backoff settled at %s, want it capped at %s", delay, browseRestartMax)
	}
	if browseRestartMax <= browseRestartDelay {
		t.Error("the cap must be above the base delay, or there is no backoff")
	}
	if minHealthyRun <= 0 {
		t.Error("minHealthyRun must be positive to tell a working browse from an instant failure")
	}
}

func mustTool(t *testing.T) string {
	t.Helper()
	tool, _ := PassiveBrowseCommand()
	return tool
}

// waitForBrowses polls until the count settles on want, or gives up and returns
// whatever it last saw so the caller can report the real number.
func waitForBrowses(t *testing.T, w *MDNSWaker, want int) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got := w.ActiveBrowses()
		if got == want || time.Now().After(deadline) {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
}
