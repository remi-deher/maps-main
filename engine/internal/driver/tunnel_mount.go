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

// stopReapTimeout bounds how long Stop() waits for the killed daemon to
// actually be reaped (see Stop's doc) before giving up and returning anyway —
// a daemon that won't die within this window is treated the same way the
// rest of the engine treats other stuck-process timeouts: better to let the
// caller proceed than hang indefinitely.
const stopReapTimeout = 5 * time.Second

// TunnelMountConfig describes the backend-specific parts of bringing up an RSD
// tunnel. TunnelMount owns the shared daemon lifecycle around it.
type TunnelMountConfig struct {
	DriverName       string
	StartLabel       string
	DaemonLabel      string
	ManualAddress    string
	StartTimeout     time.Duration
	PollInterval     time.Duration
	TimeoutHint      string
	BeforeStart      func(ctx context.Context) error
	StartDaemon      func(ctx context.Context) (*exec.Cmd, error)
	OutputLineFilter func(line string) bool
	Resolve          TunnelEndpointResolver
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
	// daemonExited is set by the daemon's Wait goroutine when the launched
	// process dies after a tunnel was established, so the health monitor can
	// tell "daemon still searching for the device" apart from "daemon dead,
	// must restart". Reset on every successful set().
	daemonExited bool
	// exited is closed by cmd's reaper goroutine once cmd.Wait() returns, i.e.
	// once the OS confirms the daemon (and, via killTree, its children) is
	// actually gone. Stop() waits on it after issuing the kill so a caller that
	// immediately calls Start() again doesn't race the old daemon for the tun
	// adapter / device lock / listening port — see Stop's doc.
	exited chan struct{}
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
	// Put the daemon (and its children) in its own process group / job so
	// killProcess can later tear down the whole tree, not just the launcher.
	configureProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		return TunnelInfo{}, fmt.Errorf("%s %s: %w", cfg.DriverName, cfg.StartLabel, err)
	}

	reaped := make(chan struct{})
	m.mu.Lock()
	m.exited = reaped
	m.mu.Unlock()

	var tailMu sync.Mutex
	var tail []string
	appendTail := func(line string) {
		if cfg.OutputLineFilter != nil && !cfg.OutputLineFilter(line) {
			return
		}
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
	go func() {
		err := cmd.Wait()
		_ = pw.Close()
		m.onDaemonExit(cmd)
		close(reaped)
		exited <- err
	}()
	go func() {
		sc := bufio.NewScanner(pr)
		// The default 64 KiB line cap would make Scan() abort on a single
		// oversized line (bufio.ErrTooLong); raise it so ordinary daemon
		// output never trips it.
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			appendTail(sc.Text())
		}
		// Once scanning stops (EOF, or a line still exceeded the raised cap),
		// keep draining the pipe. Otherwise an unread io.Pipe would block the
		// daemon's next stdout/stderr write indefinitely — freezing the tunnel
		// process itself, so cmd.Wait() never returns and Stop() times out.
		_, _ = io.Copy(io.Discard, pr)
	}()

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.After(cfg.StartTimeout)

	// killAndReap mirrors Stop(): after requesting the kill, wait (bounded)
	// for the daemon to actually be reaped. Returning with the old daemon
	// still dying would let the caller's next Start() race it for the tun
	// adapter / device lock / API port — the same intermittent restart
	// failure Stop() already guards against.
	killAndReap := func() {
		_ = killProcess(cmd)
		select {
		case <-reaped:
		case <-time.After(stopReapTimeout):
		}
	}

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
			killAndReap()
			if out := tailSnapshot(); out != "" {
				return TunnelInfo{}, fmt.Errorf("%s: tunnel not established within %s%s, last output:\n%s", cfg.DriverName, cfg.StartTimeout, timeoutHintSuffix(cfg.TimeoutHint), out)
			}
			return TunnelInfo{}, fmt.Errorf("%s: tunnel not established within %s%s", cfg.DriverName, cfg.StartTimeout, timeoutHintSuffix(cfg.TimeoutHint))
		case <-ctx.Done():
			killAndReap()
			return TunnelInfo{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func timeoutHintSuffix(hint string) string {
	hint = strings.TrimSpace(hint)
	if hint == "" {
		return ""
	}
	return ": " + hint
}

// Stop tears down the active tunnel. After issuing the kill it waits (up to
// stopReapTimeout) for the daemon to actually be reaped before returning —
// taskkill /F on Windows (and the Unix process-group signal) only requests
// termination; the kernel needs a moment to actually tear down the tun
// adapter and release the device lock / listening port. Returning early let a
// caller's immediate StartTunnel() race the still-dying old daemon for those
// same resources, which is what made tunnel restarts intermittently fail to
// come back up.
func (m *TunnelMount) Stop(context.Context) error {
	m.mu.Lock()
	cmd, on, exited := m.cmd, m.on, m.exited
	m.info, m.on, m.cmd, m.udid, m.daemonExited = TunnelInfo{}, false, nil, "", false
	m.mu.Unlock()
	if !on || cmd == nil {
		return nil
	}
	err := killProcess(cmd)
	if exited != nil {
		select {
		case <-exited:
		case <-time.After(stopReapTimeout):
		}
	}
	return err
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
	m.mu.Lock()
	ti := m.info
	on := m.on
	daemonExited := m.daemonExited
	m.mu.Unlock()

	if !on || daemonExited {
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
	m.info, m.on, m.cmd, m.udid, m.daemonExited = info, true, cmd, strings.TrimSpace(udid), false
}

// onDaemonExit marks the mount as having lost its daemon, but only if cmd is
// still the active daemon (a daemon that exited during startup, before set(),
// is handled by the Start loop and must not flip this flag).
func (m *TunnelMount) onDaemonExit(cmd *exec.Cmd) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == cmd {
		m.daemonExited = true
	}
}

// DaemonRunning reports whether a daemon-backed tunnel is up and its process is
// still alive. False for manual-address mounts (no daemon) and for daemons that
// have since exited.
func (m *TunnelMount) DaemonRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.on && m.cmd != nil && !m.daemonExited
}

// IsManual reports whether the active tunnel targets a manual address (no local
// daemon to restart or re-query).
func (m *TunnelMount) IsManual() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.on && m.cmd == nil
}

// UpdateInfo replaces the cached endpoint in place (same daemon, same device)
// — used when a device followed by the daemon moves between USB and WiFi and
// its RSD address/port changes. No-op when no tunnel is active.
func (m *TunnelMount) UpdateInfo(info TunnelInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.on {
		m.info = info
	}
}

// ConfigureProcAttr configures cmd so it (and its children) run in their own
// process group / job, enabling a later KillProcessTree to reap the whole tree.
// Call it before cmd.Start(). Exported for backends (e.g. pmd3's location
// worker) that manage their own child processes outside TunnelMount.
func ConfigureProcAttr(cmd *exec.Cmd) { configureProcAttr(cmd) }

// KillProcessTree terminates cmd and every process it spawned. Pair it with
// ConfigureProcAttr at start time. Safe to call with a nil cmd/process.
func KillProcessTree(cmd *exec.Cmd) error { return killProcess(cmd) }

// killProcess terminates cmd and every process it spawned. The tunnel daemons
// (`ios tunnel start`, pmd3 `remote tunneld`) fork child processes that hold the
// real tun adapter / device session, so a bare cmd.Process.Kill() would only
// reap the launcher and leave orphans behind. killTree is platform-specific:
// taskkill /T on Windows, process-group signal on Unix.
func killProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return killTree(cmd)
}
