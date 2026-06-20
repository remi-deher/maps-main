package server

import (
	"time"

	"github.com/gorilla/websocket"
)

const writeWait = 10 * time.Second

// client is a single WebSocket connection with a buffered outbound queue.
type client struct {
	conn *websocket.Conn
	send chan []byte
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
		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
		case msg := <-h.broadcastC:
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow client: drop it rather than block the hub.
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}
