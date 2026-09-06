import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import net from 'net';

export interface Layout {
  pos_in_scrolling_layout: [number, number];
  tile_size: [number, number];
  window_size: [number, number];
  tile_pos_in_workspace_view: [number, number] | null;
  window_offset_in_tile: [number, number];
}

export interface WindowItem {
  id: number;
  title: string;
  app_id: string;
  pid: number;
  workspace_id: number;
  is_focused: boolean;
  is_floating: boolean;
  is_urgent: boolean;
  layout: Layout;
}

export interface WorkspaceItem {
  id: number;
  idx: number;
  name: string | null;
  output: string | null;
  active_window_id: number | null;
  is_urgent: boolean;
  is_active: boolean;
  is_focused: boolean;
}

export interface Snapshot {
  windows: WindowItem[];
  workspaces: WorkspaceItem[];
  focused_window_id: number | null;
}

class NiriSimulatorState {
  private windows: Map<number, WindowItem> = new Map();
  private workspaces: Map<number, WorkspaceItem> = new Map();
  private focusedWindowId: number | null = null;
  private widthPresets = [640, 960, 1340, 1880];
  private nextWindowId = 100;

  constructor() {
    this.initDefaultSession();
  }

  public initDefaultSession() {
    this.windows.clear();
    this.workspaces.clear();

    // 3 Workspaces
    this.workspaces.set(1, {
      id: 1,
      idx: 0,
      name: 'Main',
      output: 'eDP-1',
      active_window_id: 1,
      is_urgent: false,
      is_active: true,
      is_focused: true,
    });

    this.workspaces.set(2, {
      id: 2,
      idx: 1,
      name: 'Dev',
      output: 'eDP-1',
      active_window_id: 7,
      is_urgent: false,
      is_active: false,
      is_focused: false,
    });

    this.workspaces.set(3, {
      id: 3,
      idx: 2,
      name: 'Media',
      output: 'eDP-1',
      active_window_id: 12,
      is_urgent: false,
      is_active: false,
      is_focused: false,
    });

    // Windows for Workspace 1
    const w1: WindowItem = {
      id: 1,
      title: 'Alacritty — zsh',
      app_id: 'Alacritty',
      pid: 14201,
      workspace_id: 1,
      is_focused: true,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [1, 1],
        tile_size: [960, 1028],
        window_size: [960, 1028],
        tile_pos_in_workspace_view: [16, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    const w2: WindowItem = {
      id: 2,
      title: 'Firefox — Niri Compositor Documentation',
      app_id: 'firefox',
      pid: 18450,
      workspace_id: 1,
      is_focused: false,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [2, 1],
        tile_size: [1340, 1028],
        window_size: [1340, 1028],
        tile_pos_in_workspace_view: [992, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    const w3: WindowItem = {
      id: 3,
      title: 'Slack — #wayland-compositors',
      app_id: 'slack',
      pid: 19800,
      workspace_id: 1,
      is_focused: false,
      is_floating: false,
      is_urgent: true,
      layout: {
        pos_in_scrolling_layout: [3, 1],
        tile_size: [640, 1028],
        window_size: [640, 1028],
        tile_pos_in_workspace_view: [2348, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    // Windows for Workspace 2
    const w7: WindowItem = {
      id: 7,
      title: 'Nvim — actions.go',
      app_id: 'kitty',
      pid: 20596,
      workspace_id: 2,
      is_focused: false,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [1, 1],
        tile_size: [960, 1028],
        window_size: [960, 1028],
        tile_pos_in_workspace_view: [16, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    const w8: WindowItem = {
      id: 8,
      title: 'Obsidian — Compositor notes',
      app_id: 'obsidian',
      pid: 21102,
      workspace_id: 2,
      is_focused: false,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [2, 1],
        tile_size: [960, 1028],
        window_size: [960, 1028],
        tile_pos_in_workspace_view: [992, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    // Windows for Workspace 3
    const w12: WindowItem = {
      id: 12,
      title: 'Spotify — Midnight City',
      app_id: 'spotify',
      pid: 22001,
      workspace_id: 3,
      is_focused: false,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [1, 1],
        tile_size: [1340, 1028],
        window_size: [1340, 1028],
        tile_pos_in_workspace_view: [16, 16],
        window_offset_in_tile: [0, 0],
      },
    };

    [w1, w2, w3, w7, w8, w12].forEach((w) => this.windows.set(w.id, w));
    this.focusedWindowId = 1;
    this.recalculateAllLayouts();
  }

  public snapshot(): Snapshot {
    return {
      windows: Array.from(this.windows.values()),
      workspaces: Array.from(this.workspaces.values()),
      focused_window_id: this.focusedWindowId,
    };
  }

  public getActiveWorkspace(): WorkspaceItem | undefined {
    for (const ws of this.workspaces.values()) {
      if (ws.is_active) return ws;
    }
    return this.workspaces.get(1);
  }

  public recalculateWorkspaceLayout(workspaceId: number) {
    const wsWindows = Array.from(this.windows.values()).filter(
      (w) => w.workspace_id === workspaceId && !w.is_floating
    );

    // Group windows by column index
    const colMap = new Map<number, WindowItem[]>();
    for (const w of wsWindows) {
      const colIdx = w.layout.pos_in_scrolling_layout[0] || 1;
      if (!colMap.has(colIdx)) colMap.set(colIdx, []);
      colMap.get(colIdx)!.push(w);
    }

    // Sort column keys
    const sortedColKeys = Array.from(colMap.keys()).sort((a, b) => a - b);

    const GAP = 16;
    let currentX = 16;
    let newColIndex = 1;

    for (const key of sortedColKeys) {
      const colWindows = colMap.get(key)!;
      // Sort rows
      colWindows.sort(
        (a, b) =>
          (a.layout.pos_in_scrolling_layout[1] || 1) -
          (b.layout.pos_in_scrolling_layout[1] || 1)
      );

      const colWidth = colWindows[0].layout.tile_size[0] || 960;
      const numRows = colWindows.length;
      const totalAvailableH = 1028;
      const totalGapH = GAP * (numRows - 1);
      const rowHeight = Math.max(200, (totalAvailableH - totalGapH) / numRows);

      let currentY = 16;
      let newRowIndex = 1;

      for (const win of colWindows) {
        win.layout.pos_in_scrolling_layout = [newColIndex, newRowIndex];
        win.layout.tile_size = [colWidth, rowHeight];
        win.layout.window_size = [colWidth, rowHeight];
        win.layout.tile_pos_in_workspace_view = [currentX, currentY];
        this.windows.set(win.id, win);

        currentY += rowHeight + GAP;
        newRowIndex++;
      }

      currentX += colWidth + GAP;
      newColIndex++;
    }
  }

  public recalculateAllLayouts() {
    for (const ws of this.workspaces.values()) {
      this.recalculateWorkspaceLayout(ws.id);
    }
  }

  public moveWorkspaceUp(): boolean {
    const wsList = Array.from(this.workspaces.values()).sort(
      (a, b) => a.idx - b.idx
    );
    const active = this.getActiveWorkspace();
    if (!active || wsList.length === 0) return false;

    const currentIndex = wsList.findIndex((w) => w.id === active.id);
    const nextIndex = (currentIndex - 1 + wsList.length) % wsList.length;
    const targetWs = wsList[nextIndex];

    for (const ws of this.workspaces.values()) {
      ws.is_active = ws.id === targetWs.id;
      ws.is_focused = ws.id === targetWs.id;
    }

    if (targetWs.active_window_id && this.windows.has(targetWs.active_window_id)) {
      this.focusWindow(targetWs.active_window_id);
    } else {
      const firstWin = Array.from(this.windows.values()).find(
        (w) => w.workspace_id === targetWs.id
      );
      if (firstWin) {
        this.focusWindow(firstWin.id);
      } else {
        this.focusedWindowId = null;
      }
    }
    return true;
  }

  public moveWorkspaceDown(): boolean {
    const wsList = Array.from(this.workspaces.values()).sort(
      (a, b) => a.idx - b.idx
    );
    const active = this.getActiveWorkspace();
    if (!active || wsList.length === 0) return false;

    const currentIndex = wsList.findIndex((w) => w.id === active.id);
    const nextIndex = (currentIndex + 1) % wsList.length;
    const targetWs = wsList[nextIndex];

    for (const ws of this.workspaces.values()) {
      ws.is_active = ws.id === targetWs.id;
      ws.is_focused = ws.id === targetWs.id;
    }

    if (targetWs.active_window_id && this.windows.has(targetWs.active_window_id)) {
      this.focusWindow(targetWs.active_window_id);
    } else {
      const firstWin = Array.from(this.windows.values()).find(
        (w) => w.workspace_id === targetWs.id
      );
      if (firstWin) {
        this.focusWindow(firstWin.id);
      } else {
        this.focusedWindowId = null;
      }
    }
    return true;
  }

  public focusWindow(id: number): boolean {
    if (!this.windows.has(id)) return false;

    for (const w of this.windows.values()) {
      w.is_focused = w.id === id;
      if (w.id === id) {
        w.is_urgent = false; // focused clears urgency
      }
    }

    const win = this.windows.get(id)!;
    this.focusedWindowId = id;

    // Activate its workspace
    for (const ws of this.workspaces.values()) {
      if (ws.id === win.workspace_id) {
        ws.is_active = true;
        ws.is_focused = true;
        ws.active_window_id = id;
      } else {
        ws.is_active = false;
        ws.is_focused = false;
      }
    }
    return true;
  }

  public closeWindow(id: number): boolean {
    const win = this.windows.get(id);
    if (!win) return false;
    const wsId = win.workspace_id;
    this.windows.delete(id);

    if (this.focusedWindowId === id) {
      const remainingInWs = Array.from(this.windows.values()).filter(
        (w) => w.workspace_id === wsId
      );
      if (remainingInWs.length > 0) {
        this.focusWindow(remainingInWs[0].id);
      } else {
        this.focusedWindowId = null;
        const ws = this.workspaces.get(wsId);
        if (ws) ws.active_window_id = null;
      }
    }

    this.recalculateWorkspaceLayout(wsId);
    return true;
  }

  public moveColumnLeft(): boolean {
    if (!this.focusedWindowId) return false;
    const win = this.windows.get(this.focusedWindowId);
    if (!win) return false;

    const currentCol = win.layout.pos_in_scrolling_layout[0];
    if (currentCol <= 1) return true;
    return this.moveColumnToIndex(win.id, currentCol - 1);
  }

  public moveColumnRight(): boolean {
    if (!this.focusedWindowId) return false;
    const win = this.windows.get(this.focusedWindowId);
    if (!win) return false;

    const currentCol = win.layout.pos_in_scrolling_layout[0];
    return this.moveColumnToIndex(win.id, currentCol + 1);
  }

  public switchPresetColumnWidth(id: number): boolean {
    const win = this.windows.get(id);
    if (!win) return false;
    this.focusWindow(id);

    const currentWidth = win.layout.tile_size[0];
    // Find closest preset
    let nextWidth = this.widthPresets[1]; // default 960
    for (let i = 0; i < this.widthPresets.length; i++) {
      if (Math.abs(this.widthPresets[i] - currentWidth) < 50) {
        nextWidth = this.widthPresets[(i + 1) % this.widthPresets.length];
        break;
      }
    }

    // Apply to all windows in the same column
    const colIdx = win.layout.pos_in_scrolling_layout[0];
    for (const w of this.windows.values()) {
      if (
        w.workspace_id === win.workspace_id &&
        w.layout.pos_in_scrolling_layout[0] === colIdx
      ) {
        w.layout.tile_size[0] = nextWidth;
        w.layout.window_size[0] = nextWidth;
      }
    }

    this.recalculateWorkspaceLayout(win.workspace_id);
    return true;
  }

  public moveColumnToIndex(windowId: number, targetIndex: number): boolean {
    const win = this.windows.get(windowId);
    if (!win) return false;
    this.focusWindow(windowId);

    const wsId = win.workspace_id;
    const sourceCol = win.layout.pos_in_scrolling_layout[0];

    // Gather all distinct column indices in this workspace
    const wsWindows = Array.from(this.windows.values()).filter(
      (w) => w.workspace_id === wsId
    );
    const colSet = new Set<number>();
    for (const w of wsWindows) {
      colSet.add(w.layout.pos_in_scrolling_layout[0]);
    }
    const cols = Array.from(colSet).sort((a, b) => a - b);

    // If targetIndex is out of bounds, clamp to 1..cols.length
    const clampedTarget = Math.max(1, Math.min(targetIndex, cols.length));

    if (sourceCol === clampedTarget) {
      return true;
    }

    // Reorder columns
    const orderedCols = cols.filter((c) => c !== sourceCol);
    orderedCols.splice(clampedTarget - 1, 0, sourceCol);

    // Map old col index to new 1-based index
    const colIndexMap = new Map<number, number>();
    orderedCols.forEach((oldCol, idx) => {
      colIndexMap.set(oldCol, idx + 1);
    });

    for (const w of wsWindows) {
      const oldCol = w.layout.pos_in_scrolling_layout[0];
      const newCol = colIndexMap.get(oldCol) || oldCol;
      w.layout.pos_in_scrolling_layout[0] = newCol;
    }

    this.recalculateWorkspaceLayout(wsId);
    return true;
  }

  public addWindow(title: string, appId: string, width = 960): WindowItem {
    const activeWs = this.getActiveWorkspace();
    const wsId = activeWs ? activeWs.id : 1;
    const id = ++this.nextWindowId;

    const wsWindows = Array.from(this.windows.values()).filter(
      (w) => w.workspace_id === wsId
    );
    let maxCol = 0;
    for (const w of wsWindows) {
      if (w.layout.pos_in_scrolling_layout[0] > maxCol) {
        maxCol = w.layout.pos_in_scrolling_layout[0];
      }
    }

    const newWin: WindowItem = {
      id,
      title,
      app_id: appId,
      pid: 25000 + (id % 1000),
      workspace_id: wsId,
      is_focused: true,
      is_floating: false,
      is_urgent: false,
      layout: {
        pos_in_scrolling_layout: [maxCol + 1, 1],
        tile_size: [width, 1028],
        window_size: [width, 1028],
        tile_pos_in_workspace_view: null,
        window_offset_in_tile: [0, 0],
      },
    };

    this.windows.set(id, newWin);
    this.focusWindow(id);
    this.recalculateWorkspaceLayout(wsId);
    return newWin;
  }
}

// Hub to handle WebSocket broadcasts
class WebSocketHub {
  private clients: Set<WebSocket> = new Set();

  public addClient(ws: WebSocket, initial: Snapshot) {
    this.clients.add(ws);
    try {
      ws.send(JSON.stringify(initial));
    } catch (e) {
      console.error('Failed to send initial snapshot', e);
    }

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  public broadcast(snapshot: Snapshot) {
    const payload = JSON.stringify(snapshot);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          this.clients.delete(client);
        }
      }
    }
  }

  public clientCount(): number {
    return this.clients.size;
  }
}

// Initialize Application
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const state = new NiriSimulatorState();
const hub = new WebSocketHub();

// Check if real NIRI_SOCKET is available
const niriSocketPath = process.env.NIRI_SOCKET;
let realNiriConnected = false;

if (niriSocketPath && fs.existsSync(niriSocketPath)) {
  console.log(`Attempting connection to NIRI_SOCKET: ${niriSocketPath}`);
  try {
    const client = net.createConnection(niriSocketPath, () => {
      console.log('Connected to real Niri IPC socket!');
      realNiriConnected = true;
    });
    client.on('error', (err) => {
      console.warn('Real Niri socket connection error, using simulator:', err.message);
      realNiriConnected = false;
    });
  } catch (e) {
    console.warn('Cannot dial NIRI_SOCKET, using simulator');
  }
}

wss.on('connection', (ws: WebSocket) => {
  hub.addClient(ws, state.snapshot());
});

function notifyStateChange() {
  hub.broadcast(state.snapshot());
}

// Action Endpoints Contract
app.post('/workspace/up', (_req: Request, res: Response) => {
  state.moveWorkspaceUp();
  notifyStateChange();
  res.status(204).end();
});

app.post('/workspace/down', (_req: Request, res: Response) => {
  state.moveWorkspaceDown();
  notifyStateChange();
  res.status(204).end();
});

app.post(['/column/left', '/window/left'], (_req: Request, res: Response) => {
  state.moveColumnLeft();
  notifyStateChange();
  res.status(204).end();
});

app.post(['/column/right', '/window/right'], (_req: Request, res: Response) => {
  state.moveColumnRight();
  notifyStateChange();
  res.status(204).end();
});

app.post('/overview', (_req: Request, res: Response) => {
  notifyStateChange();
  res.status(204).end();
});

app.post('/window/focus', (req: Request, res: Response) => {
  const id = Number(req.body?.id);
  if (isNaN(id)) {
    return res.status(400).send('invalid id');
  }
  state.focusWindow(id);
  notifyStateChange();
  res.status(204).end();
});

app.post('/window/close', (req: Request, res: Response) => {
  const id = Number(req.body?.id);
  if (isNaN(id)) {
    return res.status(400).send('invalid id');
  }
  state.closeWindow(id);
  notifyStateChange();
  res.status(204).end();
});

app.post('/window/switch-preset-width', (req: Request, res: Response) => {
  const id = Number(req.body?.id);
  if (isNaN(id)) {
    return res.status(400).send('invalid id');
  }
  state.switchPresetColumnWidth(id);
  notifyStateChange();
  res.status(204).end();
});

app.post('/window/move-to-column', (req: Request, res: Response) => {
  const id = Number(req.body?.id);
  const index = Number(req.body?.index);
  if (isNaN(id) || isNaN(index)) {
    return res.status(400).send('invalid id or index');
  }
  state.moveColumnToIndex(id, index);
  notifyStateChange();
  res.status(204).end();
});

// Read-only state snapshot
app.get('/state', (_req: Request, res: Response) => {
  res.json(state.snapshot());
});

// Simulation helper routes
app.post('/sim/new-window', (req: Request, res: Response) => {
  const title = req.body?.title || 'Terminal — fish';
  const appId = req.body?.app_id || 'kitty';
  const win = state.addWindow(title, appId);
  notifyStateChange();
  res.json(win);
});

app.post('/sim/reset', (_req: Request, res: Response) => {
  state.initDefaultSession();
  notifyStateChange();
  res.status(204).end();
});

// Fallback index.html for SPA/root
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[niri-window-manager] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[niri-window-manager] WebSocket stream ready at ws://0.0.0.0:${PORT}/ws`);
});
