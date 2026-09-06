# Niri-Window-Manager

A touch-first web UI that visually mirrors a live Niri compositor session in real time with horizontal scrolling columns, workspace switching, drag-and-drop column snapping, and direct per-window controls.

## Features

- **Real-Time Push Mirroring**: Push-only WebSocket feed at `/ws` streaming full `Snapshot` payloads with zero client polling.
- **Scrollable Horizontal Strip**: Real Niri compositor layout model with keyed DOM reconciliation.
- **Touch & Pointer Interaction**:
  - **Tap Tile**: Focuses window (`POST /window/focus`) and reveals quick contextual action overlay (preset width cycling & close).
  - **Drag Tile**: Real-time tile drag tracking with live column snapping ghost indicator. Reorders columns on drop (`POST /window/move-to-column`).
  - **Vertical Swipe**: Swipe vertically on empty background to navigate between workspaces (`POST /workspace/up` and `POST /workspace/down`).
  - **Vertical Dot Pager**: Quick tactile workspace switcher on the screen edge with active and urgency indicators.
- **Hardware Accelerated**: Smooth 180ms CSS transforms for motion continuity between snapshots.

## Usage

Start the dev server:

```bash
npm run dev
```

The application will be served on `http://localhost:3000` with the WebSocket feed at `ws://localhost:3000/ws`.

### Action Endpoints (POST)

- `/workspace/up`: Move focus to workspace above
- `/workspace/down`: Move focus to workspace below
- `/column/left`: Move focused column left
- `/column/right`: Move focused column right
- `/window/focus`: Focus specific window (`{"id": <window_id>}`)
- `/window/close`: Close specific window (`{"id": <window_id>}`)
- `/window/switch-preset-width`: Cycle window column preset width (`{"id": <window_id>}`)
- `/window/move-to-column`: Move window column to target index (`{"id": <window_id>, "index": <target_index>}`)
- `/overview`: Toggle compositor overview
- `/state`: Read-only snapshot of current state

