package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/platform"
)

// PairingRecord describes an Apple Lockdown pairing certificate.
type PairingRecord struct {
	UDID       string `json:"udid"`
	DeviceName string `json:"deviceName"`
	ModTime    int64  `json:"modTime"`
}

// Diagnostics gathers critical runtime info for troubleshooting.
type Diagnostics struct {
	GoIosPath       string          `json:"goIosPath"`
	GoIosError      string          `json:"goIosError,omitempty"`
	GoIosVersion    string          `json:"goIosVersion,omitempty"`
	Pmd3Path        string          `json:"pmd3Path"`
	Pmd3Error       string          `json:"pmd3Error,omitempty"`
	Pmd3Version     string          `json:"pmd3Version,omitempty"`
	LockdownDir     string          `json:"lockdownDir"`
	PairingRecords  []PairingRecord `json:"pairingRecords"`
	USBDevices      []driver.Device `json:"usbDevices"`
	USBDevicesError string          `json:"usbDevicesError,omitempty"`
	// UnpairedUSBDevices lists the UDIDs of USB-connected devices (from
	// USBDevices) that have NO matching entry in PairingRecords — i.e. no
	// Lockdown trust certificate exists for them yet. iOS 17+'s WiFi RSD
	// tunnel cannot be established for a device until this exists (it's
	// created once, over USB, by accepting the "Trust This Computer?"
	// prompt) — go-ios and pymobiledevice3 both refuse silently rather than
	// surfacing this, which is why a missing entry here is the most likely
	// explanation for "USB works, WiFi never connects".
	UnpairedUSBDevices []string `json:"unpairedUsbDevices,omitempty"`
}

// isPaired reports whether a Lockdown pairing record exists for udid, by
// direct file lookup rather than a full GetDiagnostics() scan — cheap enough
// to call from a hot error path (e.g. right after a failed StartTunnel).
func isPaired(udid string) bool {
	if udid == "" {
		return false
	}
	dir := platform.LockdownDir()
	if dir == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(dir, udid+".plist"))
	return err == nil && !info.IsDir()
}

// pairingHint checks whether a USB-visible device is missing its Lockdown
// trust certificate and, if so, returns a remediation suffix to append to a
// tunnel-start failure message. Returns "" when no USB device is visible at
// all (a different problem — see the rest of the failure message) or when
// every visible device is already paired (the failure has another cause).
//
// This is the single most common reason go-ios/pymobiledevice3 ever fail to
// establish the iOS 17+ WiFi RSD tunnel — see docs/IOS_PAIRING_TUNNEL.md —
// yet neither CLI surfaces it as a distinct error; both just report a
// generic tunnel-start timeout/failure indistinguishable from a flaky
// network. Checking it explicitly here turns hours of debugging into one
// log line.
func (e *Engine) pairingHint(ctx context.Context, drv driver.Driver) string {
	devices, err := drv.ListDevices(ctx)
	if err != nil || len(devices) == 0 {
		return ""
	}
	var unpaired []string
	for _, dev := range devices {
		if dev.UDID != "" && !isPaired(dev.UDID) {
			unpaired = append(unpaired, dev.UDID)
		}
	}
	if len(unpaired) == 0 {
		return ""
	}
	return fmt.Sprintf(
		"\n→ Aucun pairing Lockdown trouvé pour %s : le tunnel WiFi iOS 17+ ne peut pas s'établir sans lui, même en USB. "+
			"Branchez l'iPhone en USB et validez \"Faire confiance à cet ordinateur ?\" sur son écran (ou lancez l'action PAIR_DEVICE), puis réessayez.",
		strings.Join(unpaired, ", "))
}

var deviceNameRe = regexp.MustCompile(`<key>DeviceName</key>\s*<string>([^<]+)</string>`)

// goIosVersionString runs `ios version` and extracts the version. go-ios prints
// `{"version":"1.2.0"}` to stdout (slog noise goes to stderr), so scan for the
// first JSON object that carries a non-empty version.
func goIosVersionString(ctx context.Context, bin string) string {
	out, err := exec.CommandContext(ctx, bin, "version").Output()
	if err != nil {
		return ""
	}
	text := string(out)
	for start := strings.Index(text, "{"); start >= 0; {
		var v struct {
			Version string `json:"version"`
		}
		if err := json.NewDecoder(strings.NewReader(text[start:])).Decode(&v); err == nil && v.Version != "" {
			return v.Version
		}
		next := strings.Index(text[start+1:], "{")
		if next < 0 {
			break
		}
		start += next + 1
	}
	return ""
}

// pmd3VersionString runs `python -m pymobiledevice3 version` and returns the
// trimmed version line (pymobiledevice3 prints a bare version string).
func pmd3VersionString(ctx context.Context, py string, base []string) string {
	args := append(append([]string{}, base...), "version")
	out, err := exec.CommandContext(ctx, py, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// GetDiagnostics collects diagnostics about drivers, certificates, and devices.
func (e *Engine) GetDiagnostics(ctx context.Context) (Diagnostics, error) {
	var diag Diagnostics

	e.mu.RLock()
	explicit := e.driverCfgBase.BinaryPaths
	e.mu.RUnlock()

	// 1. Check go-ios
	goIosBin, goIosErr := platform.ResolveGoIos(explicit)
	diag.GoIosPath = goIosBin
	if goIosErr != nil {
		diag.GoIosError = goIosErr.Error()
	} else {
		diag.GoIosVersion = goIosVersionString(ctx, goIosBin)
	}

	// 2. Check pymobiledevice3
	pmd3Bin, pmd3Base, pmd3Err := platform.Pmd3Command(explicit)
	diag.Pmd3Path = pmd3Bin
	if pmd3Err != nil {
		diag.Pmd3Error = pmd3Err.Error()
	} else {
		diag.Pmd3Version = pmd3VersionString(ctx, pmd3Bin, pmd3Base)
	}

	// 3. Resolve lockdown dir
	diag.LockdownDir = platform.LockdownDir()

	// 4. Parse pairing records
	if diag.LockdownDir != "" {
		entries, err := os.ReadDir(diag.LockdownDir)
		if err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				name := entry.Name()
				if !strings.HasSuffix(strings.ToLower(name), ".plist") {
					continue
				}
				udid := name[:len(name)-6]
				if udid == "" {
					continue
				}
				info, err := entry.Info()
				if err != nil {
					continue
				}
				filePath := filepath.Join(diag.LockdownDir, name)
				deviceName := ""
				content, err := os.ReadFile(filePath)
				if err == nil {
					matches := deviceNameRe.FindSubmatch(content)
					if len(matches) > 1 {
						deviceName = string(matches[1])
					}
				}
				diag.PairingRecords = append(diag.PairingRecords, PairingRecord{
					UDID:       udid,
					DeviceName: deviceName,
					ModTime:    info.ModTime().UnixMilli(),
				})
			}
		}
	}

	// 5. USB Devices
	devices, devErr := e.driver().ListDevices(ctx)
	diag.USBDevices = devices
	if devErr != nil {
		diag.USBDevicesError = devErr.Error()
	}

	// 6. Cross-check: which connected USB devices have no Lockdown trust yet.
	paired := make(map[string]bool, len(diag.PairingRecords))
	for _, pr := range diag.PairingRecords {
		paired[pr.UDID] = true
	}
	for _, dev := range diag.USBDevices {
		if dev.UDID != "" && !paired[dev.UDID] {
			diag.UnpairedUSBDevices = append(diag.UnpairedUSBDevices, dev.UDID)
		}
	}

	return diag, nil
}
