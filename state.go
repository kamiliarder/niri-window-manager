package main

import (
	"sync"
)

// workspace mirror for tracking which workspace is focused
type Workspace struct {
	ID             uint64  `json:"id"`
	Idx            uint8   `json:"idx"`
	Name           *string `json:"name"`
	Output         *string `json:"output"`
	ActiveWindowID *uint64 `json:"active_window_id"`
	IsUrgent       bool    `json:"is_urgent"`
	IsActive       bool    `json:"is_active"`
	IsFocused      bool    `json:"is_focused"`
}

// in-memory cache to sync with the event stream, all access go thru the methods, callers never touch the map directly
type State struct {
	mu              sync.RWMutex
	windows         map[int64]Window
	workspaces      map[uint64]Workspace
	focusedWindowID *int64
}

func NewState() *State {
	return &State{
		windows:    make(map[int64]Window),
		workspaces: make(map[uint64]Workspace),
	}
}

type NiriWorkspaces struct{}

// self explanatory, a snapshot of the current state
type Snapshot struct {
	Windows         []Window    `json:"windows"`
	Workspaces      []Workspace `json:"workspaces"`
	FocusedWindowID *int64      `json:"focused_window_id"`
}

func (s *State) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	windows := make([]Window, 0, len(s.windows))
	for _, w := range s.windows {
		windows = append(windows, w)
	}
	workspaces := make([]Workspace, 0, len(s.workspaces))
	for _, ws := range s.workspaces {
		workspaces = append(workspaces, ws)
	}
	return Snapshot{
		Windows:         windows,
		Workspaces:      workspaces,
		FocusedWindowID: s.focusedWindowID,
	}
}

// mutator
func (s *State) SetWindows(windows []Window) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.windows = make(map[int64]Window, len(windows))
	for _, w := range windows {
		s.windows[w.ID] = w
	}
}

// one per event that touches state

func (s *State) UpsertWindow(w Window) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.windows[w.ID] = w
}

func (s *State) RemoveWindow(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.windows, id)
}

// clear flag on previous then set the new one (for focused window)
func (s *State) SetFocusedWindow(id *int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.focusedWindowID != nil {
		if w, ok := s.windows[*s.focusedWindowID]; ok {
			w.IsFocused = false
			s.windows[*s.focusedWindowID] = w
		}
	}
	s.focusedWindowID = id
	if id != nil {
		if w, ok := s.windows[*id]; ok {
			w.IsFocused = true
			s.windows[*id] = w
		}
	}
}

func (s *State) SetWorkspaces(list []Workspace) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaces = make(map[uint64]Workspace, len(list))
	for _, ws := range list {
		s.workspaces[ws.ID] = ws
	}
}

func (s *State) ActivateWorkspace(id uint64, focused bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, ok := s.workspaces[id]
	if !ok {
		return
	}
	for otherID, other := range s.workspaces {
		if target.Output != nil && other.Output != nil && *other.Output == *target.Output {
			other.IsActive = otherID == id
		}
		if focused {
			other.IsFocused = otherID == id
		}
		s.workspaces[otherID] = other
	}

}

// func (n *NiriWorkspaces) getWorkspaces() ([]Workspace, error) {
// 	output, err := exec.Command("niri", "msg", "--json", "workspaces").Output()
// 	if err != nil {
// 		return nil, err
// 	}
// 	var workspaces []Workspace
// 	if err := json.Unmarshal(output, &workspaces); err != nil {
// 		return nil, err
// 	}
// 	return workspaces, nil
// }

// UpdateWindowLayouts applies a batch of position/size changes — the event
// niri sends for resizes, drags, and column reordering, without resending
// the full window object.
func (s *State) UpdateWindowLayouts(changes []WindowLayoutChange) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range changes {
		if w, ok := s.windows[c.ID]; ok {
			w.Layout = c.Layout
			s.windows[c.ID] = w
		}
	}
}

func (s *State) SetWindowUrgent(id int64, urgent bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if w, ok := s.windows[id]; ok {
		w.IsUrgent = urgent
		s.windows[id] = w
	}
}

func (s *State) SetWorkspaceUrgent(id uint64, urgent bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if w, ok := s.workspaces[id]; ok {
		w.IsUrgent = urgent
		s.workspaces[id] = w
	}
}

func (s *State) SetWorkspaceActiveWindow(workspaceID uint64, activeWindowID *uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if w, ok := s.workspaces[workspaceID]; ok {
		w.ActiveWindowID = activeWindowID
		s.workspaces[workspaceID] = w
	}
}
