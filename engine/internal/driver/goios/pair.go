package goios

import (
	"context"
	"fmt"
)

// Pair runs `ios pair`, which triggers the "Faire confiance à cet
// ordinateur ?" prompt on a USB-connected device and, once accepted, writes
// its Lockdown trust certificate — the prerequisite the iOS 17+ WiFi RSD
// tunnel needs (see docs/IOS_PAIRING_TUNNEL.md). --pair-record-path isn't a
// recognized flag here (only `tunnel start` accepts it, same constraint as
// SetLocation — see location.go), so lockdownArgs is deliberately not
// appended.
func (d *Driver) Pair(ctx context.Context) error {
	bin, err := d.binPath()
	if err != nil {
		return err
	}
	args := []string{"pair"}
	if udid := d.getUDID(ctx); udid != "" {
		args = append(args, "--udid="+udid)
	}
	out, err := execCommandContext(ctx, bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("go-ios pair: %w: %s", err, string(out))
	}
	return nil
}
