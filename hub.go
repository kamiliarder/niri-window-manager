package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// upgrader allows any origin for now — fine for local/dev use, but worth
// restricting to your actual UI's origin before this leaves your machine,
// same caveat as the missing auth on the action endpoints.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Hub tracks connected websocket clients and pushes state snapshots to
// all of them whenever niri state changes — no client-side polling.
type Hub struct {
	mu      sync.Mutex
	clients map[*wsClient]struct{}
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*wsClient]struct{})}
}

// ServeWS upgrades an HTTP connection to a websocket, registers it, and
// immediately sends the current snapshot so a new client doesn't have to
// wait for the next event to see anything.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, initial Snapshot) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}

	client := &wsClient{conn: conn, send: make(chan []byte, 16)}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	if payload, err := json.Marshal(initial); err == nil {
		client.send <- payload
	}

	go client.writePump()
	go h.readPump(client)
}

// writePump is the only goroutine allowed to write to this client's
// connection — gorilla/websocket connections aren't safe for concurrent
// writes, so all sends must funnel through one goroutine per client.
func (c *wsClient) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

// readPump drains and discards any incoming messages — this is a
// push-only feed, clients aren't expected to send anything — and detects
// disconnects so the client gets cleaned up from the hub.
func (h *Hub) readPump(c *wsClient) {
	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		close(c.send)
	}()
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

// Broadcast sends a snapshot to every connected client. A client whose
// send buffer is full (too slow to keep up) is dropped rather than
// allowed to block the broadcast for everyone else.
func (h *Hub) Broadcast(snapshot Snapshot) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		log.Printf("broadcast marshal error: %v", err)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- payload:
		default:
			delete(h.clients, c)
			close(c.send)
		}
	}
}
