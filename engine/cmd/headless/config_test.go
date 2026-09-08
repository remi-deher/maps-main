package main

import (
	"io"
	"testing"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/driver"
	"github.com/remi-deher/maps-main/engine/internal/settings"
)

// env builds a getenvFunc from a map, so a test states exactly the environment
// it cares about and nothing leaks in from the machine running it.
func env(vars map[string]string) getenvFunc {
	return func(key string) string { return vars[key] }
}

func resolve(t *testing.T, args []string, vars map[string]string) runConfig {
	t.Helper()
	cfg, err := resolveRunConfig(args, env(vars), settings.Default(), io.Discard)
	if err != nil {
		t.Fatalf("resolveRunConfig: %v", err)
	}
	return cfg
}

// With neither flags nor environment, the persisted settings decide — this is
// what a fresh `gpsmock` install actually runs with.
func TestDefaultsComeFromSettings(t *testing.T) {
	def := settings.Default()
	cfg := resolve(t, nil, nil)

	if cfg.driverID != string(def.PreferredDriver) {
		t.Errorf("driverID = %q, want %q", cfg.driverID, def.PreferredDriver)
	}
	if want := ":" + itoa(def.CompanionPort); cfg.addr != want {
		t.Errorf("addr = %q, want %q", cfg.addr, want)
	}
	if cfg.transport != "auto" {
		t.Errorf("transport = %q, want auto", cfg.transport)
	}
	if cfg.clusterNodes != nil {
		t.Errorf("clusterNodes = %v, want nil", cfg.clusterNodes)
	}
}

// The layering that the Docker image and the Windows service both rely on:
// env overrides the built-in default, and an explicit flag overrides env.
func TestFlagBeatsEnvBeatsDefault(t *testing.T) {
	vars := map[string]string{
		"GPSMOCK_DRIVER": "go-ios",
		"GPSMOCK_ADDR":   ":9999",
	}

	fromEnv := resolve(t, nil, vars)
	if fromEnv.driverID != "go-ios" || fromEnv.addr != ":9999" {
		t.Fatalf("env not applied: driver=%q addr=%q", fromEnv.driverID, fromEnv.addr)
	}

	fromFlag := resolve(t, []string{"-driver", "pymobiledevice", "-addr", ":7777"}, vars)
	if fromFlag.driverID != "pymobiledevice" {
		t.Errorf("driverID = %q, want the flag to win", fromFlag.driverID)
	}
	if fromFlag.addr != ":7777" {
		t.Errorf("addr = %q, want the flag to win", fromFlag.addr)
	}
}

func TestBooleanEnvSpellings(t *testing.T) {
	for _, v := range []string{"1", "true", "yes"} {
		if cfg := resolve(t, nil, map[string]string{"GPSMOCK_NO_TUNNEL": v}); !cfg.noTunnel {
			t.Errorf("GPSMOCK_NO_TUNNEL=%q did not enable noTunnel", v)
		}
	}
	for _, v := range []string{"", "0", "false", "no", "TRUE"} {
		if cfg := resolve(t, nil, map[string]string{"GPSMOCK_NO_TUNNEL": v}); cfg.noTunnel {
			t.Errorf("GPSMOCK_NO_TUNNEL=%q unexpectedly enabled noTunnel", v)
		}
	}
}

func TestDurationsFromEnv(t *testing.T) {
	cfg := resolve(t, nil, map[string]string{
		"GPSMOCK_TUNNEL_START_TIMEOUT": "30s",
		"GPSMOCK_ACTION_TIMEOUT":       "2m",
	})
	if cfg.tunnelStartTimeout != 30*time.Second {
		t.Errorf("tunnelStartTimeout = %s, want 30s", cfg.tunnelStartTimeout)
	}
	if cfg.actionTimeout != 2*time.Minute {
		t.Errorf("actionTimeout = %s, want 2m", cfg.actionTimeout)
	}
}

// A typo in a service env file must not stop the engine from booting — it falls
// back to the built-in default instead.
func TestMalformedDurationFallsBackInsteadOfFailing(t *testing.T) {
	cfg := resolve(t, nil, map[string]string{"GPSMOCK_SHUTDOWN_TIMEOUT": "5 seconds"})
	if cfg.shutdownTimeout != 5*time.Second {
		t.Errorf("shutdownTimeout = %s, want the 5s default", cfg.shutdownTimeout)
	}
}

func TestClusterNodesSplitting(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want []string
	}{
		{"", nil},
		{"   ", nil},
		{"host1:8080", []string{"host1:8080"}},
		{"host1:8080,host2:8080", []string{"host1:8080", "host2:8080"}},
		// A trailing comma or copy-pasted spaces used to yield an empty peer
		// that every dial then failed on.
		{"host1:8080,", []string{"host1:8080"}},
		{" host1:8080 , host2:8080 ", []string{"host1:8080", "host2:8080"}},
		{",,,", nil},
	} {
		got := splitClusterNodes(tc.raw)
		if len(got) != len(tc.want) {
			t.Errorf("splitClusterNodes(%q) = %v, want %v", tc.raw, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("splitClusterNodes(%q) = %v, want %v", tc.raw, got, tc.want)
				break
			}
		}
	}
}

func TestParseTransport(t *testing.T) {
	for raw, want := range map[string]driver.TransportKind{
		"usb":      driver.TransportUSB,
		"wifi":     driver.TransportWiFi,
		"auto":     driver.TransportAuto,
		"":         driver.TransportAuto,
		"nonsense": driver.TransportAuto,
	} {
		if got := parseTransport(raw); got != want {
			t.Errorf("parseTransport(%q) = %v, want %v", raw, got, want)
		}
	}
}

// The portable Windows build fills in the extracted driver paths, but must
// never override a path the operator gave explicitly.
func TestBundledDriverPathsOnlyFillGaps(t *testing.T) {
	cfg := runConfig{goiosBin: "C:/mine/ios.exe"}
	applyBundledDriverPaths(&cfg, "C:/bundled/ios.exe", "C:/bundled/python.exe")

	if cfg.goiosBin != "C:/mine/ios.exe" {
		t.Errorf("goiosBin = %q, want the explicit path preserved", cfg.goiosBin)
	}
	if cfg.pythonBin != "C:/bundled/python.exe" {
		t.Errorf("pythonBin = %q, want the bundled path filled in", cfg.pythonBin)
	}
}

func TestUnknownFlagIsAnError(t *testing.T) {
	if _, err := resolveRunConfig([]string{"-nope"}, env(nil), settings.Default(), io.Discard); err == nil {
		t.Fatal("resolveRunConfig accepted an unknown flag, want an error")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
