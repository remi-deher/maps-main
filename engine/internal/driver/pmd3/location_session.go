package pmd3

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
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

// handshakeID is the pending-request slot the worker's initial "ready" line is
// delivered to. The worker sends that line unprompted, so it carries no request
// id of its own.
const handshakeID uint64 = 0

// workerResponse is one line of the worker's stdout protocol.
type workerResponse struct {
	ID    uint64 `json:"id"`
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// locationSession is a live DVT connection held by a Python worker process.
//
// Requests carry an id and responses echo it, so a round-trip abandoned on
// timeout only abandons its own slot: the late reply arrives, finds nobody
// waiting for that id, and is dropped. The session stays usable. It used to be
// an uncorrelated request/response stream, which meant a slow reply could pair
// with the *next* request — so an abandoned round-trip had to poison the whole
// session, and the caller paid a full worker restart (up to workerStartTimeout
// of RSD handshake) for one hiccup, on a route injecting once a second.
type locationSession struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	endpoint driver.TunnelInfo

	writeMu sync.Mutex // serializes request writes onto the worker's stdin
	nextID  atomic.Uint64

	pendMu  sync.Mutex
	pending map[uint64]chan workerResponse

	// readDone is closed when the reader goroutine stops, i.e. the worker's
	// stdout reached EOF or produced something unparseable. readErr says why.
	readDone chan struct{}
	readErr  atomic.Value // error

	tailMu sync.Mutex
	stderr []string
}

// newLocationSession starts the Python worker with workerArgs and waits for its
// ready handshake. endpoint is what the session is considered bound to, so
// locationSession() can tell when a re-resolve has moved the tunnel out from
// under it; in userspace mode it is the synthetic in-process marker.
func newLocationSession(ctx context.Context, py string, workerArgs []string, endpoint driver.TunnelInfo) (*locationSession, error) {
	args := append([]string{"-u", "-c", locationWorkerScript}, workerArgs...)
	cmd := execCommand(py, args...)
	driver.ConfigureProcAttr(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("pmd3 location worker stdin: %w", err)
	}
	// Deliberately os.Pipe rather than cmd.StdoutPipe/StderrPipe: Wait() closes
	// the pipes those return, so os/exec documents that reading from them
	// concurrently with Wait is incorrect — and this session does exactly that,
	// with a stderr capture goroutine and a stdout reader running for the
	// worker's whole life. Pipes we own are untouched by Wait and simply reach
	// EOF when the child exits, so no teardown path has to coordinate.
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("pmd3 location worker stdout: %w", err)
	}
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		closeAll(stdoutR, stdoutW)
		return nil, fmt.Errorf("pmd3 location worker stderr: %w", err)
	}
	cmd.Stdout, cmd.Stderr = stdoutW, stderrW

	s := &locationSession{
		cmd:      cmd,
		stdin:    stdin,
		endpoint: endpoint,
		pending:  make(map[uint64]chan workerResponse),
		readDone: make(chan struct{}),
	}

	ready := s.register(handshakeID)

	if err := cmd.Start(); err != nil {
		closeAll(stdoutR, stdoutW, stderrR, stderrW)
		return nil, fmt.Errorf("pmd3 location worker start: %w", err)
	}
	// The child holds its own descriptors now; drop ours, or the readers would
	// never see EOF once it exits.
	closeAll(stdoutW, stderrW)
	go s.captureStderr(stderrR)
	go s.readLoop(stdoutR)

	startCtx, cancel := context.WithTimeout(ctx, workerStartTimeout)
	defer cancel()
	if err := s.await(startCtx, handshakeID, ready); err != nil {
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

// closeAll closes every non-nil closer, ignoring errors. Used on the setup
// paths where a half-built session has to release the descriptors it opened.
func closeAll(closers ...io.Closer) {
	for _, c := range closers {
		if c != nil {
			_ = c.Close()
		}
	}
}

// readLoop is the session's single stdout reader. Having exactly one means a
// response is always matched to the request that asked for it, and a caller
// that walked away never leaves a second reader racing for the next line.
func (s *locationSession) readLoop(r io.ReadCloser) {
	defer func() { _ = r.Close() }()
	defer close(s.readDone)

	br := bufio.NewReader(r)
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			s.readErr.Store(err)
			s.failPending()
			return
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var resp workerResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			s.readErr.Store(fmt.Errorf("invalid JSON response %q: %w", line, err))
			s.failPending()
			return
		}
		s.deliver(resp)
	}
}

func (s *locationSession) register(id uint64) chan workerResponse {
	ch := make(chan workerResponse, 1)
	s.pendMu.Lock()
	s.pending[id] = ch
	s.pendMu.Unlock()
	return ch
}

func (s *locationSession) unregister(id uint64) {
	s.pendMu.Lock()
	delete(s.pending, id)
	s.pendMu.Unlock()
}

// deliver hands a response to whoever is waiting for its id. A response nobody
// is waiting for — the late reply to an abandoned round-trip — is dropped,
// which is the whole point of carrying ids.
func (s *locationSession) deliver(resp workerResponse) {
	s.pendMu.Lock()
	ch, ok := s.pending[resp.ID]
	delete(s.pending, resp.ID)
	s.pendMu.Unlock()
	if ok {
		ch <- resp
	}
}

// failPending wakes every waiter once the worker's stdout is gone for good.
func (s *locationSession) failPending() {
	s.pendMu.Lock()
	pending := s.pending
	s.pending = make(map[uint64]chan workerResponse)
	s.pendMu.Unlock()
	for _, ch := range pending {
		close(ch)
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

// ping is a liveness round-trip. In userspace mode the tunnel lives inside this
// worker process, so there is no socket for TunnelMount.CheckHealth to dial —
// a worker that still answers is the only meaningful health signal.
func (s *locationSession) ping(ctx context.Context) error {
	return s.roundTrip(ctx, map[string]any{"action": "ping"})
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

func (s *locationSession) roundTrip(ctx context.Context, payload map[string]any) error {
	id := s.nextID.Add(1)
	payload["id"] = id
	ch := s.register(id)

	// One writer at a time: two goroutines encoding onto the same stdin could
	// interleave their JSON. Reads are not serialized here — that is what the
	// ids are for.
	s.writeMu.Lock()
	err := json.NewEncoder(s.stdin).Encode(payload)
	s.writeMu.Unlock()
	if err != nil {
		s.unregister(id)
		return fmt.Errorf("pmd3 location worker write: %w%s", err, s.stderrSuffix())
	}
	return s.await(ctx, id, ch)
}

// await blocks for the response to id. On timeout it releases the slot and
// returns: the reply, if it ever comes, lands on a slot nobody holds and is
// discarded, leaving the session usable for the next request.
func (s *locationSession) await(ctx context.Context, id uint64, ch chan workerResponse) error {
	select {
	case resp, ok := <-ch:
		if !ok {
			return fmt.Errorf("%w%s", s.readError(), s.stderrSuffix())
		}
		if !resp.OK {
			if resp.Error == "" {
				resp.Error = "unknown worker error"
			}
			return fmt.Errorf("%s%s", resp.Error, s.stderrSuffix())
		}
		return nil
	case <-ctx.Done():
		s.unregister(id)
		return ctx.Err()
	}
}

// readError is why the worker's stdout stopped, for waiters woken by that.
func (s *locationSession) readError() error {
	if err, ok := s.readErr.Load().(error); ok && err != nil {
		return err
	}
	return errors.New("pmd3 location worker: stdout closed")
}

func (s *locationSession) captureStderr(r io.ReadCloser) {
	defer func() { _ = r.Close() }()
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
