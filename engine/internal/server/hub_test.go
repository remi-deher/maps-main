package server

import (
	"testing"
	"time"
)

func TestHubTracksBytesSentAndClientCount(t *testing.T) {
	h := newHub()
	go h.run()

	c := &client{send: make(chan []byte, 16)}
	h.register <- c
	waitForClientCount(t, h, 1)

	h.broadcast([]byte("hello"))
	// Drain so the hub's send doesn't block past the buffered channel.
	select {
	case <-c.send:
	case <-time.After(time.Second):
		t.Fatal("expected broadcast message to be queued for the client")
	}

	// The hub increments bytesSent right after the channel send, in the same
	// goroutine — but the channel receive above only guarantees the message
	// was delivered, not that the following increment has executed yet (a
	// buffered channel's receive doesn't synchronize with code the sender
	// runs after the send). Poll briefly instead of assuming it's already
	// visible.
	var bytesSent, dropped uint64
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		bytesSent, dropped = h.snapshotAndReset()
		if bytesSent != 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if bytesSent != uint64(len("hello")) {
		t.Fatalf("bytesSent = %d, want %d", bytesSent, len("hello"))
	}
	if dropped != 0 {
		t.Fatalf("dropped = %d, want 0", dropped)
	}

	h.unregister <- c
	waitForClientCount(t, h, 0)
}

func TestHubDropsSlowClientAndCountsIt(t *testing.T) {
	h := newHub()
	go h.run()

	// Unbuffered send channel that nobody reads from: the very first
	// broadcast will find it full and the hub must drop the client.
	c := &client{send: make(chan []byte)}
	h.register <- c
	waitForClientCount(t, h, 1)

	h.broadcast([]byte("x"))

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if h.clientCount() == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := h.clientCount(); got != 0 {
		t.Fatalf("expected slow client to be dropped, clientCount = %d", got)
	}

	_, dropped := h.snapshotAndReset()
	if dropped != 1 {
		t.Fatalf("dropped = %d, want 1", dropped)
	}
}

func waitForClientCount(t *testing.T, h *hub, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if h.clientCount() == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("clientCount never reached %d, got %d", want, h.clientCount())
}
