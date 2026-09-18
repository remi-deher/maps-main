package pmd3

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

const infoScript = `
import json, sys
from pymobiledevice3.lockdown import create_using_usbmux
udid = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
try:
    lockdown = create_using_usbmux(udid=udid)
    print(json.dumps({
        "DeviceName": lockdown.device_name,
        "ProductType": lockdown.product_type,
        "ProductVersion": lockdown.product_version,
        "SerialNumber": lockdown.serial_number,
        "UniqueDeviceID": lockdown.udid,
        "WiFiAddress": lockdown.wifi_address,
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`

// DeviceDetails implements driver.DeviceInfoProvider for the pmd3 driver.
func (d *Driver) DeviceDetails(ctx context.Context) (driver.DeviceDetails, error) {
	udid := d.targetUDID
	if udid == "" {
		// Only fall back to "whatever is plugged in" when no device is pinned:
		// reporting devices[0] while injections target targetUDID would describe
		// the wrong iPhone.
		devices, err := d.ListDevices(ctx)
		if err != nil {
			return driver.DeviceDetails{}, err
		}
		if len(devices) == 0 {
			return driver.DeviceDetails{}, fmt.Errorf("pmd3: no device detected")
		}
		udid = devices[0].UDID
	}

	py, err := d.pyCommand()
	if err != nil {
		return driver.DeviceDetails{}, err
	}

	cmd := execCommandContext(ctx, py, "-c", infoScript, udid)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return driver.DeviceDetails{}, fmt.Errorf("pmd3 python error: %s", string(exitErr.Stderr))
		}
		return driver.DeviceDetails{}, fmt.Errorf("pmd3 info execution: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		return driver.DeviceDetails{}, fmt.Errorf("pmd3 info invalid JSON: %w", err)
	}

	details := driver.DeviceDetails{
		UDID:           udid,
		Name:           driver.StringField(raw, "DeviceName"),
		ProductType:    driver.StringField(raw, "ProductType"),
		ProductVersion: driver.StringField(raw, "ProductVersion"),
		SerialNumber:   driver.StringField(raw, "SerialNumber"),
		WifiAddress:    driver.StringField(raw, "WiFiAddress"),
	}
	if ti, ok := d.Tunnel(); ok {
		details.TunnelAddress = ti.Address
	}
	return details, nil
}
