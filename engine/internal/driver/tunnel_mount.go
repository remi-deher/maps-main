package driver

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const tunnelTailLines = 20

// TunnelMountConfig describes the backend-specific parts of bringing up an RSD
// tunnel. TunnelMount owns the shared daemon lifecycle around it.
type TunnelMountConfig struct {
	DriverName    string
	StartLabel    string
	DaemonLabel   string
	ManualAddress string
	StartTimeout  time.Duration
	PollInterval  time.Duration
	BeforeStart   func(ctx context.Context) error
	StartDaemon   func(ctx context.Context) (*exec.Cmd, error)
	Resolve       TunnelEndpointResolver
}

// TunnelMount keeps the common active-tunnel state and daemon process. Concrete
// drivers hold one so go-ios and pymobiledevice3 share the same
// mount/cache/stop behavior while preserving backend-specific parsing.
type TunnelMount struct {
	mu   sync.Mutex
	info TunnelInfo
	on   bool
	cmd  *exec.Cmd
	udid string
}

func (m *TunnelMount) Start(ctx context.Context, cfg TunnelMountConfig) (TunnelInfo, error) {
	if cfg.DriverName == "" {
		cfg.DriverName = "driver"
	}
	if cfg.StartLabel == "" {
		cfg.StartLabel = "tunnel"
	}
	if cfg.DaemonLabel == "" {
		cfg.DaemonLabel = cfg.StartLabel
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = time.Second
	}
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = time.Minute
	}

	if ti, ok := m.Current(); ok {
		return ti, nil
	}

	if cfg.ManualAddress != "" {
		ti, err := ParseManual(cfg.ManualAddress)
		if err != nil {
			return TunnelInfo{}, err
		}
		m.SetActive(ti, "")
		return ti, nil
	}

	if cfg.BeforeStart != nil {
		if err := cfg.BeforeStart(ctx); err != nil {
			return TunnelInfo{}, err
		}
	}
	if cfg.StartDaemon == nil {
		return TunnelInfo{}, fmt.Errorf("%s: missing tunnel daemon starter", cfg.DriverName)
	}
	if cfg.Resolve == nil {
		return TunnelInfo{}, fmt.Errorf("%s: missing tunnel endpoint resolver", cfg.DriverName)
	}

	cmd, err := cfg.StartDaemon(ctx)
	if err != nil {
		return TunnelInfo{}, err
	}
	if cmd == nil {
		return TunnelInfo{}, fmt.Errorf("%s: tunnel daemon starter returned nil command", cfg.DriverName)
	}

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		return TunnelInfo{}, fmt.Errorf("%s %s: %w", cfg.DriverName, cfg.StartLabel, err)
	}

	var tailMu sync.Mutex
	var tail []string
	appendTail := func(line string) {
		tailMu.Lock()
		tail = append(tail, line)
		if len(tail) > tunnelTailLines {
			tail = tail[len(tail)-tunnelTailLines:]
		}
		tailMu.Unlock()
	}
	tailSnapshot := func() string {
		tailMu.Lock()
		defer tailMu.Unlock()
		return strings.Join(tail, "\n")
	}

	exited := make(chan error, 1)
	go func() { err := cmd.Wait(); _ = pw.Close(); exited <- err }()
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			appendTail(sc.Text())
		}
	}()

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.After(cfg.StartTimeout)

	for {
		if endpoint, ok := cfg.Resolve(ctx); ok {
			m.set(endpoint.Info, cmd, endpoint.UDID)
			return endpoint.Info, nil
		}

		select {
		case err := <-exited:
			if out := tailSnapshot(); out != "" {
				return TunnelInfo{}, fmt.Errorf("%s: %s exited (%v):\n%s", cfg.DriverName, cfg.DaemonLabel, err, out)
			}
			return TunnelInfo{}, fmt.Errorf("%s: %s exited before a tunnel was established: %w", cfg.DriverName, cfg.DaemonLabel, err)
		case <-deadline:
			_ = killProcess(cmd)
			if out := tailSnapshot(); out != "" {
				return TunnelInfo{}, fmt.Errorf("%s: tunnel not established within %s, last output:\n%s", cfg.DriverName, cfg.StartTimeout, out)
			}
			return TunnelInfo{}, fmt.Errorf("%s: tunnel not established within %s", cfg.DriverName, cfg.StartTimeout)
		case <-ctx.Done():
			_ = killProcess(cmd)
			return TunnelInfo{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *TunnelMount) Stop(context.Context) error {
	m.mu.Lock()
	cmd, on := m.cmd, m.on
	m.info, m.on, m.cmd, m.udid = TunnelInfo{}, false, nil, ""
	m.mu.Unlock()
	if on && cmd != nil {
		return killProcess(cmd)
	}
	return nil
}

func (m *TunnelMount) Current() (TunnelInfo, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.info, m.on
}

func (m *TunnelMount) SetActive(info TunnelInfo, udid string) {
	m.set(info, nil, udid)
}

func (m *TunnelMount) UDID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.udid
}

func (m *TunnelMount) CheckHealth(timeout time.Duration) bool {
	ti, ok := m.Current()
	if !ok {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ti.Address, strconv.Itoa(ti.Port)), timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (m *TunnelMount) set(info TunnelInfo, cmd *exec.Cmd, udid string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.info, m.on, m.cmd, m.udid = info, true, cmd, strings.TrimSpace(udid)
}

func killProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
