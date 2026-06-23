package pmd3

import (
	"context"
	"fmt"
	"strconv"
)

// SetLocation injects a spoofed position via simulate-location set.
func (d *Driver) SetLocation(ctx context.Context, lat, lon float64) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("pmd3: tunnel not started")
	}
	return d.run(ctx, "developer", "dvt", "simulate-location", "set",
		"--rsd", ti.Address, strconv.Itoa(ti.Port), "--", ftoa(lat), ftoa(lon))
}

// ClearLocation removes any spoofed position via simulate-location clear.
func (d *Driver) ClearLocation(ctx context.Context) error {
	ti, ok := d.Tunnel()
	if !ok {
		return fmt.Errorf("pmd3: tunnel not started")
	}
	return d.run(ctx, "developer", "dvt", "simulate-location", "clear",
		"--rsd", ti.Address, strconv.Itoa(ti.Port))
}

func (d *Driver) run(ctx context.Context, extra ...string) error {
	py, err := d.pyCommand()
	if err != nil {
		return err
	}
	args := d.args(extra...)
	out, err := execCommandContext(ctx, py, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("pmd3 %v: %w: %s", extra, err, string(out))
	}
	return nil
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
