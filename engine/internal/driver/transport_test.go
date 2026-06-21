package driver

import (
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		addr string
		want domain.ConnectionType
	}{
		{"::1", domain.ConnUSB},                 // bare RSD address (USB loopback)
		{"127.0.0.1:1234", domain.ConnUSB},      // IPv4 host:port
		{"fe80::1%en0", domain.ConnUSB},         // link-local with zone id
		{"192.168.1.42:62078", domain.ConnWiFi}, // routable IPv4
		{"fde6:1234:5678::1", domain.ConnWiFi},  // unique-local IPv6 (go-ios)
		{"", domain.ConnUnknown},
	}
	for _, c := range cases {
		if got := Classify(c.addr); got != c.want {
			t.Errorf("Classify(%q) = %q, want %q", c.addr, got, c.want)
		}
	}
}

func TestParseManual(t *testing.T) {
	t.Run("valid IPv4 host:port", func(t *testing.T) {
		ti, err := ParseManual("192.168.1.50:54321")
		if err != nil {
			t.Fatalf("ParseManual: %v", err)
		}
		if ti.Address != "192.168.1.50" || ti.Port != 54321 {
			t.Errorf("ParseManual = %+v, want 192.168.1.50:54321", ti)
		}
		if ti.Type != domain.ConnWiFi {
			t.Errorf("Type = %q, want WiFi for a routable address", ti.Type)
		}
		if ti.Since.IsZero() {
			t.Error("expected Since to be set")
		}
	})

	t.Run("bracketed IPv6 host:port", func(t *testing.T) {
		ti, err := ParseManual("[fde6:1234::1]:54321")
		if err != nil {
			t.Fatalf("ParseManual: %v", err)
		}
		if ti.Address != "fde6:1234::1" || ti.Port != 54321 {
			t.Errorf("ParseManual = %+v, want fde6:1234::1:54321", ti)
		}
	})

	t.Run("missing port is an error", func(t *testing.T) {
		if _, err := ParseManual("192.168.1.50"); err == nil {
			t.Error("expected an error for an address without a port")
		}
	})

	t.Run("non-numeric port is an error", func(t *testing.T) {
		if _, err := ParseManual("192.168.1.50:not-a-port"); err == nil {
			t.Error("expected an error for a non-numeric port")
		}
	})
}
