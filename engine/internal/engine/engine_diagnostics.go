package engine

import (
	"context"
	"encoding/json"
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

	return diag, nil
}
