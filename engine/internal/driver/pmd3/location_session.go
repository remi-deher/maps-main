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

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

//go:embed location_worker.py
var locationWorkerScript string

type locationSession struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	mu       sync.Mutex
	tailMu   sync.Mutex
	stderr   []string
	endpoint driver.TunnelInfo
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
	if err := s.readResponse(ctx); err != nil {
		_ = s.stop(context.Background())
		return nil, fmt.Errorf("pmd3 location worker ready: %w", err)
	}
	return s, nil
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
