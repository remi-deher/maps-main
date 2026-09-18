package driver

import (
	"testing"
	"time"
)

func TestStartBudgetLeavesRoomForTheUserspaceFallback(t *testing.T) {
	const perAttempt = 90 * time.Second
	got := StartBudget(perAttempt)

	// The whole point: a budget that only covers one attempt makes StartTunnel
	// return on ctx.Err() before it can retry in userspace mode.
	if got <= 2*perAttempt {
		t.Errorf("StartBudget(%s) = %s, must exceed two full attempts", perAttempt, got)
	}
}

func TestStartBudgetHandlesZero(t *testing.T) {
	if got := StartBudget(0); got <= 0 {
		t.Errorf("StartBudget(0) = %s, want a usable default", got)
	}
}
