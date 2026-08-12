package pmd3

import (
	"strings"
	"testing"
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
		if got != "remote tunneld --protocol tcp" {
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
		if got != "remote tunneld" {
			t.Errorf("python %d.%d: tunneldArgs = %q, want no --protocol flag", v[0], v[1], got)
		}
	}
}
