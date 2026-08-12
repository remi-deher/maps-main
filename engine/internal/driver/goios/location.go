package goios

import (
	"context"
	"fmt"
	"strconv"
)

// SetLocation injects a spoofed position via `ios setlocation`, targeting the
// device tunnel explicitly by its RSD address+port.
//
// --address/--rsd-port are global go-ios flags, but --pair-record-path is only
// recognized by `tunnel start`; appending lockdown args here makes the CLI
// reject the command as invalid usage.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{
		"setlocation",
		"--address=" + ti.Address,
		"--rsd-port=" + strconv.Itoa(ti.Port),
		"--lat=" + ftoa(lat),
		"--lon=" + ftoa(lon),
	}
	if ti.UserspacePort > 0 {
		args = append(args, "--userspace-port="+strconv.Itoa(ti.UserspacePort))
	}
	if udid := d.getUDID(ctx); udid != "" {
		args = append(args, "--udid="+udid)
	}
	return d.run(ctx, args...)
}

// ClearLocation removes any spoofed position (`ios resetlocation`).
func (d *Driver) ClearLocation(ctx context.Context) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("go-ios: tunnel not started")
	}
	args := []string{
		"resetlocation",
		"--address=" + ti.Address,
		"--rsd-port=" + strconv.Itoa(ti.Port),
	}
	if ti.UserspacePort > 0 {
		args = append(args, "--userspace-port="+strconv.Itoa(ti.UserspacePort))
	}
	if udid := d.getUDID(ctx); udid != "" {
		args = append(args, "--udid="+udid)
	}
	return d.run(ctx, args...)
}

func (d *Driver) run(ctx context.Context, args ...string) error {
	bin, err := d.binPath()
	if err != nil {
		return err
	}
	out, err := execCommandContext(ctx, bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("go-ios %v: %w: %s", args, err, string(out))
	}
	return nil
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
