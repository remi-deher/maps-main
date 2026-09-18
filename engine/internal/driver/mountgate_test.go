package driver

import "testing"

func TestMountGateOnlyShortCircuitsTheSameDevice(t *testing.T) {
	var g MountGate
	if g.Mounted("udid-1") {
		t.Error("a fresh gate must not claim anything is mounted")
	}
	g.MarkMounted("udid-1")
	if !g.Mounted("udid-1") {
		t.Error("gate must short-circuit the device it observed")
	}
	if g.Mounted("udid-2") {
		t.Error("gate must not speak for a device it never observed")
	}
	g.Forget()
	if g.Mounted("udid-1") {
		t.Error("Forget must make the next attempt check again")
	}
}
