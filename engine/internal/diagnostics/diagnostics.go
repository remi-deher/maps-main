package diagnostics

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
	GoIosPath          string          `json:"goIosPath"`
	GoIosError         string          `json:"goIosError,omitempty"`
	GoIosVersion       string          `json:"goIosVersion,omitempty"`
	Pmd3Path           string          `json:"pmd3Path"`
	Pmd3Error          string          `json:"pmd3Error,omitempty"`
	Pmd3Version        string          `json:"pmd3Version,omitempty"`
	LockdownDir        string          `json:"lockdownDir"`
	PairingRecords     []PairingRecord `json:"pairingRecords"`
	USBDevices         []driver.Device `json:"usbDevices"`
	USBDevicesError    string          `json:"usbDevicesError,omitempty"`
	UnpairedUSBDevices []string        `json:"unpairedUsbDevices,omitempty"`
}

type DeviceLister interface {
	ListDevices(ctx context.Context) ([]driver.Device, error)
}

// IsPaired reports whether a Lockdown pairing record exists for udid.
func IsPaired(udid string) bool {
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

// PairingHint returns a targeted remediation suffix for a tunnel that failed
// to establish, based on what the driver can actually see. It disambiguates
// the three causes that otherwise all surface as the same generic timeout:
//
//   - usbmux/list itself failed → the Apple Mobile Device / usbmuxd service is
//     likely down.
//   - no device is detected at all → nothing to tunnel to (USB unplugged, phone
//     locked before trust, or WiFi-only with no prior tunnel).
//   - a detected device has no Lockdown pairing record → the iOS 17+ RSD tunnel
//     can never come up until a one-time USB trust is done.
//
// When a device is present and paired it returns "" — the tunnel failed for a
// reason this check can't see (dev mode off, phone locked, missing admin
// rights), which the caller's generic timeout hint already describes.
func PairingHint(ctx context.Context, lister DeviceLister) string {
	devices, err := lister.ListDevices(ctx)
	if err != nil {
		return "\n-> Impossible de lister les appareils USB (usbmux a échoué : " + err.Error() +
			"). Vérifiez qu'Apple Mobile Device Service / iTunes (usbmuxd) est bien lancé et que le câble est branché."
	}
	if len(devices) == 0 {
		return "\n-> Aucun appareil détecté par usbmux : branchez l'iPhone en USB, déverrouillez-le et " +
			"acceptez \"Faire confiance à cet ordinateur ?\". Un appareil uniquement en WiFi ne suffit pas à " +
			"(r)établir le tunnel s'il n'a jamais été appairé en USB."
	}
	var unpaired []string
	for _, dev := range devices {
		if dev.UDID != "" && !IsPaired(dev.UDID) {
			unpaired = append(unpaired, dev.UDID)
		}
	}
	if len(unpaired) == 0 {
		return ""
	}
	return "\n-> Aucun pairing Lockdown trouvé pour " + strings.Join(unpaired, ", ") +
		" : le tunnel WiFi iOS 17+ ne peut pas s'établir sans lui, même en USB. " +
		"Branchez l'iPhone en USB et validez \"Faire confiance à cet ordinateur ?\" sur son écran (ou lancez l'action PAIR_DEVICE), puis réessayez."
}

var deviceNameRe = regexp.MustCompile(`<key>DeviceName</key>\s*<string>([^<]+)</string>`)

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

func pmd3VersionString(ctx context.Context, py string, base []string) string {
	args := append(append([]string{}, base...), "version")
	out, err := exec.CommandContext(ctx, py, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Collect gathers diagnostics about drivers, certificates, and devices.
func Collect(ctx context.Context, explicit map[string]string, lister DeviceLister) (Diagnostics, error) {
	var diag Diagnostics

	goIosBin, goIosErr := platform.ResolveGoIos(explicit)
	diag.GoIosPath = goIosBin
	if goIosErr != nil {
		diag.GoIosError = goIosErr.Error()
	} else {
		diag.GoIosVersion = goIosVersionString(ctx, goIosBin)
	}

	pmd3Bin, pmd3Base, pmd3Err := platform.Pmd3Command(explicit)
	diag.Pmd3Path = pmd3Bin
	if pmd3Err != nil {
		diag.Pmd3Error = pmd3Err.Error()
	} else {
		diag.Pmd3Version = pmd3VersionString(ctx, pmd3Bin, pmd3Base)
	}

	diag.LockdownDir = platform.LockdownDir()
	diag.PairingRecords = pairingRecords(diag.LockdownDir)

	devices, devErr := lister.ListDevices(ctx)
	diag.USBDevices = devices
	if devErr != nil {
		diag.USBDevicesError = devErr.Error()
	}

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

func pairingRecords(lockdownDir string) []PairingRecord {
	if lockdownDir == "" {
		return nil
	}
	entries, err := os.ReadDir(lockdownDir)
	if err != nil {
		return nil
	}

	records := make([]PairingRecord, 0, len(entries))
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
		records = append(records, PairingRecord{
			UDID:       udid,
			DeviceName: pairingDeviceName(filepath.Join(lockdownDir, name)),
			ModTime:    info.ModTime().UnixMilli(),
		})
	}
	return records
}

func pairingDeviceName(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	matches := deviceNameRe.FindSubmatch(content)
	if len(matches) <= 1 {
		return ""
	}
	return string(matches[1])
}
