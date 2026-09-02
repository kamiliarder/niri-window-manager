package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// routes is the single place to add, remove, or rebind an HTTP-triggered
// action. Add a new niri action method to actions.go, then add one line here.
func routes(niri *niriConn) map[string]func() error {
	return map[string]func() error{
		"/workspace/up":   niri.moveWorkspaceUp,
		"/workspace/down": niri.moveWorkspaceDown,
		"/window/left":    niri.moveColumnLeft,
		"/window/right":   niri.moveColumnRight,
		"/overview":       niri.Overview,
		"/window/close":   niri.CloseWindow,
	}
}

// startServer wires up an HTTP handler for each route and blocks serving
// until the server errors or is shut down.
func startServer(addr string, niri *niriConn, state *State) error {
	mux := http.NewServeMux()

	for path, action := range routes(niri) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "use POST", http.StatusMethodNotAllowed)
				return
			}
			if err := action(); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		})
	}

	mux.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(state.Snapshot())
	})

	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, mux)
}
