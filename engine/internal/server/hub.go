package server

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// writeWait bounds a single outbound write (including control frames).
	writeWait = 10 * time.Second
	// pongWait is how long readPump waits for any frame (data or pong) before
	// declaring the peer dead; pingPeriod must stay below it so a healthy but
	// idle client is kept alive by pings. Together they let the server evict a
	// silently-gone client (laptop asleep, Wi-Fi dropped) instead of leaking a
	// goroutine + fd blocked forever in ReadMessage.
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

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

// writePump is the single writer for the connection: it drains the outbound
// queue and interleaves periodic pings. It owns closing conn — when the hub
// drops a slow/dead client it closes c.send, which ends this loop, closes conn,
// and thereby unblocks readPump's ReadMessage so its goroutine can exit too.
func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel: tell the peer, then stop.
				_ = c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// hub fans engine events out to all connected clients.
type hub struct {
	clients    map[*client]bool
	broadcastC chan []byte
	register   chan *client
	unregister chan *client
	// done is closed when run() returns (on Shutdown). Senders on the channels
	// above select on it so they can't block forever once the hub has stopped
	// draining them — otherwise a broadcast or a client's unregister issued
	// during shutdown would leak its goroutine.
	done chan struct{}

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
		done:       make(chan struct{}),
	}
}

func (h *hub) broadcast(msg []byte) {
	select {
	case h.broadcastC <- msg:
	case <-h.done:
	}
}

// registerClient / unregisterClient add and remove a connection, but give up
// silently if the hub has already stopped (Shutdown) rather than blocking.
func (h *hub) registerClient(c *client) {
	select {
	case h.register <- c:
	case <-h.done:
	}
}

func (h *hub) unregisterClient(c *client) {
	select {
	case h.unregister <- c:
	case <-h.done:
	}
}

func (h *hub) run(ctx context.Context) {
	defer close(h.done)
	for {
		select {
		case <-ctx.Done():
			return
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
