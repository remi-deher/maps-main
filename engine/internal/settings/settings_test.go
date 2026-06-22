package settings

import (
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func TestDefault(t *testing.T) {
	def := Default()

	if def.CompanionPort != 8080 {
		t.Errorf("expected default companion port 8080, got %d", def.CompanionPort)
	}

	if def.PreferredDriver != domain.DriverGoIos {
		t.Errorf("expected preferred driver go-ios, got %s", def.PreferredDriver)
	}

	if def.UsbDriver != domain.DriverGoIos {
		t.Errorf("expected usb driver go-ios, got %s", def.UsbDriver)
	}

	if def.WifiDriver != domain.DriverGoIos {
		t.Errorf("expected wifi driver go-ios, got %s", def.WifiDriver)
	}

	if !def.EveilMode {
		t.Errorf("expected EveilMode to be true by default")
	}

	if def.EveilInterval != 5 {
		t.Errorf("expected EveilInterval to be 5, got %d", def.EveilInterval)
	}

	if !def.FallbackEnabled {
		t.Errorf("expected FallbackEnabled to be true by default")
	}

	if !def.NotificationsEnabled {
		t.Errorf("expected NotificationsEnabled to be true by default")
	}

	if !def.DynamicIslandEnabled {
		t.Errorf("expected DynamicIslandEnabled to be true by default")
	}

	if !def.JitterEnabled {
		t.Errorf("expected JitterEnabled to be true by default")
	}
}
