/**
 * Niri Window Manager — Compositor Mirror Web Application
 * Driven entirely by WebSocket push feed with zero polling.
 */

(function () {
  'use strict';

  // State
  let currentSnapshot = null;
  let activeWorkspaceId = null;
  let focusedWindowId = null;
  let lastKnownPositions = new Map(); // id -> [x, y]
  let currentScale = 1.0;
  let isOverviewMode = false;
  let computedWindowLayouts = new Map(); // id -> { x, y, width, height, colIndex, rowIndex }
  let computedColumnsInfo = []; // array of { colIndex, x, width, windows }
  let totalLayoutWidth = 1200;
  let totalLayoutHeight = 1080;
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
  const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  const defaultApiUrl = `${window.location.protocol}//${window.location.host}`;

  let config = {
    wsUrl: localStorage.getItem('niri_ws_url') || defaultWsUrl,
    apiUrl: localStorage.getItem('niri_api_url') || defaultApiUrl,
  };

  // DOM Elements
  const appBody = document.getElementById('app-body');
  const stage = document.getElementById('compositor-stage');
  const viewportScaler = document.getElementById('viewport-scaler');
  const canvasSizer = document.getElementById('canvas-sizer');
  const canvas = document.getElementById('workspace-canvas');
  const emptyColumnSlot = document.getElementById('empty-column-slot');
  const emptySlotNum = document.getElementById('empty-slot-num');
  const dropIndicator = document.getElementById('drop-indicator');
  const dropColNum = document.getElementById('drop-column-num');
  const connectionBadge = document.getElementById('connection-badge');
  const connectionText = document.getElementById('connection-text');
  const reconnectBanner = document.getElementById('reconnect-banner');
  const activeWsLabel = document.getElementById('active-ws-label');
  const workspacePager = document.getElementById('workspace-pager');
  const actionOverlay = document.getElementById('tile-action-overlay');
  const btnOverlayWidth = document.getElementById('btn-overlay-width');
  const btnOverlayClose = document.getElementById('btn-overlay-close');

  // Top bar buttons
  const btnWsUp = document.getElementById('btn-ws-up');
  const btnWsDown = document.getElementById('btn-ws-down');
  const btnColLeft = document.getElementById('btn-col-left');
  const btnColRight = document.getElementById('btn-col-right');
  const btnOverview = document.getElementById('btn-overview');
  const btnAddWindow = document.getElementById('btn-add-window');
  const btnConfig = document.getElementById('btn-config');

  // Settings modal
  const settingsModal = document.getElementById('settings-modal');
  const btnModalClose = document.getElementById('btn-modal-close');
  const inputWsUrl = document.getElementById('input-ws-url');
  const inputApiUrl = document.getElementById('input-api-url');
  const btnApplyEndpoint = document.getElementById('btn-apply-endpoint');
  const btnResetEndpoint = document.getElementById('btn-reset-endpoint');
  const btnSimReset = document.getElementById('btn-sim-reset');
  const btnSimAddNvim = document.getElementById('btn-sim-add-nvim');
  const btnSimAddBrowser = document.getElementById('btn-sim-add-browser');

  // =========================================================================
  // API Action Dispatcher (POST only — zero polling)
  // =========================================================================
  async function postAction(endpoint, body = null) {
    const url = `${config.apiUrl}${endpoint}`;
    try {
      const options = {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
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
      } catch (e) {}
      ws = null;
    }

    setConnectionStatus(false, 'Connecting...');

    try {
      ws = new WebSocket(config.wsUrl);
    } catch (err) {
      console.error('WebSocket instantiation error:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      setConnectionStatus(true, 'Live Connected');
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = function (event) {
      try {
        const snapshot = JSON.parse(event.data);
        handleSnapshot(snapshot);
      } catch (err) {
        console.error('Failed to parse snapshot message:', err, event.data);
      }
    };

    ws.onclose = function () {
      setConnectionStatus(false, 'Reconnecting (2s)...');
      scheduleReconnect();
    };

    ws.onerror = function (err) {
      console.warn('WebSocket error:', err);
      setConnectionStatus(false, 'Connection Error');
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
      connectionBadge.className = 'status-badge connected';
      connectionText.textContent = text || 'Live Connected';
      reconnectBanner.classList.add('hidden');
    } else {
      connectionBadge.className = 'status-badge disconnected';
      connectionText.textContent = text || 'Reconnecting...';
      reconnectBanner.classList.remove('hidden');
    }
  }

  // =========================================================================
  // Snapshot Reconciliation & Layout Rendering
  // =========================================================================
  function handleSnapshot(snapshot) {
    currentSnapshot = snapshot;
    focusedWindowId = snapshot.focused_window_id;

    // Identify active workspace
    const activeWs = snapshot.workspaces.find((w) => w.is_active) || snapshot.workspaces[0];
    if (activeWs) {
      activeWorkspaceId = activeWs.id;
      activeWsLabel.textContent = activeWs.name ? `WS ${activeWs.idx + 1}: ${activeWs.name}` : `Workspace ${activeWs.idx + 1}`;
    }

    // Render workspace pager (dots)
    renderWorkspacePager(snapshot.workspaces);

    // Filter windows belonging to active workspace (non-floating)
    const activeWindows = snapshot.windows.filter(
      (w) => w.workspace_id === activeWorkspaceId && !w.is_floating
    );

    // Bounding Box Scaling Strategy
    recalculateScaling(activeWindows);

    // Reconcile Window Tiles (Keyed by window.id)
    reconcileWindows(activeWindows);

    // Update Action Overlay position if active
    if (activeOverlayWindowId !== null) {
      const activeWindow = activeWindows.find((w) => w.id === activeOverlayWindowId);
      if (activeWindow) {
        positionOverlay(activeWindow);
      } else {
        hideOverlay();
      }
    }
  }

  // Compute horizontal scrolling column layout (1 x (n+1) grid)
  function computeWorkspaceLayout(activeWindows) {
    computedWindowLayouts.clear();
    computedColumnsInfo = [];

    const START_X = 24;
    const GAP_X = 24;
    const START_Y = 24;
    const GAP_Y = 20;
    const DEFAULT_W = 960;
    const DEFAULT_H = 1028;

    if (!activeWindows || activeWindows.length === 0) {
      totalLayoutWidth = 800;
      totalLayoutHeight = 800;
      if (emptyColumnSlot) {
        emptyColumnSlot.style.transform = `translate(${START_X}px, ${START_Y}px)`;
        emptyColumnSlot.style.width = '320px';
        emptyColumnSlot.style.height = `${DEFAULT_H}px`;
        if (emptySlotNum) emptySlotNum.textContent = '1';
      }
      return;
    }

    // Group windows into columns.
    // Niri's pos_in_scrolling_layout is [col, row], 1-based.
    // If not provided or null, assign sequential columns (1 window per column).
    const colMap = new Map(); // colNum -> array of { win, col, row }

    activeWindows.forEach((win, idx) => {
      let col = idx + 1;
      let row = 1;

      if (
        win.layout &&
        Array.isArray(win.layout.pos_in_scrolling_layout) &&
        win.layout.pos_in_scrolling_layout.length >= 1 &&
        win.layout.pos_in_scrolling_layout[0] != null
      ) {
        col = Number(win.layout.pos_in_scrolling_layout[0]) || (idx + 1);
        row = Number(win.layout.pos_in_scrolling_layout[1]) || 1;
      }

      if (!colMap.has(col)) {
        colMap.set(col, []);
      }
      colMap.get(col).push({ win, col, row });
    });

    const sortedColNums = Array.from(colMap.keys()).sort((a, b) => a - b);

    let currentX = START_X;
    let maxOverallY = DEFAULT_H + START_Y;

    sortedColNums.forEach((colNum) => {
      const items = colMap.get(colNum);
      items.sort((a, b) => a.row - b.row);

      // Column width: maximum width of tiles in this column
      let colWidth = DEFAULT_W;
      for (const item of items) {
        const w = item.win.layout?.tile_size?.[0] || item.win.layout?.window_size?.[0];
        if (w && w > 0) {
          colWidth = Math.max(colWidth, w);
        }
      }

      const colInfo = {
        colIndex: colNum,
        x: currentX,
        width: colWidth,
        windows: items.map((it) => it.win),
      };
      computedColumnsInfo.push(colInfo);

      let currentY = START_Y;
      items.forEach((item) => {
        const win = item.win;
        const w = win.layout?.tile_size?.[0] || colWidth;
        const h = win.layout?.tile_size?.[1] || DEFAULT_H;

        computedWindowLayouts.set(win.id, {
          x: currentX,
          y: currentY,
          width: w,
          height: h,
          colIndex: colNum,
          rowIndex: item.row,
        });

        lastKnownPositions.set(win.id, [currentX, currentY]);
        currentY += h + GAP_Y;
      });

      if (currentY > maxOverallY) {
        maxOverallY = currentY;
      }

      currentX += colWidth + GAP_X;
    });

    // Position the (n+1) empty column slot
    const nextColNum = sortedColNums.length > 0 ? sortedColNums[sortedColNums.length - 1] + 1 : 1;
    const emptySlotWidth = 320;
    const emptySlotX = currentX;

    if (emptyColumnSlot) {
      emptyColumnSlot.style.transform = `translate(${emptySlotX}px, ${START_Y}px)`;
      emptyColumnSlot.style.width = `${emptySlotWidth}px`;
      emptyColumnSlot.style.height = `${DEFAULT_H}px`;
      if (emptySlotNum) emptySlotNum.textContent = nextColNum;
    }

    totalLayoutWidth = emptySlotX + emptySlotWidth + 48;
    totalLayoutHeight = maxOverallY + 48;
  }

  // Smoothly center a window/column in the horizontal viewport
  function centerWindowInViewport(winId, smooth = true) {
    if (isOverviewMode || !viewportScaler) return;
    const layout = computedWindowLayouts.get(winId);
    if (!layout) return;

    const colCenterCanvasX = layout.x + layout.width / 2;
    const colCenterScreenX = colCenterCanvasX * currentScale;
    const targetScrollLeft = colCenterScreenX - (viewportScaler.clientWidth / 2);

    viewportScaler.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  // Compute bounding box and scale to fit viewport (or overview)
  function recalculateScaling(windows) {
    if (!viewportScaler) return;
    const stageWidth = viewportScaler.clientWidth;
    const stageHeight = viewportScaler.clientHeight;

    computeWorkspaceLayout(windows);

    if (isOverviewMode) {
      // In Overview mode: fit the entire 1x(n+1) grid on screen
      const scaleX = (stageWidth - 32) / Math.max(totalLayoutWidth, 600);
      const scaleY = (stageHeight - 32) / Math.max(totalLayoutHeight, 400);
      currentScale = Math.min(scaleX, scaleY, 1.0);

      const scaledW = totalLayoutWidth * currentScale;
      const scaledH = totalLayoutHeight * currentScale;
      const offsetX = Math.max(16, (stageWidth - scaledW) / 2);
      const offsetY = Math.max(16, (stageHeight - scaledH) / 2);

      if (canvasSizer) {
        canvasSizer.style.width = `${stageWidth}px`;
        canvasSizer.style.height = `${stageHeight}px`;
      }
      canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${currentScale})`;
      viewportScaler.scrollLeft = 0;
    } else {
      // In Normal Scrolling mode: scale vertically so windows fill height comfortably
      const scaleY = (stageHeight - 40) / Math.max(totalLayoutHeight, 500);
      currentScale = Math.min(Math.max(scaleY, 0.4), 1.0);

      const scaledW = totalLayoutWidth * currentScale;
      const scaledH = totalLayoutHeight * currentScale;

      if (canvasSizer) {
        canvasSizer.style.width = `${scaledW}px`;
        canvasSizer.style.height = `${Math.max(stageHeight, scaledH)}px`;
      }

      const offsetY = Math.max(8, (stageHeight - scaledH) / 2);
      canvas.style.transform = `translate(0px, ${offsetY}px) scale(${currentScale})`;

      if (focusedWindowId) {
        setTimeout(() => centerWindowInViewport(focusedWindowId, false), 20);
      }
    }
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
    const el = document.createElement('div');
    el.id = `window-tile-${win.id}`;
    el.className = 'niri-window-tile';
    el.setAttribute('data-id', win.id);

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
          <span class="tile-pid">${win.pid || ''}</span>
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

    // Resolving position from computed scrolling column layout
    let layout = computedWindowLayouts.get(win.id);
    if (!layout) {
      const fallbackPos = lastKnownPositions.get(win.id) || [24, 24];
      const fallbackSize = win.layout?.tile_size || [960, 1028];
      layout = {
        x: fallbackPos[0],
        y: fallbackPos[1],
        width: fallbackSize[0],
        height: fallbackSize[1],
      };
    }

    lastKnownPositions.set(win.id, [layout.x, layout.y]);

    el.style.width = `${layout.width}px`;
    el.style.height = `${layout.height}px`;
    el.style.transform = `translate(${layout.x}px, ${layout.y}px)`;

    // State classes
    if (win.is_focused) {
      el.classList.add('is-focused');
    } else {
      el.classList.remove('is-focused');
    }

    if (win.is_urgent) {
      el.classList.add('is-urgent');
    } else {
      el.classList.remove('is-urgent');
    }

    // Update title if changed
    const titleEl = el.querySelector('.tile-title');
    if (titleEl && titleEl.textContent !== win.title) {
      titleEl.textContent = win.title;
      titleEl.title = win.title;
    }
  }

  function getAppIconGlyph(appId) {
    const id = (appId || '').toLowerCase();
    if (id.includes('alacritty') || id.includes('kitty') || id.includes('term')) return '$_';
    if (id.includes('firefox') || id.includes('chrome') || id.includes('browser')) return '🌐';
    if (id.includes('nvim') || id.includes('vim') || id.includes('code')) return '⚡';
    if (id.includes('slack') || id.includes('discord')) return '#';
    if (id.includes('spotify') || id.includes('music')) return '♫';
    if (id.includes('obsidian') || id.includes('note')) return '📝';
    return '🗔';
  }

  function generateFauxBodyHtml(win) {
    const id = (win.app_id || '').toLowerCase();
    if (id.includes('nvim') || id.includes('code')) {
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
    if (id.includes('firefox') || id.includes('browser')) {
      return `
        <div class="tile-body-browser">
          <div class="browser-bar">https://github.com/YaLTeR/niri/wiki/Layout</div>
          <div class="browser-preview-hero"></div>
          <div style="color:#64748b; font-size:10px;">Niri is a scrollable-tiling Wayland compositor. Windows are arranged in columns...</div>
        </div>
      `;
    }
    return `
      <div class="tile-body-terminal">
        <div><span class="prompt">~&gt;</span> <span class="cmd">niri msg</span> windows --json</div>
        <div class="out">[{"id":${win.id},"app_id":"${escapeHtml(win.app_id)}","workspace":${win.workspace_id}}]</div>
        <div><span class="prompt">~&gt;</span> <span class="cmd">cargo</span> check</div>
        <div class="out">Finished ` + (win.is_focused ? `[focused column]` : `[ready]`) + `</div>
      </div>
    `;
  }

  // =========================================================================
  // Pointer Events API (Tap, Drag, Snap-to-Column)
  // =========================================================================
  function attachTilePointerEvents(el, windowId) {
    let pointerDownTime = 0;
    let pointerDownPos = { x: 0, y: 0 };
    let hasMoved = false;

    el.addEventListener('pointerdown', (e) => {
      // Allow overlay buttons without initiating drag
      if (e.target.closest('.tile-action-overlay')) return;

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

    el.addEventListener('pointermove', (e) => {
      if (!dragTileEl || dragWindowId !== windowId) return;

      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      const dist = Math.hypot(dx, dy);

      if (!hasMoved && dist > 7) {
        hasMoved = true;
        isDraggingTile = true;
        dragTileEl.classList.add('is-dragging');
        hideOverlay();
      }

      if (isDraggingTile) {
        // Real-time drag follow with pointer scaling compensation
        const scale = currentScale || 1.0;
        const currentX = dragStartTilePos.x + (e.clientX - dragStartPointer.x) / scale;
        const currentY = dragStartTilePos.y + (e.clientY - dragStartPointer.y) / scale;

        dragTileEl.style.transform = `translate(${currentX}px, ${currentY}px)`;

        // Calculate target column slot and show ghost indicator
        updateDropGhostIndicator(currentX);
      }
    });

    const handlePointerUpOrCancel = (e) => {
      if (dragWindowId !== windowId) return;

      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {}

      const duration = Date.now() - pointerDownTime;
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);

      if (isDraggingTile) {
        // FINISHED DRAGGING: SNAP TO COLUMN
        isDraggingTile = false;
        dragTileEl.classList.remove('is-dragging');
        hideDropGhostIndicator();

        const targetIndex = dropTargetColIndex;
        console.log(`[Drag] Dropped window ${windowId} into column ${targetIndex}`);

        // Contract: POST /window/move-to-column {"id": <window_id>, "index": <target_index>}
        postAction('/window/move-to-column', { id: windowId, index: targetIndex });

        // Temporarily animate back to estimated position until snapshot arrives
        dragTileEl = null;
        dragWindowId = null;
      } else if (dist < 8 && duration < 350) {
        // TAP A WINDOW TILE:
        // 1. Call POST /window/focus {"id": <window.id>}
        // 2. Smoothly center tile in horizontal scrolling strip
        // 3. Reveal small contextual action overlay (close × and switch-preset-width)
        console.log(`[Tap] Focused window ${windowId}`);
        postAction('/window/focus', { id: windowId });
        centerWindowInViewport(windowId, true);

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

    el.addEventListener('pointerup', handlePointerUpOrCancel);
    el.addEventListener('pointercancel', handlePointerUpOrCancel);
  }

  // =========================================================================
  // Column Snapping Math & Drop Ghost Preview (1 x (n+1) grid)
  // =========================================================================
  function updateDropGhostIndicator(tileX) {
    if (!computedColumnsInfo || computedColumnsInfo.length === 0) {
      dropTargetColIndex = 1;
      return;
    }

    // Find closest existing column
    let bestIndex = computedColumnsInfo[0].colIndex;
    let minDistance = Infinity;
    let targetX = computedColumnsInfo[0].x;

    for (let i = 0; i < computedColumnsInfo.length; i++) {
      const col = computedColumnsInfo[i];
      const dist = Math.abs(tileX - col.x);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = col.colIndex;
        targetX = col.x;
      }
    }

    // If dragged past the last column, snap to the new (n+1) column slot
    const lastCol = computedColumnsInfo[computedColumnsInfo.length - 1];
    if (tileX > lastCol.x + (lastCol.width * 0.55)) {
      bestIndex = lastCol.colIndex + 1;
      targetX = lastCol.x + lastCol.width + 24;
    }

    dropTargetColIndex = Math.max(1, bestIndex);

    // Show indicator
    dropIndicator.classList.remove('hidden');
    dropIndicator.style.transform = `translateX(${targetX}px)`;
    dropColNum.textContent = dropTargetColIndex;
  }

  function hideDropGhostIndicator() {
    dropIndicator.classList.add('hidden');
  }

  // =========================================================================
  // Contextual Action Overlay (Tapped Window Tile)
  // =========================================================================
  function showOverlay(win) {
    activeOverlayWindowId = win.id;
    positionOverlay(win);
    actionOverlay.classList.remove('hidden');
  }

  function positionOverlay(win) {
    const layout = computedWindowLayouts.get(win.id) || {
      x: 24,
      y: 24,
      width: win.layout?.tile_size?.[0] || 960,
      height: win.layout?.tile_size?.[1] || 1028,
    };

    // Position in top right corner of tile inside canvas coordinate space
    const overlayX = layout.x + layout.width - 170;
    const overlayY = layout.y + 8;

    actionOverlay.style.transform = `translate(${overlayX}px, ${overlayY}px)`;
  }

  function hideOverlay() {
    activeOverlayWindowId = null;
    actionOverlay.classList.add('hidden');
  }

  // Overlay Action Handlers
  btnOverlayClose.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeOverlayWindowId !== null) {
      const id = activeOverlayWindowId;
      hideOverlay();
      postAction('/window/close', { id });
    }
  });

  btnOverlayWidth.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeOverlayWindowId !== null) {
      const id = activeOverlayWindowId;
      postAction('/window/switch-preset-width', { id });
    }
  });

  // Tap empty stage background: Dismiss overlay
  stage.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.niri-window-tile') && !e.target.closest('.tile-action-overlay')) {
      hideOverlay();
    }
  });

  // =========================================================================
  // Viewport Scrolling & Gestures (Wheel, Pan, Workspace Swipe)
  // =========================================================================
  viewportScaler.addEventListener('wheel', (e) => {
    if (isOverviewMode) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      viewportScaler.scrollLeft += e.deltaY;
    } else {
      viewportScaler.scrollLeft += e.deltaX;
    }
  }, { passive: true });

  stage.addEventListener('pointerdown', (e) => {
    // Only register background swipes when not clicking tiles or controls
    if (e.target.closest('.niri-window-tile') || e.target.closest('header') || e.target.closest('.workspace-pager') || e.target.closest('.empty-column-slot')) {
      swipeStart = null;
      return;
    }
    swipeStart = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewportScaler.scrollLeft,
      time: Date.now(),
    };
  });

  stage.addEventListener('pointermove', (e) => {
    if (!swipeStart || isDraggingTile || isOverviewMode) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    // Pan horizontally if gesture is horizontal
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      viewportScaler.scrollLeft = swipeStart.scrollLeft - dx;
    }
  });

  stage.addEventListener('pointerup', (e) => {
    if (!swipeStart) return;
    const dy = e.clientY - swipeStart.y;
    const dx = e.clientX - swipeStart.x;
    const dt = Date.now() - swipeStart.time;

    swipeStart = null;

    // Must be predominantly vertical swipe for workspace switching
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5 && dt < 400) {
      if (dy < 0) {
        // Swiped UP -> Move to workspace below
        console.log('[Gesture] Swiped up -> /workspace/down');
        postAction('/workspace/down');
      } else {
        // Swiped DOWN -> Move to workspace above
        console.log('[Gesture] Swiped down -> /workspace/up');
        postAction('/workspace/up');
      }
    }
  });

  function renderWorkspacePager(workspaces) {
    workspacePager.innerHTML = '';
    const sorted = [...workspaces].sort((a, b) => a.idx - b.idx);

    sorted.forEach((ws) => {
      const dot = document.createElement('button');
      dot.className = `pager-dot ${ws.is_active ? 'is-active' : ''} ${ws.is_urgent ? 'is-urgent' : ''}`;
      dot.setAttribute('title', ws.name ? `Workspace ${ws.idx + 1}: ${ws.name}` : `Workspace ${ws.idx + 1}`);

      const tooltip = document.createElement('span');
      tooltip.className = 'pager-tooltip';
      tooltip.textContent = ws.name || `WS ${ws.idx + 1}`;
      dot.appendChild(tooltip);

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        // If clicked an inactive workspace, step towards it
        if (!ws.is_active) {
          const currentIdx = sorted.findIndex((w) => w.is_active);
          const targetIdx = sorted.findIndex((w) => w.id === ws.id);
          if (targetIdx > currentIdx) {
            postAction('/workspace/down');
          } else {
            postAction('/workspace/up');
          }
        }
      });

      workspacePager.appendChild(dot);
    });
  }

  // =========================================================================
  // Top Navigation Button Handlers
  // =========================================================================
  btnWsUp.addEventListener('click', () => postAction('/workspace/up'));
  btnWsDown.addEventListener('click', () => postAction('/workspace/down'));
  btnColLeft.addEventListener('click', () => postAction('/column/left'));
  btnColRight.addEventListener('click', () => postAction('/column/right'));

  btnOverview.addEventListener('click', () => {
    isOverviewMode = !isOverviewMode;
    if (isOverviewMode) {
      btnOverview.classList.add('is-active');
    } else {
      btnOverview.classList.remove('is-active');
    }
    postAction('/overview');
    if (currentSnapshot) {
      const activeWindows = currentSnapshot.windows.filter(
        (w) => w.workspace_id === activeWorkspaceId && !w.is_floating
      );
      recalculateScaling(activeWindows);
    }
  });

  if (emptyColumnSlot) {
    emptyColumnSlot.addEventListener('click', () => {
      postAction('/sim/new-window', { title: 'Terminal — fish', app_id: 'kitty' });
    });
  }

  btnAddWindow.addEventListener('click', () => {
    postAction('/sim/new-window', { title: 'Terminal — fish', app_id: 'kitty' });
  });

  // Settings Modal
  btnConfig.addEventListener('click', () => {
    inputWsUrl.value = config.wsUrl;
    inputApiUrl.value = config.apiUrl;
    settingsModal.classList.remove('hidden');
  });

  btnModalClose.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  btnApplyEndpoint.addEventListener('click', () => {
    const wsVal = inputWsUrl.value.trim() || defaultWsUrl;
    const apiVal = inputApiUrl.value.trim() || defaultApiUrl;
    config.wsUrl = wsVal;
    config.apiUrl = apiVal;
    localStorage.setItem('niri_ws_url', wsVal);
    localStorage.setItem('niri_api_url', apiVal);
    settingsModal.classList.add('hidden');
    connectWebSocket();
  });

  btnResetEndpoint.addEventListener('click', () => {
    config.wsUrl = defaultWsUrl;
    config.apiUrl = defaultApiUrl;
    localStorage.removeItem('niri_ws_url');
    localStorage.removeItem('niri_api_url');
    inputWsUrl.value = defaultWsUrl;
    inputApiUrl.value = defaultApiUrl;
    settingsModal.classList.add('hidden');
    connectWebSocket();
  });

  // Simulation Controls
  btnSimReset.addEventListener('click', () => {
    postAction('/sim/reset');
    settingsModal.classList.add('hidden');
  });

  btnSimAddNvim.addEventListener('click', () => {
    postAction('/sim/new-window', { title: 'Nvim — main.go', app_id: 'kitty' });
    settingsModal.classList.add('hidden');
  });

  btnSimAddBrowser.addEventListener('click', () => {
    postAction('/sim/new-window', { title: 'Firefox — Wayland Compositors', app_id: 'firefox' });
    settingsModal.classList.add('hidden');
  });

  // Window Resize: recompute scale
  window.addEventListener('resize', () => {
    if (currentSnapshot) {
      const activeWindows = currentSnapshot.windows.filter(
        (w) => w.workspace_id === activeWorkspaceId && !w.is_floating
      );
      recalculateScaling(activeWindows);
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initial Startup
  connectWebSocket();
})();
