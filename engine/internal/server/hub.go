package server

import (
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const writeWait = 10 * time.Second

// rateLimiter is a simple per-connection token bucket rate limiter.
type rateLimiter struct {
	tokens     float64
	lastUpdate time.Time
	limit      float64
	burst      float64
}

func newRateLimiter(limit, burst float64) *rateLimiter {
	return &rateLimiter{
		tokens:     burst,
		lastUpdate: time.Now(),
		limit:      limit,
		burst:      burst,
	}
}

func (rl *rateLimiter) allow() bool {
	now := time.Now()
	elapsed := now.Sub(rl.lastUpdate).Seconds()
	rl.lastUpdate = now
	rl.tokens += elapsed * rl.limit
	if rl.tokens > rl.burst {
		rl.tokens = rl.burst
	}
	if rl.tokens >= 1.0 {
		rl.tokens -= 1.0
		return true
	}
	return false
}

// client is a single WebSocket connection with a buffered outbound queue.
// loopback marks a connection from the local machine (the desktop window),
// which is allowed to manage remote-access pairing (read the rotating code,
// list/revoke devices) — a LAN/remote client never is.
type client struct {
	conn     *websocket.Conn
	send     chan []byte
	limiter  *rateLimiter
	loopback bool
}

func (c *client) writePump() {
	for msg := range c.send {
		_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

// hub fans engine events out to all connected clients.
type hub struct {
	clients    map[*client]bool
	broadcastC chan []byte
	register   chan *client
	unregister chan *client

	// bytesSent/droppedClients/connected are real, measured counters (not
	// simulated) consumed by the periodic TELEMETRY broadcast — see
	// Server.runTelemetry. atomic because they're read from other goroutines;
	// the `clients` map above must only ever be touched from run().
	bytesSent      atomic.Uint64
	droppedClients atomic.Uint64
	connected      atomic.Int64

	// totalBytesSent/totalDropped mirror bytesSent/droppedClients but are
	// never reset — snapshotAndReset zeroes the other pair every telemetry
	// tick, which would make them useless as Prometheus counters (those must
	// be monotonically increasing for rate()/increase() to work).
	totalBytesSent atomic.Uint64
	totalDropped   atomic.Uint64
}

func newHub() *hub {
	return &hub{
		clients:    make(map[*client]bool),
		broadcastC: make(chan []byte, 64),
		register:   make(chan *client),
		unregister: make(chan *client),
	}
}

func (h *hub) broadcast(msg []byte) { h.broadcastC <- msg }

func (h *hub) run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true
			h.connected.Add(1)
		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
				h.connected.Add(-1)
			}
		case msg := <-h.broadcastC:
			for c := range h.clients {
				select {
				case c.send <- msg:
					n := uint64(len(msg))
					h.bytesSent.Add(n)
					h.totalBytesSent.Add(n)
				default:
					// Slow client: drop it rather than block the hub.
					delete(h.clients, c)
					close(c.send)
					h.droppedClients.Add(1)
					h.totalDropped.Add(1)
					h.connected.Add(-1)
				}
			}
		}
	}
}

// snapshotAndReset returns bytes broadcast and clients dropped for slow
// consumption since the last call, then zeroes both counters.
func (h *hub) snapshotAndReset() (bytes, dropped uint64) {
	return h.bytesSent.Swap(0), h.droppedClients.Swap(0)
}

// totals returns the same two figures as snapshotAndReset, but cumulative
// since startup — suitable for a Prometheus counter, unlike the periodically
// reset pair above.
func (h *hub) totals() (bytesSent, dropped uint64) {
	return h.totalBytesSent.Load(), h.totalDropped.Load()
}

// clientCount returns the number of currently connected WebSocket clients.
// Safe to call from any goroutine (backed by an atomic counter, unlike the
// `clients` map which run() owns exclusively).
func (h *hub) clientCount() int { return int(h.connected.Load()) }
