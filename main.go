package main

import "log"

func main() {
	niri, err := dialNiri()
	if err != nil {
		log.Fatalf("failed to connect to niri: %v", err)
	}
	defer niri.Close()

	windowInfo := &NiriWindows{}
	initialWindows, err := windowInfo.GetWindows()
	if err != nil {
		log.Fatalf("failed to get initial windows: %v", err)
	}

	state := NewState()
	state.SetWindows(initialWindows)

	hub := NewHub()
	go runEventStreamForever(state, hub)

	if err := startServer(":8080", niri, state, hub); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
