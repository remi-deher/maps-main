// Package goios implements the Driver interface on top of the go-ios CLI.
// It manages the RSD tunnel as a long-running child process and injects/clears
// the GPS position through `ios setlocation`.
package goios

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// rsdRe matches the line go-ios prints once the tunnel is up, e.g.
// "RSD address: fde6:...:1:54321" — mirrors the legacy GoIosDriver.
var rsdRe = regexp.MustCompile(`RSD address:\s*([\w:.%]+):(\d+)`)

const tunnelStartTimeout = 45 * time.Second

// Driver is the go-ios backed implementation.
type Driver struct {
	bin          string
	lockdownArgs []string

	mu        sync.Mutex
	tunnel    driver.TunnelInfo
	tunnelOn  bool
	tunnelCmd *exec.Cmd
}

// New builds a go-ios Driver, resolving the CLI path from cfg/PATH/fallbacks.
func New(cfg driver.Config) (driver.Driver, error) {
	bin, err := platform.ResolveGoIos(cfg.BinaryPaths)
	if err != nil {
		return nil, err
	}
	var lock []string
	if dir := platform.LockdownDir(); dir != "" {
		lock = []string{"--pair-record-path=" + dir}
	}
	return &Driver{bin: bin, lockdownArgs: lock}, nil
}

func init() { driver.Register(domain.DriverGoIos, New) }

func (d *Driver) ID() domain.DriverID { return domain.DriverGoIos }

// StartTunnel launches `ios tunnel start` and blocks until the RSD address is
// parsed (or a timeout/ctx cancellation). The process is kept running.
func (d *Driver) StartTunnel(ctx context.Context) (driver.TunnelInfo, error) {
	d.mu.Lock()
	if d.tunnelOn {
		ti := d.tunnel
		d.mu.Unlock()
		return ti, nil
	}
	d.mu.Unlock()

	args := append([]string{"tunnel", "start"}, d.lockdownArgs...)
	cmd := exec.Command(d.bin, args...)

	// Merge stdout+stderr: go-ios may print the RSD line on either stream.
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		return driver.TunnelInfo{}, fmt.Errorf("go-ios tunnel start: %w", err)
	}
	go func() { _ = cmd.Wait(); _ = pw.Close() }()

	found := make(chan driver.TunnelInfo, 1)
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			if m := rsdRe.FindStringSubmatch(sc.Text()); m != nil {
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
	case <-time.After(tunnelStartTimeout):
		_ = cmd.Process.Kill()
		return driver.TunnelInfo{}, fmt.Errorf("go-ios: RSD address not detected within %s", tunnelStartTimeout)
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return driver.TunnelInfo{}, ctx.Err()
	}
}

// StopTunnel terminates the tunnel child process.
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

// SetLocation injects a spoofed position via `ios setlocation`.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{"setlocation", "--rsd", rsd(ti)}
	args = append(args, d.lockdownArgs...)
	args = append(args, ftoa(lat), ftoa(lon))
	return d.run(ctx, args...)
}

// ClearLocation removes any spoofed position (`setlocation ... reset`).
func (d *Driver) ClearLocation(ctx context.Context) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{"setlocation", "--rsd", rsd(ti)}
	args = append(args, d.lockdownArgs...)
	args = append(args, "reset")
	return d.run(ctx, args...)
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

// ListDevices runs `ios list` and returns the discovered UDIDs.
func (d *Driver) ListDevices(ctx context.Context) ([]driver.Device, error) {
	out, err := exec.CommandContext(ctx, d.bin, "list").Output()
	if err != nil {
		return nil, fmt.Errorf("go-ios list: %w", err)
	}
	return parseDeviceList(out), nil
}

// Tunnel returns the current tunnel info and whether one is active.
func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.tunnel, d.tunnelOn
}

func (d *Driver) run(ctx context.Context, args ...string) error {
	out, err := exec.CommandContext(ctx, d.bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("go-ios %v: %w: %s", args, err, string(out))
	}
	return nil
}

func rsd(ti driver.TunnelInfo) string {
	return fmt.Sprintf("%s:%d", ti.Address, ti.Port)
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
