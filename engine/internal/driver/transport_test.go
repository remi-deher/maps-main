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
