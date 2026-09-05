package main

import "log"

func main() {
	windowInfo := &NiriWindows{}

	niri, err := dialNiri()
	if err != nil {
		log.Fatalf("failed to connect to niri: %v", err)
	}
	defer niri.Close()

	initialWindows, err := windowInfo.GetWindows()
	if err != nil {
		log.Fatalf("failed to get initial windows: %v", err)
	}

	initialWorkspaces, err := (&NiriWorkspaces{}).getWorkspaces()
	if err != nil {
		log.Fatalf("failed to get initial workspaces: %v", err)
	}

	state := NewState()
	state.SetWindows(initialWindows)
	state.SetWorkspaces(initialWorkspaces)
	go runEventStreamForever(state)

	if err := startServer(":6969", niri, state); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
