package pmd3

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

//go:embed location_worker.py
var locationWorkerScript string

// workerStartTimeout bounds how long we wait for the worker's "ready"
// handshake. The worker's first step is RemoteServiceDiscoveryService
// connecting over the RSD tunnel address — when that address has gone stale
// (e.g. the iOS tunnel daemon just reassigned a new one, as happens
// repeatedly while the device screen is locked), the underlying Windows
// socket can block until the OS's own much longer semaphore timeout fires
// ("[WinError 121] The semaphore timeout period has expired", often
// tens of seconds). Bounding startup separately from the caller's action
// timeout means we give up on a doomed connection quickly and let the next
// retry target a freshly re-resolved endpoint, instead of holding the
// session lock — and blocking every other location operation — for as long
// as Windows takes to notice.
const workerStartTimeout = 12 * time.Second

type locationSession struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	mu       sync.Mutex
	tailMu   sync.Mutex
	stderr   []string
	endpoint driver.TunnelInfo
	// poisoned is set when a round-trip was abandoned on ctx cancellation: the
	// reader goroutine spawned by readResponse may still be blocked on stdout
	// and would consume the *next* request's reply, desyncing the protocol. A
	// poisoned session refuses further round-trips so the caller recreates one.
	poisoned atomic.Bool
}

func newLocationSession(ctx context.Context, py string, endpoint driver.TunnelInfo) (*locationSession, error) {
	cmd := execCommand(py, "-u", "-c", locationWorkerScript, endpoint.Address, strconv.Itoa(endpoint.Port))
	driver.ConfigureProcAttr(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("pmd3 location worker stdin: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("pmd3 location worker stdout: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("pmd3 location worker stderr: %w", err)
	}

	s := &locationSession{
		cmd:      cmd,
		stdin:    stdin,
		stdout:   bufio.NewReader(stdoutPipe),
		endpoint: endpoint,
	}
	go s.captureStderr(stderrPipe)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("pmd3 location worker start: %w", err)
	}

	startCtx, cancel := context.WithTimeout(ctx, workerStartTimeout)
	err = s.readResponse(startCtx)
	cancel()
	if err != nil {
		// A worker that never reached the ready handshake is presumed stuck
		// inside its RSD connect (a stale tunnel address) rather than merely
		// slow — it won't be reading stdin yet, so the polite "stop" round-trip
		// used for a healthy session would itself hang. Kill the process tree
		// directly and give it a short grace period to exit.
		s.forceKill()
		return nil, fmt.Errorf("pmd3 location worker ready: %w", err)
	}
	return s, nil
}

// forceKill terminates a worker that isn't responding (or never finished
// starting up) without waiting indefinitely for a clean exit.
func (s *locationSession) forceKill() {
	_ = driver.KillProcessTree(s.cmd)
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	waitCh := make(chan struct{})
	go func() {
		_ = s.cmd.Wait()
		close(waitCh)
	}()
	select {
	case <-waitCh:
	case <-time.After(5 * time.Second):
	}
}

func (s *locationSession) set(ctx context.Context, lat, lon float64) error {
	return s.roundTrip(ctx, map[string]any{
		"action": "set",
		"lat":    lat,
		"lon":    lon,
	})
}

func (s *locationSession) clear(ctx context.Context) error {
	return s.roundTrip(ctx, map[string]any{"action": "clear"})
}

func (s *locationSession) stop(ctx context.Context) error {
	err := s.roundTrip(ctx, map[string]any{"action": "stop"})
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.cmd != nil {
		waitCh := make(chan error, 1)
		go func() { waitCh <- s.cmd.Wait() }()
		select {
		case <-waitCh:
		case <-ctx.Done():
			_ = driver.KillProcessTree(s.cmd)
			<-waitCh
			return ctx.Err()
		}
	}
	return err
}

func (s *locationSession) roundTrip(ctx context.Context, payload map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// A prior round-trip was abandoned mid-flight; its orphaned reader may still
	// be draining stdout, so writing again could pair our write with its read.
	// Fail fast and let the caller open a fresh session.
	if s.poisoned.Load() {
		return fmt.Errorf("pmd3 location worker: session abandoned after timeout%s", s.stderrSuffix())
	}

	if err := json.NewEncoder(s.stdin).Encode(payload); err != nil {
		return fmt.Errorf("pmd3 location worker write: %w%s", err, s.stderrSuffix())
	}
	return s.readResponse(ctx)
}

func (s *locationSession) readResponse(ctx context.Context) error {
	type response struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}

	respCh := make(chan response, 1)
	errCh := make(chan error, 1)
	go func() {
		line, err := s.stdout.ReadString('\n')
		if err != nil {
			errCh <- err
			return
		}
		var resp response
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			errCh <- fmt.Errorf("invalid JSON response %q: %w", strings.TrimSpace(line), err)
			return
		}
		respCh <- resp
	}()

	select {
	case resp := <-respCh:
		if !resp.OK {
			if resp.Error == "" {
				resp.Error = "unknown worker error"
			}
			return fmt.Errorf("%s%s", resp.Error, s.stderrSuffix())
		}
		return nil
	case err := <-errCh:
		return fmt.Errorf("%w%s", err, s.stderrSuffix())
	case <-ctx.Done():
		// The goroutine above is still blocked on ReadString and will read the
		// (late) reply meant for this request — poison the session so it is
		// never reused for a subsequent, mismatched round-trip.
		s.poisoned.Store(true)
		return ctx.Err()
	}
}

func (s *locationSession) captureStderr(r io.Reader) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		s.tailMu.Lock()
		s.stderr = append(s.stderr, sc.Text())
		if len(s.stderr) > 20 {
			s.stderr = s.stderr[len(s.stderr)-20:]
		}
		s.tailMu.Unlock()
	}
}

func (s *locationSession) stderrSuffix() string {
	s.tailMu.Lock()
	defer s.tailMu.Unlock()
	if len(s.stderr) == 0 {
		return ""
	}
	return "\nworker stderr:\n" + strings.Join(s.stderr, "\n")
}
