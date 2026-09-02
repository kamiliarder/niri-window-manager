package main

import "log"

func main() {
	windowInfo := &NiriWindows{}
	if _, err := windowInfo.GetWindows(); err != nil {
		log.Fatalf("failed to get windows: %v", err)
	}

	niri, err := dialNiri()
	if err != nil {
		log.Fatalf("failed to connect to niri: %v", err)
	}
	defer niri.Close()

	if err := startServer(":6969", niri); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
