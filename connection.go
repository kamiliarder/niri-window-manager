package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
)

type actionRequest struct {
	Action map[string]struct{} `json:"Action"`
}

// niriConn wraps a single long-lived connection to the niri socket.
// mu serializes access since niri processes requests on a connection
// strictly in order, and concurrent HTTP requests could otherwise
// interleave writes/reads on the same socket.
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

func (n *niriConn) sendAction(actionName string) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	req := actionRequest{Action: map[string]struct{}{actionName: {}}}

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
