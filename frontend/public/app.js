/**
 * Niri Window Manager — Compositor Mirror Web Application
 * Driven entirely by WebSocket push feed with zero polling.
 */

const defaultWsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

(function () {
  "use strict";

  // State
  let currentSnapshot = null;
  let activeWorkspaceId = null;
  let focusedWindowId = null;
  let lastKnownPositions = new Map(); // id -> [x, y]
  let currentScale = 1.0;
  let isDraggingTile = false;
  let dragWindowId = null;
  let dragTileEl = null;
  let dragStartPointer = { x: 0, y: 0 };
  let dragStartTilePos = { x: 0, y: 0 };
  let dropTargetColIndex = 1;
  let activeOverlayWindowId = null;
  let ws = null;
  let reconnectTimer = null;
  let swipeStart = null;

  // Keyed DOM nodes: windowId -> HTMLElement
  const windowElements = new Map();

  // Configuration (Default connects to current host /ws on port 3000)
  const defaultWsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  const defaultApiUrl = `${window.location.protocol}//${window.location.host}`;

  let config = {
    wsUrl: localStorage.getItem("niri_ws_url") || defaultWsUrl,
    apiUrl: localStorage.getItem("niri_api_url") || defaultApiUrl,
  };

  // DOM Elements
  const appBody = document.getElementById("app-body");
  const stage = document.getElementById("compositor-stage");
  const viewportScaler = document.getElementById("viewport-scaler");
  const canvas = document.getElementById("workspace-canvas");
  const dropIndicator = document.getElementById("drop-indicator");
  const dropColNum = document.getElementById("drop-column-num");
  const connectionBadge = document.getElementById("connection-badge");
  const connectionText = document.getElementById("connection-text");
  const reconnectBanner = document.getElementById("reconnect-banner");
  const activeWsLabel = document.getElementById("active-ws-label");
  const workspacePager = document.getElementById("workspace-pager");
  const actionOverlay = document.getElementById("tile-action-overlay");
  const btnOverlayWidth = document.getElementById("btn-overlay-width");
  const btnOverlayClose = document.getElementById("btn-overlay-close");

  // Top bar buttons
  const btnWsUp = document.getElementById("btn-ws-up");
  const btnWsDown = document.getElementById("btn-ws-down");
  const btnColLeft = document.getElementById("btn-col-left");
  const btnColRight = document.getElementById("btn-col-right");
  const btnOverview = document.getElementById("btn-overview");
  const btnAddWindow = document.getElementById("btn-add-window");
  const btnConfig = document.getElementById("btn-config");

  // Settings modal
  const settingsModal = document.getElementById("settings-modal");
  const btnModalClose = document.getElementById("btn-modal-close");
  const inputWsUrl = document.getElementById("input-ws-url");
  const inputApiUrl = document.getElementById("input-api-url");
  const btnApplyEndpoint = document.getElementById("btn-apply-endpoint");
  const btnResetEndpoint = document.getElementById("btn-reset-endpoint");
  const btnSimReset = document.getElementById("btn-sim-reset");
  const btnSimAddNvim = document.getElementById("btn-sim-add-nvim");
  const btnSimAddBrowser = document.getElementById("btn-sim-add-browser");

  // =========================================================================
  // API Action Dispatcher (POST only — zero polling)
  // =========================================================================
  async function postAction(endpoint, body = null) {
    const url = `${config.apiUrl}${endpoint}`;
    try {
      const options = {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      const res = await fetch(url, options);
      if (!res.ok) {
        console.warn(`Action ${endpoint} returned status ${res.status}`);
      }
    } catch (err) {
      console.error(`Failed to dispatch action ${endpoint}:`, err);
    }
  }

  // =========================================================================
  // WebSocket Push Feed
  // =========================================================================
  function connectWebSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (e) { }
      ws = null;
    }

    setConnectionStatus(false, "Connecting...");

    try {
      ws = new WebSocket(config.wsUrl);
    } catch (err) {
      console.error("WebSocket instantiation error:", err);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      setConnectionStatus(true, "Live Connected");
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = function (event) {
      try {
        const snapshot = JSON.parse(event.data);
        handleSnapshot(snapshot);
      } catch (err) {
        console.error("Failed to parse snapshot message:", err, event.data);
      }
    };

    ws.onclose = function () {
      setConnectionStatus(false, "Reconnecting (2s)...");
      scheduleReconnect();
    };

    ws.onerror = function (err) {
      console.warn("WebSocket error:", err);
      setConnectionStatus(false, "Connection Error");
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectWebSocket();
    }, 2000);
  }

  function setConnectionStatus(connected, text) {
    if (connected) {
      connectionBadge.className = "status-badge connected";
      connectionText.textContent = text || "Live Connected";
      reconnectBanner.classList.add("hidden");
    } else {
      connectionBadge.className = "status-badge disconnected";
      connectionText.textContent = text || "Reconnecting...";
      reconnectBanner.classList.remove("hidden");
    }
  }

  // =========================================================================
  // Snapshot Reconciliation & Layout Rendering
  // =========================================================================
  function handleSnapshot(snapshot) {
    currentSnapshot = snapshot;
    focusedWindowId = snapshot.focused_window_id;

    // Identify active workspace
    const activeWs =
      snapshot.workspaces.find((w) => w.is_active) || snapshot.workspaces[0];
    if (activeWs) {
      activeWorkspaceId = activeWs.id;
      activeWsLabel.textContent = activeWs.name
        ? `WS ${activeWs.idx + 1}: ${activeWs.name}`
        : `Workspace ${activeWs.idx + 1}`;
    }

    // Render workspace pager (dots)
    renderWorkspacePager(snapshot.workspaces);

    // Filter windows belonging to active workspace (non-floating)
    const activeWindows = snapshot.windows.filter(
      (w) => w.workspace_id === activeWorkspaceId && !w.is_floating,
    );

    // Bounding Box Scaling Strategy
    recalculateScaling(activeWindows);

    // Reconcile Window Tiles (Keyed by window.id)
    reconcileWindows(activeWindows);

    // Update Action Overlay position if active
    if (activeOverlayWindowId !== null) {
      const activeWindow = activeWindows.find(
        (w) => w.id === activeOverlayWindowId,
      );
      if (activeWindow) {
        positionOverlay(activeWindow);
      } else {
        hideOverlay();
      }
    }
  }

  // Compute bounding box and scale to fit viewport
  function recalculateScaling(windows) {
    if (!viewportScaler) return;
    const stageWidth = viewportScaler.clientWidth;
    const stageHeight = viewportScaler.clientHeight;

    if (windows.length === 0) {
      currentScale = 1.0;
      canvas.style.transform = `scale(1.0)`;
      return;
    }

    let maxX = 0;
    let maxY = 0;

    for (const w of windows) {
      const pos = w.layout.tile_pos_in_workspace_view ||
        lastKnownPositions.get(w.id) || [16, 16];
      const size = w.layout.tile_size || [960, 1028];
      const right = pos[0] + size[0];
      const bottom = pos[1] + size[1];
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    // Margins
    const totalW = maxX + 48;
    const totalH = maxY + 48;

    const scaleX = stageWidth / Math.max(totalW, 600);
    const scaleY = (stageHeight - 20) / Math.max(totalH, 400);

    // Preserve aspect ratio uniformly
    currentScale = Math.min(scaleX, scaleY, 1.0);

    // Center vertically if there's extra room
    const scaledHeight = totalH * currentScale;
    const offsetY = Math.max(12, (stageHeight - scaledHeight) / 2);

    canvas.style.transform = `translate(16px, ${offsetY}px) scale(${currentScale})`;
  }

  // Keyed DOM reconciliation
  function reconcileWindows(windows) {
    const incomingIds = new Set(windows.map((w) => w.id));

    // Remove obsolete windows from DOM
    for (const [id, el] of windowElements.entries()) {
      if (!incomingIds.has(id)) {
        el.remove();
        windowElements.delete(id);
        lastKnownPositions.delete(id);
      }
    }

    // Upsert windows
    for (const win of windows) {
      let el = windowElements.get(win.id);
      if (!el) {
        el = createWindowElement(win);
        canvas.appendChild(el);
        windowElements.set(win.id, el);
      }
      updateWindowElement(el, win);
    }
  }

  function createWindowElement(win) {
    const el = document.createElement("div");
    el.id = `window-tile-${win.id}`;
    el.className = "niri-window-tile";
    el.setAttribute("data-id", win.id);

    const iconGlyph = getAppIconGlyph(win.app_id);
    const fauxContentHtml = generateFauxBodyHtml(win);

    el.innerHTML = `
      <div class="tile-header">
        <div class="tile-header-left">
          <div class="tile-app-icon">${iconGlyph}</div>
          <div class="tile-title" title="${escapeHtml(win.title)}">${escapeHtml(win.title)}</div>
        </div>
        <div class="tile-header-right">
          <span class="tile-app-id-pill">${escapeHtml(win.app_id)}</span>
          <span class="tile-pid">${win.pid || ""}</span>
        </div>
      </div>
      <div class="tile-body">${fauxContentHtml}</div>
    `;

    // Attach Pointer Events API handlers
    attachTilePointerEvents(el, win.id);

    return el;
  }

  function updateWindowElement(el, win) {
    // If currently being dragged by user, don't override transform
    if (isDraggingTile && dragWindowId === win.id) {
      return;
    }

    // Resolving position:
    // Respect contract: tile_pos_in_workspace_view can be null mid-transition;
    // keep last known position, never snap to 0,0!
    let pos = win.layout.tile_pos_in_workspace_view;
    if (!pos && lastKnownPositions.has(win.id)) {
      pos = lastKnownPositions.get(win.id);
    } else if (!pos) {
      pos = [16, 16];
    }
    lastKnownPositions.set(win.id, pos);

    const size = win.layout.tile_size || [960, 1028];

    el.style.width = `${size[0]}px`;
    el.style.height = `${size[1]}px`;
    el.style.transform = `translate(${pos[0]}px, ${pos[1]}px)`;

    // State classes
    if (win.is_focused) {
      el.classList.add("is-focused");
    } else {
      el.classList.remove("is-focused");
    }

    if (win.is_urgent) {
      el.classList.add("is-urgent");
    } else {
      el.classList.remove("is-urgent");
    }

    // Update title if changed
    const titleEl = el.querySelector(".tile-title");
    if (titleEl && titleEl.textContent !== win.title) {
      titleEl.textContent = win.title;
      titleEl.title = win.title;
    }
  }

  function getAppIconGlyph(appId) {
    const id = (appId || "").toLowerCase();
    if (id.includes("alacritty") || id.includes("kitty") || id.includes("term"))
      return "$_";
    if (
      id.includes("firefox") ||
      id.includes("chrome") ||
      id.includes("browser")
    )
      return "🌐";
    if (id.includes("nvim") || id.includes("vim") || id.includes("code"))
      return "⚡";
    if (id.includes("slack") || id.includes("discord")) return "#";
    if (id.includes("spotify") || id.includes("music")) return "♫";
    if (id.includes("obsidian") || id.includes("note")) return "📝";
    return "🗔";
  }

  function generateFauxBodyHtml(win) {
    const id = (win.app_id || "").toLowerCase();
    if (id.includes("nvim") || id.includes("code")) {
      return `
        <div class="tile-body-editor">
          <div><span class="kw">func</span> <span class="fn">ReconcileLayout</span>(state *State) {</div>
          <div>&nbsp;&nbsp;<span class="kw">for</span> _, col := <span class="kw">range</span> columns {</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;col.<span class="fn">Snap</span>(<span class="str">"horizontal-strip"</span>)</div>
          <div>&nbsp;&nbsp;}</div>
          <div>}</div>
        </div>
      `;
    }
    if (id.includes("firefox") || id.includes("browser")) {
      return `
        <div class="tile-body-browser">
          <div class="browser-bar">https://github.com/YaLTeR/niri/wiki/Layout</div>
          <div class="browser-preview-hero"></div>
          <div style="color:#64748b; font-size:10px;">Niri is a scrollable-tiling Wayland compositor. Windows are arranged in columns...</div>
        </div>
      `;
    }
    return (
      `
      <div class="tile-body-terminal">
        <div><span class="prompt">~&gt;</span> <span class="cmd">niri msg</span> windows --json</div>
        <div class="out">[{"id":${win.id},"app_id":"${escapeHtml(win.app_id)}","workspace":${win.workspace_id}}]</div>
        <div><span class="prompt">~&gt;</span> <span class="cmd">cargo</span> check</div>
        <div class="out">Finished ` +
      (win.is_focused ? `[focused column]` : `[ready]`) +
      `</div>
      </div>
    `
    );
  }

  // =========================================================================
  // Pointer Events API (Tap, Drag, Snap-to-Column)
  // =========================================================================
  function attachTilePointerEvents(el, windowId) {
    let pointerDownTime = 0;
    let pointerDownPos = { x: 0, y: 0 };
    let hasMoved = false;

    el.addEventListener("pointerdown", (e) => {
      // Allow overlay buttons without initiating drag
      if (e.target.closest(".tile-action-overlay")) return;

      e.stopPropagation();
      el.setPointerCapture(e.pointerId);

      pointerDownTime = Date.now();
      pointerDownPos = { x: e.clientX, y: e.clientY };
      hasMoved = false;

      dragWindowId = windowId;
      dragTileEl = el;
      dragStartPointer = { x: e.clientX, y: e.clientY };

      const lastPos = lastKnownPositions.get(windowId) || [16, 16];
      dragStartTilePos = { x: lastPos[0], y: lastPos[1] };
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragTileEl || dragWindowId !== windowId) return;

      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      const dist = Math.hypot(dx, dy);

      if (!hasMoved && dist > 7) {
        hasMoved = true;
        isDraggingTile = true;
        dragTileEl.classList.add("is-dragging");
        hideOverlay();
      }

      if (isDraggingTile) {
        // Real-time drag follow with pointer scaling compensation
        const scale = currentScale || 1.0;
        const currentX =
          dragStartTilePos.x + (e.clientX - dragStartPointer.x) / scale;
        const currentY =
          dragStartTilePos.y + (e.clientY - dragStartPointer.y) / scale;

        dragTileEl.style.transform = `translate(${currentX}px, ${currentY}px)`;

        // Calculate target column slot and show ghost indicator
        updateDropGhostIndicator(currentX);
      }
    });

    const handlePointerUpOrCancel = (e) => {
      if (dragWindowId !== windowId) return;

      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) { }

      const duration = Date.now() - pointerDownTime;
      const dist = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y,
      );

      if (isDraggingTile) {
        // FINISHED DRAGGING: SNAP TO COLUMN
        isDraggingTile = false;
        dragTileEl.classList.remove("is-dragging");
        hideDropGhostIndicator();

        const targetIndex = dropTargetColIndex;
        console.log(
          `[Drag] Dropped window ${windowId} into column ${targetIndex}`,
        );

        // Contract: POST /window/move-to-column {"id": <window_id>, "index": <target_index>}
        postAction("/window/move-to-column", {
          id: windowId,
          index: targetIndex,
        });

        // Temporarily animate back to estimated position until snapshot arrives
        dragTileEl = null;
        dragWindowId = null;
      } else if (dist < 8 && duration < 350) {
        // TAP A WINDOW TILE:
        // 1. Call POST /window/focus {"id": <window.id>}
        // 2. Reveal small contextual action overlay (close × and switch-preset-width)
        console.log(`[Tap] Focused window ${windowId}`);
        postAction("/window/focus", { id: windowId });

        if (currentSnapshot) {
          const win = currentSnapshot.windows.find((w) => w.id === windowId);
          if (win) {
            showOverlay(win);
          }
        }
        dragTileEl = null;
        dragWindowId = null;
      } else {
        dragTileEl = null;
        dragWindowId = null;
      }
    };

    el.addEventListener("pointerup", handlePointerUpOrCancel);
    el.addEventListener("pointercancel", handlePointerUpOrCancel);
  }

  // =========================================================================
  // Column Snapping Math & Drop Ghost Preview
  // =========================================================================
  function updateDropGhostIndicator(tileX) {
    if (!currentSnapshot || !activeWorkspaceId) return;

    const wsWindows = currentSnapshot.windows.filter(
      (w) => w.workspace_id === activeWorkspaceId && !w.is_floating,
    );

    // Collect columns
    const colPositions = new Map(); // colIdx -> minX
    for (const w of wsWindows) {
      const colIdx = w.layout.pos_in_scrolling_layout[0] || 1;
      const pos = w.layout.tile_pos_in_workspace_view ||
        lastKnownPositions.get(w.id) || [16, 16];
      if (!colPositions.has(colIdx) || pos[0] < colPositions.get(colIdx)) {
        colPositions.set(colIdx, pos[0]);
      }
    }

    const sortedCols = Array.from(colPositions.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    if (sortedCols.length === 0) {
      dropTargetColIndex = 1;
      return;
    }

    // Determine target column by proximity to column start coordinates
    let bestIndex = sortedCols[0][0];
    let minDistance = Infinity;

    for (let i = 0; i < sortedCols.length; i++) {
      const [colIdx, xPos] = sortedCols[i];
      const dist = Math.abs(tileX - xPos);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = colIdx;
      }
    }

    // If dragged significantly past the last column, snap to a new append column
    const lastCol = sortedCols[sortedCols.length - 1];
    if (tileX > lastCol[1] + 400) {
      bestIndex = sortedCols.length;
    }

    dropTargetColIndex = Math.max(1, bestIndex);

    // Show indicator
    dropIndicator.classList.remove("hidden");
    const targetX = colPositions.get(dropTargetColIndex) || 16;
    dropIndicator.style.transform = `translateX(${targetX}px)`;
    dropColNum.textContent = dropTargetColIndex;
  }

  function hideDropGhostIndicator() {
    dropIndicator.classList.add("hidden");
  }

  // =========================================================================
  // Contextual Action Overlay (Tapped Window Tile)
  // =========================================================================
  function showOverlay(win) {
    activeOverlayWindowId = win.id;
    positionOverlay(win);
    actionOverlay.classList.remove("hidden");
  }

  function positionOverlay(win) {
    const pos = win.layout.tile_pos_in_workspace_view ||
      lastKnownPositions.get(win.id) || [16, 16];
    const size = win.layout.tile_size || [960, 1028];

    // Position in top right corner of tile inside canvas coordinate space
    const overlayX = pos[0] + size[0] - 170;
    const overlayY = pos[1] + 8;

    actionOverlay.style.transform = `translate(${overlayX}px, ${overlayY}px)`;
  }

  function hideOverlay() {
    activeOverlayWindowId = null;
    actionOverlay.classList.add("hidden");
  }

  // Overlay Action Handlers
  btnOverlayClose.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeOverlayWindowId !== null) {
      const id = activeOverlayWindowId;
      hideOverlay();
      postAction("/window/close", { id });
    }
  });

  btnOverlayWidth.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeOverlayWindowId !== null) {
      const id = activeOverlayWindowId;
      postAction("/window/switch-preset-width", { id });
    }
  });

  // Tap empty stage background: Dismiss overlay
  stage.addEventListener("pointerdown", (e) => {
    if (
      !e.target.closest(".niri-window-tile") &&
      !e.target.closest(".tile-action-overlay")
    ) {
      hideOverlay();
    }
  });

  // =========================================================================
  // Workspace Switching (Vertical Swipe Gesture & Vertical Dot Pager)
  // =========================================================================
  stage.addEventListener("pointerdown", (e) => {
    // Only register background swipes when not clicking tiles or controls
    if (
      e.target.closest(".niri-window-tile") ||
      e.target.closest("header") ||
      e.target.closest(".workspace-pager")
    ) {
      swipeStart = null;
      return;
    }
    swipeStart = { x: e.clientX, y: e.clientY, time: Date.now() };
  });

  stage.addEventListener("pointerup", (e) => {
    if (!swipeStart) return;
    const dy = e.clientY - swipeStart.y;
    const dx = e.clientX - swipeStart.x;
    const dt = Date.now() - swipeStart.time;

    swipeStart = null;

    // Must be predominantly vertical swipe
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5 && dt < 400) {
      if (dy < 0) {
        // Swiped UP -> Move to workspace below
        console.log("[Gesture] Swiped up -> /workspace/down");
        postAction("/workspace/down");
      } else {
        // Swiped DOWN -> Move to workspace above
        console.log("[Gesture] Swiped down -> /workspace/up");
        postAction("/workspace/up");
      }
    }
  });

  function renderWorkspacePager(workspaces) {
    workspacePager.innerHTML = "";
    const sorted = [...workspaces].sort((a, b) => a.idx - b.idx);

    sorted.forEach((ws) => {
      const dot = document.createElement("button");
      dot.className = `pager-dot ${ws.is_active ? "is-active" : ""} ${ws.is_urgent ? "is-urgent" : ""}`;
      dot.setAttribute(
        "title",
        ws.name
          ? `Workspace ${ws.idx + 1}: ${ws.name}`
          : `Workspace ${ws.idx + 1}`,
      );

      const tooltip = document.createElement("span");
      tooltip.className = "pager-tooltip";
      tooltip.textContent = ws.name || `WS ${ws.idx + 1}`;
      dot.appendChild(tooltip);

      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        // If clicked an inactive workspace, step towards it
        if (!ws.is_active) {
          const currentIdx = sorted.findIndex((w) => w.is_active);
          const targetIdx = sorted.findIndex((w) => w.id === ws.id);
          if (targetIdx > currentIdx) {
            postAction("/workspace/down");
          } else {
            postAction("/workspace/up");
          }
        }
      });

      workspacePager.appendChild(dot);
    });
  }

  // =========================================================================
  // Top Navigation Button Handlers
  // =========================================================================
  btnWsUp.addEventListener("click", () => postAction("/workspace/up"));
  btnWsDown.addEventListener("click", () => postAction("/workspace/down"));
  btnColLeft.addEventListener("click", () => postAction("/column/left"));
  btnColRight.addEventListener("click", () => postAction("/column/right"));
  btnOverview.addEventListener("click", () => postAction("/overview"));

  btnAddWindow.addEventListener("click", () => {
    postAction("/sim/new-window", {
      title: "Terminal — fish",
      app_id: "kitty",
    });
  });

  // Settings Modal
  btnConfig.addEventListener("click", () => {
    inputWsUrl.value = config.wsUrl;
    inputApiUrl.value = config.apiUrl;
    settingsModal.classList.remove("hidden");
  });

  btnModalClose.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });

  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add("hidden");
    }
  });

  btnApplyEndpoint.addEventListener("click", () => {
    const wsVal = inputWsUrl.value.trim() || defaultWsUrl;
    const apiVal = inputApiUrl.value.trim() || defaultApiUrl;
    config.wsUrl = wsVal;
    config.apiUrl = apiVal;
    localStorage.setItem("niri_ws_url", wsVal);
    localStorage.setItem("niri_api_url", apiVal);
    settingsModal.classList.add("hidden");
    connectWebSocket();
  });

  btnResetEndpoint.addEventListener("click", () => {
    config.wsUrl = defaultWsUrl;
    config.apiUrl = defaultApiUrl;
    localStorage.removeItem("niri_ws_url");
    localStorage.removeItem("niri_api_url");
    inputWsUrl.value = defaultWsUrl;
    inputApiUrl.value = defaultApiUrl;
    settingsModal.classList.add("hidden");
    connectWebSocket();
  });

  // Simulation Controls
  btnSimReset.addEventListener("click", () => {
    postAction("/sim/reset");
    settingsModal.classList.add("hidden");
  });

  btnSimAddNvim.addEventListener("click", () => {
    postAction("/sim/new-window", { title: "Nvim — main.go", app_id: "kitty" });
    settingsModal.classList.add("hidden");
  });

  btnSimAddBrowser.addEventListener("click", () => {
    postAction("/sim/new-window", {
      title: "Firefox — Wayland Compositors",
      app_id: "firefox",
    });
    settingsModal.classList.add("hidden");
  });

  // Window Resize: recompute scale
  window.addEventListener("resize", () => {
    if (currentSnapshot) {
      const activeWindows = currentSnapshot.windows.filter(
        (w) => w.workspace_id === activeWorkspaceId && !w.is_floating,
      );
      recalculateScaling(activeWindows);
    }
  });

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial Startup
  connectWebSocket();
})();
