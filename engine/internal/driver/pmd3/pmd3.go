// Package pmd3 implements the Driver interface on top of pymobiledevice3, run as
// a Python subprocess (python -m pymobiledevice3 ...). It manages the RSD tunnel
// daemon and injects/clears the GPS position via the developer dvt commands.
package pmd3

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// rsdRe matches the tunneld line, e.g. "Created tunnel --rsd fde6::1 54321".
var rsdRe = regexp.MustCompile(`--rsd\s+([\w:.%]+)\s+(\d+)`)

// execCommand/execCommandContext indirect os/exec's package functions so
// tests can substitute a fake child process for the real python interpreter
// (see pmd3_test.go's fakeExecCommand) instead of spawning it for real.
var (
	execCommand        = exec.Command
	execCommandContext = exec.CommandContext
)

const defaultTunnelStartTimeout = 60 * time.Second

// Driver is the pymobiledevice3-backed implementation.
type Driver struct {
	py                 string   // python executable
	base               []string // base args, e.g. ["-m","pymobiledevice3"]
	manual             string   // optional "host:port" RSD endpoint (WiFi transport)
	tunnelStartTimeout time.Duration

	mu        sync.Mutex
	tunnel    driver.TunnelInfo
	tunnelOn  bool
	tunnelCmd *exec.Cmd
}

// New builds a pmd3 Driver, resolving the Python interpreter from cfg/PATH.
func New(cfg driver.Config) (driver.Driver, error) {
	py, base, err := platform.Pmd3Command(cfg.BinaryPaths)
	if err != nil {
		return nil, err
	}
	timeout := cfg.TunnelStartTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}
	return &Driver{py: py, base: base, manual: cfg.ManualAddress, tunnelStartTimeout: timeout}, nil
}

func init() { driver.Register(domain.DriverPmd3, New) }

func (d *Driver) ID() domain.DriverID { return domain.DriverPmd3 }

// StartTunnel mounts the developer image then runs `remote tunneld`, blocking
// until the RSD address is parsed. With a manual address it targets it directly.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	if d.tunnelStartTimeout <= 0 {
		d.tunnelStartTimeout = defaultTunnelStartTimeout
	}
	d.mu.Lock()
	if d.tunnelOn {
		ti := d.tunnel
		d.mu.Unlock()
		return ti, nil
	}
	d.mu.Unlock()

	// WiFi/network transport: use a manually provided RSD endpoint directly.
	if d.manual != "" {
		ti, err := driver.ParseManual(d.manual)
		if err != nil {
			return driver.TunnelInfo{}, err
		}
		d.mu.Lock()
		d.tunnel, d.tunnelOn = ti, true
		d.mu.Unlock()
		return ti, nil
	}

	// Best-effort: mount the Developer Disk Image (ignore failures).
	_ = execCommandContext(ctx, d.py, d.args("mounter", "auto-mount")...).Run()

	cmd := execCommand(d.py, d.args("remote", "tunneld")...)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		return driver.TunnelInfo{}, fmt.Errorf("pmd3 remote tunneld: %w", err)
	}

	// Bounded ring buffer of recent tunneld output. Every line used to be
	// silently dropped unless it matched the RSD regex, so a real failure
	// (missing WinTun driver, "administrator privileges required", pairing
	// errors, ...) never reached the caller — only a generic timeout did.
	const maxTailLines = 20
	var tailMu sync.Mutex
	var tail []string
	appendTail := func(line string) {
		tailMu.Lock()
		tail = append(tail, line)
		if len(tail) > maxTailLines {
			tail = tail[len(tail)-maxTailLines:]
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

	found := make(chan driver.TunnelInfo, 1)
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			line := sc.Text()
			appendTail(line)
			if m := rsdRe.FindStringSubmatch(line); m != nil {
				port, _ := strconv.Atoi(m[2])
				ti := driver.TunnelInfo{
					Address: m[1],
					Port:    port,
					Type:    driver.Classify(m[1]),
					Since:   time.Now(),
				}
				select {
				case found <- ti:
				default:
				}
			}
		}
	}()

	select {
	case ti := <-found:
		d.mu.Lock()
		d.tunnel, d.tunnelOn, d.tunnelCmd = ti, true, cmd
		d.mu.Unlock()
		return ti, nil
	case err := <-exited:
		// The process died before printing an RSD line — surface its output
		// immediately instead of burning the rest of the timeout for nothing.
		if out := tailSnapshot(); out != "" {
			return driver.TunnelInfo{}, fmt.Errorf("pmd3: remote tunneld exited (%v):\n%s", err, out)
		}
		return driver.TunnelInfo{}, fmt.Errorf("pmd3: remote tunneld exited before an RSD address was detected: %w", err)
	case <-time.After(d.tunnelStartTimeout):
		_ = cmd.Process.Kill()
		if out := tailSnapshot(); out != "" {
			return driver.TunnelInfo{}, fmt.Errorf("pmd3: RSD address not detected within %s, last output:\n%s", d.tunnelStartTimeout, out)
		}
		return driver.TunnelInfo{}, fmt.Errorf("pmd3: RSD address not detected within %s", d.tunnelStartTimeout)
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return driver.TunnelInfo{}, ctx.Err()
	}
}

// StopTunnel terminates the tunneld child process.
func (d *Driver) StopTunnel(context.Context) error {
	d.mu.Lock()
	cmd, on := d.tunnelCmd, d.tunnelOn
	d.tunnelOn, d.tunnelCmd, d.tunnel = false, nil, driver.TunnelInfo{}
	d.mu.Unlock()
	if on && cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

// SetLocation injects a spoofed position via simulate-location set.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("pmd3: tunnel not started")
	}
	return d.run(ctx, "developer", "dvt", "simulate-location", "set",
		"--rsd", ti.Address, strconv.Itoa(ti.Port), "--", ftoa(lat), ftoa(lon))
}

// ClearLocation removes any spoofed position via simulate-location clear.
func (d *Driver) ClearLocation(ctx context.Context) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("pmd3: tunnel not started")
	}
	return d.run(ctx, "developer", "dvt", "simulate-location", "clear",
		"--rsd", ti.Address, strconv.Itoa(ti.Port))
}

// CheckHealth dials the RSD endpoint to confirm the tunnel is still reachable.
func (d *Driver) CheckHealth(context.Context) bool {
	ti, ok := d.Tunnel()
	if !ok {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ti.Address, strconv.Itoa(ti.Port)), 3*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// ListDevices runs `usbmux list` and returns the discovered devices.
func (d *Driver) ListDevices(ctx context.Context) ([]driver.Device, error) {
	out, err := execCommandContext(ctx, d.py, d.args("usbmux", "list")...).Output()
	if err != nil {
		return nil, fmt.Errorf("pmd3 usbmux list: %w", err)
	}
	return parseDeviceList(out), nil
}

// Tunnel returns the current tunnel info and whether one is active.
func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.tunnel, d.tunnelOn
}

func (d *Driver) args(extra ...string) []string {
	return append(append([]string{}, d.base...), extra...)
}

func (d *Driver) run(ctx context.Context, extra ...string) error {
	args := d.args(extra...)
	out, err := execCommandContext(ctx, d.py, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("pmd3 %v: %w: %s", extra, err, string(out))
	}
	return nil
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
