package pmd3

import (
	"context"
	"fmt"
)

// Pair runs `pymobiledevice3 lockdown pair`, which triggers the "Faire
// confiance à cet ordinateur ?" prompt on a USB-connected device and, once
// accepted, writes its Lockdown trust certificate — the prerequisite the
// iOS 17+ WiFi RSD tunnel needs (see docs/IOS_PAIRING_TUNNEL.md). Without
// --udid, pymobiledevice3 targets the first USB device it finds, which is
// fine for the common single-device case; targetUDID (when set) pins it.
func (d *Driver) Pair(ctx context.Context) error {
	py, err := d.pyCommand()
	if err != nil {
		return err
	}
	args := d.args("lockdown", "pair")
	if d.targetUDID != "" {
		args = append(args, "--udid", d.targetUDID)
	}
	out, err := execCommandContext(ctx, py, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("pmd3 lockdown pair: %w: %s", err, string(out))
	}
	return nil
}
