package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"time"
)

// eventEnvelope captures one raw event line as {"VariantName": <payload>}
// so we can dispatch on the variant name before decoding the payload shape.
type eventEnvelope map[string]json.RawMessage

// WindowLayoutChange decodes one (id, layout) tuple from WindowLayoutsChanged.
// Niri serializes Rust tuples as 2-element JSON arrays, e.g. [42, {...}],
// so this can't be a plain struct with json tags — it needs custom decoding.
type WindowLayoutChange struct {
	ID     int64
	Layout Layout
}

func (c *WindowLayoutChange) UnmarshalJSON(data []byte) error {
	var pair [2]json.RawMessage
	if err := json.Unmarshal(data, &pair); err != nil {
		return err
	}
	if err := json.Unmarshal(pair[0], &c.ID); err != nil {
		return err
	}
	return json.Unmarshal(pair[1], &c.Layout)
}

// runEventStream connects to $NIRI_SOCKET, requests the event stream, and
// keeps state in sync as events arrive, broadcasting an updated snapshot
// to every connected websocket client after each event line. It blocks
// until the connection drops, so the caller should run it in a goroutine
// and reconnect on error.
func runEventStream(state *State, hub *Hub) error {
	sockPath := os.Getenv("NIRI_SOCKET")
	if sockPath == "" {
		return fmt.Errorf("NIRI_SOCKET is not set")
	}

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return fmt.Errorf("dial niri socket: %w", err)
	}
	defer conn.Close()

	// "EventStream" is a unit-like Request variant — same bare-string shape
	// as "Windows" from the read-only requests. No field payload needed.
	if _, err := conn.Write([]byte("\"EventStream\"\n")); err != nil {
		return fmt.Errorf("send EventStream request: %w", err)
	}

	reader := bufio.NewReader(conn)

	// The first line is the Reply acknowledging the request itself
	// (e.g. {"Ok":"Handled"}). Every line after that is a raw Event,
	// not wrapped in a Reply — niri switches the connection into
	// push-only mode once EventStream is requested.
	ack, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("read event-stream ack: %w", err)
	}
	log.Printf("event stream started (ack: %s)", ack)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return fmt.Errorf("event stream closed: %w", err)
		}

		var env eventEnvelope
		if err := json.Unmarshal([]byte(line), &env); err != nil {
			log.Printf("skipping unparsable event line: %v", err)
			continue
		}

		for variant, payload := range env {
			handleEvent(state, variant, payload)
		}

		// Push the updated state to every connected client. One
		// broadcast per received line keeps this in lockstep with
		// niri's own event cadence — no polling interval to tune.
		hub.Broadcast(state.Snapshot())
	}
}

// handleEvent applies one decoded event to state. Unknown/unhandled
// variants are logged and skipped rather than treated as fatal — niri
// has added new event variants before (e.g. CastsChanged), and a client
// that errors out on an unrecognized one is needlessly fragile.
func handleEvent(state *State, variant string, payload json.RawMessage) {
	switch variant {

	case "WindowsChanged":
		var body struct {
			Windows []Window `json:"windows"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowsChanged: %v", err)
			return
		}
		state.SetWindows(body.Windows)

	case "WindowOpenedOrChanged":
		var body struct {
			Window Window `json:"window"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowOpenedOrChanged: %v", err)
			return
		}
		state.UpsertWindow(body.Window)

	case "WindowClosed":
		var body struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowClosed: %v", err)
			return
		}
		state.RemoveWindow(body.ID)

	case "WindowFocusChanged":
		var body struct {
			ID *int64 `json:"id"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowFocusChanged: %v", err)
			return
		}
		state.SetFocusedWindow(body.ID)

	case "WindowLayoutsChanged":
		var body struct {
			Changes []WindowLayoutChange `json:"changes"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowLayoutsChanged: %v", err)
			return
		}
		state.UpdateWindowLayouts(body.Changes)

	case "WindowUrgencyChanged":
		var body struct {
			ID     int64 `json:"id"`
			Urgent bool  `json:"urgent"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowUrgencyChanged: %v", err)
			return
		}
		state.SetWindowUrgent(body.ID, body.Urgent)

	case "WorkspacesChanged":
		var body struct {
			Workspaces []Workspace `json:"workspaces"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WorkspacesChanged: %v", err)
			return
		}
		state.SetWorkspaces(body.Workspaces)

	case "WorkspaceActivated":
		var body struct {
			ID      uint64 `json:"id"`
			Focused bool   `json:"focused"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WorkspaceActivated: %v", err)
			return
		}
		state.ActivateWorkspace(body.ID, body.Focused)

	case "WorkspaceActiveWindowChanged":
		var body struct {
			WorkspaceID    uint64  `json:"workspace_id"`
			ActiveWindowID *uint64 `json:"active_window_id"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WorkspaceActiveWindowChanged: %v", err)
			return
		}
		state.SetWorkspaceActiveWindow(body.WorkspaceID, body.ActiveWindowID)

	case "WorkspaceUrgencyChanged":
		var body struct {
			ID     uint64 `json:"id"`
			Urgent bool   `json:"urgent"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WorkspaceUrgencyChanged: %v", err)
			return
		}
		state.SetWorkspaceUrgent(body.ID, body.Urgent)

	default:
		// WindowFocusTimestampChanged, KeyboardLayoutsChanged,
		// KeyboardLayoutSwitched, OverviewOpenedOrClosed, ConfigLoaded,
		// ScreenshotCaptured, Casts* — not tracked for this use case.
	}
}

// runEventStreamForever keeps the event stream alive, reconnecting with a
// short backoff if niri restarts or the socket drops.
func runEventStreamForever(state *State, hub *Hub) {
	for {
		if err := runEventStream(state, hub); err != nil {
			log.Printf("event stream error, reconnecting in 2s: %v", err)
		}
		time.Sleep(2 * time.Second)
	}
}
