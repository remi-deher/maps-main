// Package goios implements the Driver interface on top of the go-ios CLI.
// It manages the RSD tunnel as a long-running child process and injects/clears
// the GPS position through `ios setlocation`.
//
// go-ios >= 1.x changed the tunnel model: `ios tunnel start` no longer prints
// an "RSD address:" line — it runs a daemon (creating the OS tun adapter, which
// needs admin/root) and the per-device RSD address+port are queried out-of-band
// via `ios tunnel ls` (JSON). Location is then set with
// `ios setlocation --address=<ipv6> --rsd-port=<port> --lat=<lat> --lon=<lon>`
// and cleared with `ios resetlocation`.
package goios

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/domain"
	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// execCommand/execCommandContext indirect os/exec's package functions so
// tests can substitute a fake child process for the real go-ios binary
// (see goios_test.go's fakeExecCommand) instead of spawning it for real.
var (
	execCommand        = exec.Command
	execCommandContext = exec.CommandContext
)

const (
	defaultTunnelStartTimeout = 45 * time.Second
	// How often to poll `ios tunnel ls` while waiting for the daemon to bring
	// the device tunnel up after `ios tunnel start`.
	tunnelPollInterval = 1 * time.Second
)

// Driver is the go-ios backed implementation.
type Driver struct {
	bin                string            // cached resolved CLI path ("" until resolved)
	binPaths           map[string]string // explicit overrides, for lazy resolution
	lockdownArgs       []string
	manual             string // optional "host:port" RSD endpoint (WiFi transport)
	tunnelStartTimeout time.Duration

	mu        sync.Mutex
	tunnel    driver.TunnelInfo
	tunnelOn  bool
	tunnelCmd *exec.Cmd
	udid      string // device UDID backing the current tunnel (from `tunnel ls`)
}

// New builds a go-ios Driver. It does NOT fail when the CLI can't be found:
// the engine must still boot (serve the API/UI) so the user can see status and
// pick a driver — a missing binary only matters once an operation actually
// needs it, where binPath() surfaces a clear error.
func New(cfg driver.Config) (driver.Driver, error) {
	bin, _ := platform.ResolveGoIos(cfg.BinaryPaths)
	var lock []string
	if dir := platform.LockdownDir(); dir != "" {
		lock = []string{"--pair-record-path=" + dir}
	}
	timeout := cfg.TunnelStartTimeout
	if timeout <= 0 {
		timeout = defaultTunnelStartTimeout
	}
	return &Driver{bin: bin, binPaths: cfg.BinaryPaths, lockdownArgs: lock, manual: cfg.ManualAddress, tunnelStartTimeout: timeout}, nil
}

// binPath returns the go-ios CLI path, resolving it lazily if New couldn't
// (e.g. the binary was installed after boot, or is only needed now).
func (d *Driver) binPath() (string, error) {
	if d.bin != "" {
		return d.bin, nil
	}
	return platform.ResolveGoIos(d.binPaths)
}

func init() { driver.Register(domain.DriverGoIos, New) }

func (d *Driver) ID() domain.DriverID { return domain.DriverGoIos }

// StartTunnel launches the `ios tunnel start` daemon and polls `ios tunnel ls`
// until the device tunnel is up (or a timeout/ctx cancellation). The daemon
// process is kept running — killing it tears down the OS tun adapter.
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

	// WiFi/network transport: target a manually provided RSD endpoint directly,
	// no local tunnel daemon needed.
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

	bin, err := d.binPath()
	if err != nil {
		return driver.TunnelInfo{}, err
	}
	args := append([]string{"tunnel", "start"}, d.lockdownArgs...)
	cmd := execCommand(bin, args...)

	// Merge stdout+stderr into a bounded tail buffer, so a real failure (no
	// Developer Disk Image, device locked, missing wintun.dll on Windows, USB
	// permission denied, ...) surfaces in the error instead of a bare timeout.
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		return driver.TunnelInfo{}, fmt.Errorf("go-ios tunnel start: %w", err)
	}

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
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			appendTail(sc.Text())
		}
	}()

	ticker := time.NewTicker(tunnelPollInterval)
	defer ticker.Stop()
	deadline := time.After(d.tunnelStartTimeout)

	for {
		// Probe immediately (fast path if the daemon already has the tunnel),
		// then again on every tick until one of the exit conditions fires.
		if ti, udid, ok := d.queryTunnel(ctx); ok {
			d.mu.Lock()
			d.tunnel, d.tunnelOn, d.tunnelCmd, d.udid = ti, true, cmd, udid
			d.mu.Unlock()
			return ti, nil
		}

		select {
		case err := <-exited:
			if out := tailSnapshot(); out != "" {
				return driver.TunnelInfo{}, fmt.Errorf("go-ios: tunnel exited (%v):\n%s", err, out)
			}
			return driver.TunnelInfo{}, fmt.Errorf("go-ios: tunnel exited before a tunnel was established: %w", err)
		case <-deadline:
			_ = cmd.Process.Kill()
			if out := tailSnapshot(); out != "" {
				return driver.TunnelInfo{}, fmt.Errorf("go-ios: tunnel not established within %s, last output:\n%s", d.tunnelStartTimeout, out)
			}
			return driver.TunnelInfo{}, fmt.Errorf("go-ios: tunnel not established within %s", d.tunnelStartTimeout)
		case <-ctx.Done():
			_ = cmd.Process.Kill()
			return driver.TunnelInfo{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

// queryTunnel asks the running daemon for the current device tunnel via
// `ios tunnel ls` and returns the first entry with a usable RSD address+port.
func (d *Driver) queryTunnel(ctx context.Context) (driver.TunnelInfo, string, bool) {
	bin, err := d.binPath()
	if err != nil {
		return driver.TunnelInfo{}, "", false
	}
	out, err := execCommandContext(ctx, bin, "tunnel", "ls").Output()
	if err != nil {
		return driver.TunnelInfo{}, "", false
	}
	for _, e := range parseTunnelList(out) {
		if e.Address != "" && e.RsdPort > 0 {
			return driver.TunnelInfo{
				Address: e.Address,
				Port:    e.RsdPort,
				Type:    driver.Classify(e.Address),
				Since:   time.Now(),
			}, e.UDID, true
		}
	}
	return driver.TunnelInfo{}, "", false
}

// StopTunnel terminates the tunnel child process.
func (d *Driver) StopTunnel(context.Context) error {
	d.mu.Lock()
	cmd, on := d.tunnelCmd, d.tunnelOn
	d.tunnelOn, d.tunnelCmd, d.tunnel, d.udid = false, nil, driver.TunnelInfo{}, ""
	d.mu.Unlock()
	if on && cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

// SetLocation injects a spoofed position via `ios setlocation`, targeting the
// device tunnel explicitly by its RSD address+port (from `tunnel ls`).
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{
		"setlocation",
		"--address=" + ti.Address,
		"--rsd-port=" + strconv.Itoa(ti.Port),
		"--lat=" + ftoa(lat),
		"--lon=" + ftoa(lon),
	}
	args = append(args, d.lockdownArgs...)
	return d.run(ctx, args...)
}

// ClearLocation removes any spoofed position (`ios resetlocation`).
func (d *Driver) ClearLocation(ctx context.Context) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{
		"resetlocation",
		"--address=" + ti.Address,
		"--rsd-port=" + strconv.Itoa(ti.Port),
	}
	args = append(args, d.lockdownArgs...)
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
	bin, err := d.binPath()
	if err != nil {
		return nil, err
	}
	out, err := execCommandContext(ctx, bin, "list").Output()
	if err != nil {
		return nil, fmt.Errorf("go-ios list: %w", err)
	}
	return parseDeviceList(out), nil
}

// DeviceDetails runs `ios info` against the first detected device and returns
// its lockdown metadata (name, model, serial, WiFi MAC), enriched with the
// tunnel address currently used to spoof its position.
func (d *Driver) DeviceDetails(ctx context.Context) (driver.DeviceDetails, error) {
	devices, err := d.ListDevices(ctx)
	if err != nil {
		return driver.DeviceDetails{}, err
	}
	if len(devices) == 0 {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios: no device detected")
	}
	udid := devices[0].UDID

	bin, err := d.binPath()
	if err != nil {
		return driver.DeviceDetails{}, err
	}
	out, err := execCommandContext(ctx, bin, "info", "--udid="+udid).Output()
	if err != nil {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios info: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		return driver.DeviceDetails{}, fmt.Errorf("go-ios info: invalid JSON: %w", err)
	}

	details := driver.DeviceDetails{
		UDID:           udid,
		Name:           stringField(raw, "DeviceName"),
		ProductType:    stringField(raw, "ProductType"),
		ProductVersion: stringField(raw, "ProductVersion"),
		SerialNumber:   stringField(raw, "SerialNumber"),
		WifiAddress:    stringField(raw, "WiFiAddress"),
	}
	if ti, ok := d.Tunnel(); ok {
		details.TunnelAddress = ti.Address
	}
	return details, nil
}

func stringField(raw map[string]any, key string) string {
	s, _ := raw[key].(string)
	return s
}

// Tunnel returns the current tunnel info and whether one is active.
func (d *Driver) Tunnel() (driver.TunnelInfo, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.tunnel, d.tunnelOn
}

func (d *Driver) run(ctx context.Context, args ...string) error {
	bin, err := d.binPath()
	if err != nil {
		return err
	}
	out, err := execCommandContext(ctx, bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("go-ios %v: %w: %s", args, err, string(out))
	}
	return nil
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
