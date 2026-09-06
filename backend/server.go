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
		// "/window/close":   niri.CloseWindow,
		"/window/width": niri.SwitchPresetColumnWidth,
	}
}

// decodeIDBody reads {"id": <uint64>} from a request body — shared by every
// parameterized action handler below.
func decodeIDBody(r *http.Request) (uint64, error) {
	var body struct {
		ID uint64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return 0, err
	}
	return body.ID, nil
}

func startServer(addr string, niri *niriConn, state *State, hub *Hub) error {
	mux := http.NewServeMux()

	for path, action := range routes(niri) {
		path, action := path, action
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

	mux.HandleFunc("/window/focus", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		id, err := decodeIDBody(r)
		if err != nil {
			http.Error(w, `invalid body, expected {"id": <window_id>}`, http.StatusBadRequest)
			return
		}
		if err := niri.focusWindow(id); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/window/close", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		id, err := decodeIDBody(r)
		if err != nil {
			http.Error(w, `invalid body, expected {"id": <window_id>}`, http.StatusBadRequest)
			return
		}
		if err := niri.closeWindow(id); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Body: {"id": <window_id>, "index": <target_column_index, 1-based>}
	mux.HandleFunc("/window/move-to-column", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			ID    uint64 `json:"id"`
			Index uint64 `json:"index"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `invalid body, expected {"id": <window_id>, "index": <target_index>}`, http.StatusBadRequest)
			return
		}
		if err := niri.moveColumnToIndex(body.ID, body.Index); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/window/switch-preset-width", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "use POST", http.StatusMethodNotAllowed)
			return
		}
		id, err := decodeIDBody(r)
		if err != nil {
			http.Error(w, `invalid body, expected {"id": <window_id>}`, http.StatusBadRequest)
			return
		}
		if err := niri.switchPresetColumnWidth(id); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(state.Snapshot())
	})

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, state.Snapshot())
	})

	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, mux)
}
