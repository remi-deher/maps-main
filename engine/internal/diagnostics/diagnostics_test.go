package diagnostics

import (
	"context"
	"strings"
	"testing"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

type failingLister struct {
	err error
}

func (f failingLister) ListDevices(context.Context) ([]driver.Device, error) {
	return nil, f.err
}

func TestPairingHintTreatsDeadlineExceededAsDriverTimeout(t *testing.T) {
	hint := PairingHint(context.Background(), failingLister{err: context.DeadlineExceeded})

	if !strings.Contains(hint, "commande du pilote a depasse son delai") {
		t.Fatalf("expected driver timeout hint, got %q", hint)
	}
	if strings.Contains(hint, "Apple Mobile Device Service / iTunes") {
		t.Fatalf("timeout hint should not blame Apple Mobile Device Service: %q", hint)
	}
}
