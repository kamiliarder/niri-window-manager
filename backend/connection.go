package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
)

// actionRequest for zero-field Action variants — {"Action":{"Name":{}}}.
type actionRequest struct {
	Action map[string]struct{} `json:"Action"`
}

// actionRequestWithPayload for Action variants that carry fields — e.g.
// {"Action":{"FocusWindow":{"id":7}}}. payload is pre-marshaled JSON so
// this stays generic across different field shapes (id-only, id+index, etc).
type actionRequestWithPayload struct {
	Action map[string]json.RawMessage `json:"Action"`
}

type niriConn struct {
	mu     sync.Mutex
	conn   net.Conn
	reader *bufio.Reader
}

func dialNiri() (*niriConn, error) {
	sockPath := os.Getenv("NIRI_SOCKET")
	if sockPath == "" {
		return nil, fmt.Errorf("NIRI_SOCKET is not set")
	}
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return nil, fmt.Errorf("dial niri socket: %w", err)
	}
	return &niriConn{conn: conn, reader: bufio.NewReader(conn)}, nil
}

// sendAction sends a zero-field Action variant, e.g. "MoveWorkspaceUp".
func (n *niriConn) sendAction(actionName string) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	req := actionRequest{Action: map[string]struct{}{actionName: {}}}
	return n.writeAndRead(req)
}

// sendActionWithPayload sends an Action variant that carries fields, e.g.
// FocusWindow{id}. payload should be a Go value that marshals to the
// variant's field object, e.g. struct{ ID uint64 `json:"id"` }{7}.
func (n *niriConn) sendActionWithPayload(actionName string, payload any) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	fieldsJSON, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal action payload: %w", err)
	}

	req := actionRequestWithPayload{
		Action: map[string]json.RawMessage{actionName: fieldsJSON},
	}
	return n.writeAndRead(req)
}

// writeAndRead marshals req, writes it as one line, and reads back one
// reply line. Shared by both send helpers — must be called with n.mu held.
func (n *niriConn) writeAndRead(req any) (string, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}
	if _, err := n.conn.Write(append(payload, '\n')); err != nil {
		return "", fmt.Errorf("write request: %w", err)
	}
	return n.reader.ReadString('\n')
}

func (n *niriConn) Close() error {
	return n.conn.Close()
}
