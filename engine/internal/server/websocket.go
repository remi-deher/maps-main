package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/remi-deher/maps-main/engine/internal/api"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true }, // companion/desktop are trusted LAN clients
}

// maxWSMessageBytes bounds a single inbound WebSocket message (PLAY_CUSTOM_GPX
// carries the largest legitimate payload — a GPX file — so this is sized
// generously for that, not for the typical few-hundred-byte action). Without
// a limit a buggy or malicious client could send an arbitrarily large
// message and force an unbounded allocation in ReadMessage.
const maxWSMessageBytes = 16 * 1024 * 1024 // 16 MiB

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxWSMessageBytes)
	c := &client{conn: conn, send: make(chan []byte, 16), limiter: newRateLimiter(10, 20)}
	s.hub.register <- c

	// Greet the new client with the current status.
	c.send <- encode(api.EventStatus, s.eng.Status())

	go c.writePump()
	s.readPump(c)
}

// readPump dispatches inbound envelopes for one client until it disconnects.
func (s *Server) readPump(c *client) {
	defer func() {
		s.hub.unregister <- c
		_ = c.conn.Close()
	}()
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if c.limiter != nil && !c.limiter.allow() {
			slog.Warn("WS client rate limit exceeded, closing connection")
			c.send <- encode(api.EventLog, api.LogEntryPayload{
				Timestamp: time.Now().UnixMilli(),
				Level:     "error",
				Source:    "server",
				Category:  "websocket",
				Action:    "rate_limit",
				Message:   "Rate limit exceeded (10 msg/s). Connection closed.",
			})
			return
		}
		var env api.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			slog.Error("WS read: failed to unmarshal envelope", "error", err, "raw", string(raw))
			continue
		}
		s.dispatch(c, env)
	}
}
