package pmd3

import (
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// primePyVersion consumes the driver's version-probe sync.Once with a fixed
// (major, minor) so tunneldArgs reads it without shelling out to a real Python.
func primePyVersion(d *Driver, major, minor int) {
	d.pyVerOnce.Do(func() { d.pyMajor, d.pyMinor = major, minor })
}

func TestTunneldArgsForcesTCPOnPython313Plus(t *testing.T) {
	for _, v := range [][2]int{{3, 13}, {3, 14}, {4, 0}} {
		d := &Driver{}
		primePyVersion(d, v[0], v[1])
		got := strings.Join(d.tunneldArgs(), " ")
		if !strings.Contains(got, "--protocol tcp") {
			t.Errorf("python %d.%d: tunneldArgs = %q, want the TCP tunnel forced", v[0], v[1], got)
		}
	}
}

func TestTunneldArgsOmitsProtocolBelowPython313(t *testing.T) {
	// On 3.12 (and when the probe fails, reported as 0.0) TCP isn't available,
	// so we must not pass --protocol and let the daemon keep its QUIC default.
	for _, v := range [][2]int{{3, 12}, {0, 0}} {
		d := &Driver{}
		primePyVersion(d, v[0], v[1])
		got := strings.Join(d.tunneldArgs(), " ")
		if strings.Contains(got, "--protocol") {
			t.Errorf("python %d.%d: tunneldArgs = %q, want no --protocol flag", v[0], v[1], got)
		}
	}
}

func TestTunneldArgsRestrictMonitorsPerTransport(t *testing.T) {
	// The transport selector used to be decoration: driver.Config.Transport was
	// written by the CLI and the SWITCH_DRIVER action and read by nothing. It is
	// tunneld's discovery monitors that decide which side a device is found on.
	cases := []struct {
		transport driver.TransportKind
		want      []string
		reject    []string
	}{
		{driver.TransportAuto, nil, []string{"--no-usb", "--no-wifi", "--no-usbmux", "--no-mobdev2"}},
		{driver.TransportUSB, []string{"--no-wifi", "--no-mobdev2"}, []string{"--no-usb", "--no-usbmux"}},
		{driver.TransportWiFi, []string{"--no-usb", "--no-usbmux"}, []string{"--no-wifi", "--no-mobdev2"}},
	}
	for _, c := range cases {
		d := &Driver{transport: c.transport}
		primePyVersion(d, 3, 13)
		got := strings.Join(d.tunneldArgs(), " ")
		for _, want := range c.want {
			if !strings.Contains(got, want) {
				t.Errorf("transport %s: args %q missing %q", c.transport, got, want)
			}
		}
		for _, reject := range c.reject {
			if strings.Contains(got, reject) {
				t.Errorf("transport %s: args %q must not contain %q", c.transport, got, reject)
			}
		}
	}
}

func TestTunneldArgsUseTheConfiguredPort(t *testing.T) {
	d := &Driver{tunneldPort: 49999}
	primePyVersion(d, 3, 13)
	if got := strings.Join(d.tunneldArgs(), " "); !strings.Contains(got, "--port 49999") {
		t.Errorf("tunneldArgs = %q, want the configured port", got)
	}
	if got := d.baseURL(); got != "http://127.0.0.1:49999/" {
		t.Errorf("baseURL = %q, must follow the port the daemon was launched on", got)
	}
}
