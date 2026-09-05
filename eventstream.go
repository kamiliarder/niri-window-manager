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

// capture one event line as {"Variant Name": <payload>}, so we can dispatch on the variant name before decoding the payload shape
type eventEnvelope map[string]json.RawMessage

// connects to the socket, request the event stream and keep state in sync as the events arrive, blocks until connection drops, so the caller should run it in a goroutine and reconnect on error
func runEventStream(state *State) error {
	sockPath := os.Getenv("NIRI_SOCKET")
	if sockPath == "" {
		return fmt.Errorf("NIRI_SOCKET environment variable not set")
	}

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return fmt.Errorf("failed to connect to socket: %w", err)
	}
	defer conn.Close()

	// EventStream is a unit-like Request variant, same shape as Windows from the read-only request, no field payload needed
	if _, err := conn.Write([]byte("\"EventStream\"\n")); err != nil {
		return fmt.Errorf("send EventStream request %w", err)
	}
	reader := bufio.NewReader(conn)

	// request acknowledgement, the first line of the response is a single line with the ack, then the rest of the lines are raw events, niri switches connection to push-only once EventStream is requested
	ack, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("read EventStream ack %w", err)
	}
	log.Printf("event stream started (ack: %s)", ack)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return fmt.Errorf("read event line %w", err)
		}

		var env eventEnvelope
		if err := json.Unmarshal([]byte(line), &env); err != nil {
			log.Printf("skipping unparsable event line: %v", err)
			continue
		}

		for variant, payload := range env {
			handleEvent(state, variant, payload)
		}
	}
}

// applies one decoded event to state, unknown variants are logged and skipped
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
	case "WindowLayoutsChanged":
		var body struct {
			Changes []WindowLayoutChange `json:"changes"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			log.Printf("WindowLayoutsChanged: %v", err)
			return
		}
		state.UpdateWindowLayouts(body.Changes)

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
		// WindowLayoutsChaged, KeyboardLayoutsChanged, ConfigLoaded, ScreenshotCaptured // not tracked for this use case, but might be useful later so ill just comment this out
	}
}

func runEventStreamForever(state *State) {
	for {
		if err := runEventStream(state); err != nil {
			log.Printf("event stream error, reconnecting in 2s: %v", err)
		}
		time.Sleep(2 * time.Second)
	}
}
