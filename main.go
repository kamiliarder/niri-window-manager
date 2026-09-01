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
	PosInScrollingLayout   [2]int      `json:"pos_in_scrolling_layout"`
	TileSize               [2]float64  `json:"tile_size"`
	WindowSize             [2]int      `json:"window_size"`
	TilePosInWorkspaceView *[2]float64 `json:"tile_pos_in_workspace_view"`
	WindowOffsetInTile     [2]float64  `json:"window_offset_in_tile"`
}

func main() {
	winInfo, err := exec.Command("niri", "msg", "--json", "windows").CombinedOutput()

	if err != nil {
		fmt.Printf("Error msg : %s\n", string(winInfo))
		log.Fatalf("Execution fail, %v", err)
	}

	var Windows []Window
	if err := json.Unmarshal(winInfo, &Windows); err != nil {
		log.Fatalf("Error parsing JSON: %v", err)
	}

	fmt.Println("Active Windows:")
	for _, w := range Windows {
		status := " "
		if w.IsFocused {
			status = "*" // Mark focused window
		}
		fmt.Printf("[%s] %d | %s (%s)\n", status, w.ID, w.Title, w.AppID)
	}
}
