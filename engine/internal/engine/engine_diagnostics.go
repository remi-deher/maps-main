package engine

import (
	"context"
	"os"
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
	Pmd3Path        string          `json:"pmd3Path"`
	Pmd3Error       string          `json:"pmd3Error,omitempty"`
	LockdownDir     string          `json:"lockdownDir"`
	PairingRecords  []PairingRecord `json:"pairingRecords"`
	USBDevices      []driver.Device `json:"usbDevices"`
	USBDevicesError string          `json:"usbDevicesError,omitempty"`
}

var deviceNameRe = regexp.MustCompile(`<key>DeviceName</key>\s*<string>([^<]+)</string>`)

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
	}

	// 2. Check pymobiledevice3
	pmd3Bin, _, pmd3Err := platform.Pmd3Command(explicit)
	diag.Pmd3Path = pmd3Bin
	if pmd3Err != nil {
		diag.Pmd3Error = pmd3Err.Error()
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
