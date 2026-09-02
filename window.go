package main

import (
	"encoding/json"
	"os/exec"
)

// Window represents a single window as reported by `niri msg --json windows`.
type Window struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	AppID       string `json:"app_id"`
	PID         int64  `json:"pid"`
	WorkspaceID int64  `json:"workspace_id"`

	IsFocused  bool `json:"is_focused"`
	IsFloating bool `json:"is_floating"`
	IsUrgent   bool `json:"is_urgent"`

	Layout Layout `json:"layout"`
}

// Layout holds position/size info for a window within niri's scrolling layout.
type Layout struct {
	Position           [2]int     `json:"pos_in_scrolling_layout"`
	TileSize           [2]float64 `json:"tile_size"`
	WindowSize         [2]int     `json:"window_size"`
	WindowOffsetInTile [2]float64 `json:"window_offset_in_tile"`
}

// NiriWindows fetches window state via the `niri msg` CLI wrapper.
type NiriWindows struct{}

// GetWindows runs `niri msg --json windows`, parses the result, prints a summary of each window, and returns the parsed slice.
func (n *NiriWindows) GetWindows() ([]Window, error) {
	output, err := exec.Command("niri", "msg", "--json", "windows").Output()
	if err != nil {
		return nil, err
	}

	var windows []Window
	if err := json.Unmarshal(output, &windows); err != nil {
		return nil, err
	}

	// NOTE: Uncomment for debugging, will print the CLI dump in the logs
	// for _, w := range windows {
	// 	printWindow(w)
	//  }

	return windows, nil
}

// write a formatted summary of a single window to stdout.
// NOTE: For debugging
// func printWindow(w Window) {
// 	status := " "
// 	floating := ""
// 	urgency := ""
//
// 	if w.IsFocused {
// 		status = "*"
// 	}
// 	if w.IsFloating {
// 		floating = "Floating\n"
// 	}
// 	if w.IsUrgent {
// 		urgency = "(Urgent)"
// 	}
//
// 	fmt.Printf(
// 		"ID : %d\n%s %s | [%s] %s\n%sAt Workspace %d\nLayout :\nPosition [Column %d, Row %d]\nWindow Size : %d\nTile Size : %g\n\n",
// 		w.ID, w.AppID, w.Title, status, urgency, floating, w.WorkspaceID,
// 		w.Layout.Position[0], w.Layout.Position[1], w.Layout.WindowSize, w.Layout.TileSize)
// }
