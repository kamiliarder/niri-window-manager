package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
)

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

type Layout struct {
	Position   [2]int     `json:"pos_in_scrolling_layout"`
	TileSize   [2]float64 `json:"tile_size"`
	WindowSize [2]int     `json:"window_size"`
	// TilePosInWorkspaceView *[2]float64 `json:"tile_pos_in_workspace_view"` NOTE: this boy always returns null idk why
	WindowOffsetInTile [2]float64 `json:"window_offset_in_tile"`
}

type NiriClient struct{}

func (n *NiriClient) GetWindows() ([]Window, error) {
	output, err := exec.Command("niri", "msg", "--json", "windows").Output()

	if err != nil {
		return nil, err
	}

	var windows []Window
	if err := json.Unmarshal(output, &windows); err != nil {
		return nil, err
	}

	return windows, nil

}

func main() {
	niriClient := &NiriClient{}

	windows, err := niriClient.GetWindows()
	if err != nil {
		log.Fatal(err)
	}

	for _, w := range windows {
		status := " "
		floating := ""
		urgency := ""

		if w.IsFocused {
			status = "*" // Mark focused window
		}
		if w.IsFloating {
			floating = "Floating\n"
		}
		if w.IsUrgent {
			urgency = "(Urgent)"
		}

		fmt.Printf(
			"ID : %d\n%s %s | [%s] %s\n%sAt Workspace %d\nLayout :\nPosition %d\nWindow Size : %d\nTile Size : %g\n\n",
			w.ID, w.AppID, w.Title, status, urgency, floating, w.WorkspaceID, w.Layout.Position, w.Layout.WindowSize, w.Layout.TileSize)
	}

}
