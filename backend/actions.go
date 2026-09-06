package main

import "fmt"

func (n *niriConn) moveWorkspaceUp() error {
	reply, err := n.sendAction("FocusWorkspaceUp")
	if err == nil {
		fmt.Printf("↑ moved workspace up | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveWorkspaceDown() error {
	reply, err := n.sendAction("FocusWorkspaceDown")
	if err == nil {
		fmt.Printf("↓ moved workspace down | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveColumnRight() error {
	reply, err := n.sendAction("MoveColumnRight")
	if err == nil {
		fmt.Printf("→ moved column right | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveColumnLeft() error {
	reply, err := n.sendAction("MoveColumnLeft")
	if err == nil {
		fmt.Printf("← moved column left | reply: %s", reply)
	}
	return err
}

func (n *niriConn) Overview() error {
	reply, err := n.sendAction("ToggleOverview")
	if err == nil {
		fmt.Printf("toggled overview | reply: %s", reply)
	}
	return err
}

func (n *niriConn) CloseWindow() error {
	reply, err := n.sendAction("CloseWindow")
	if err == nil {
		fmt.Printf("Closed Window | reply: %s", reply)
	}
	return err
}

func (n *niriConn) SwitchPresetColumnWidth() error {
	reply, err := n.sendAction("SwitchPresetColumnWidth")
	if err == nil {
		fmt.Printf("Switched Preset Column Width | reply: %s", reply)
	}
	return err
}

// focusWindow focuses a specific window by id — FocusWindow{id} is a
// required (non-optional) field per niri-ipc, so id must be a real window id.
func (n *niriConn) focusWindow(id uint64) error {
	reply, err := n.sendActionWithPayload("FocusWindow", struct {
		ID uint64 `json:"id"`
	}{ID: id})
	if err == nil {
		fmt.Printf("● focused window %d | reply: %s", id, reply)
	}
	return err
}

// closeWindow closes a specific window by id. CloseWindow{id} accepts the
// id directly — no focus step needed, unlike the column actions below.
func (n *niriConn) closeWindow(id uint64) error {
	reply, err := n.sendActionWithPayload("CloseWindow", struct {
		ID uint64 `json:"id"`
	}{ID: id})
	if err == nil {
		fmt.Printf("✕ closed window %d | reply: %s", id, reply)
	}
	return err
}

// moveColumnToIndex moves a specific window's column to a target index.
// MoveColumnToIndex has no id field — it only ever acts on the focused
// column — so this focuses the window first, then issues the move.
// index is 1-based per niri's convention (index 1 = first column).
func (n *niriConn) moveColumnToIndex(windowID uint64, index uint64) error {
	if err := n.focusWindow(windowID); err != nil {
		return fmt.Errorf("focus before move: %w", err)
	}
	reply, err := n.sendActionWithPayload("MoveColumnToIndex", struct {
		Index uint64 `json:"index"`
	}{Index: index})
	if err == nil {
		fmt.Printf("⇄ moved window %d's column to index %d | reply: %s", windowID, index, reply)
	}
	return err
}

// switchPresetColumnWidth cycles a specific window's column through preset
// widths. SwitchPresetColumnWidth has no fields at all — same "focused
// column only" constraint as above — so this focuses first, then switches.
func (n *niriConn) switchPresetColumnWidth(windowID uint64) error {
	if err := n.focusWindow(windowID); err != nil {
		return fmt.Errorf("focus before resize: %w", err)
	}
	reply, err := n.sendAction("SwitchPresetColumnWidth")
	if err == nil {
		fmt.Printf("↔ switched preset column width for window %d | reply: %s", windowID, reply)
	}
	return err
}
