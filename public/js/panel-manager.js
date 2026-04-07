import { gmcp } from './gmcp.js';
import { PANEL_DEFS, PANEL_STORAGE_KEY } from './panel-defs.js';
import { panelRenderers } from './panel-renderers.js';
import { processRoomInfo, mergeServerAreaData, mergeServerUpdate, applyRoomCorrection, load as loadMapData } from './map-data.js';

export const panelManager = {
  state: { docks: { left: false, right: false }, panels: {} },
  panels: {},
  gmcpData: {},
  _saveTimer: null,

  init() {
    this.loadState();
    this.buildPanelsMenu();

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    if (this.state.docks.left) leftDock.classList.add('collapsed');
    if (this.state.docks.right) rightDock.classList.add('collapsed');

    document.getElementById('left-dock-toggle').classList.toggle('active', !this.state.docks.left);
    document.getElementById('right-dock-toggle').classList.toggle('active', !this.state.docks.right);

    loadMapData();
    this.attachDragHandlers();
    this.registerGmcpHandlers();
    this._attachResizeHandler();
  },

  loadState() {
    let saved = null;
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch(e) { /* ignore */ }

    if (saved && saved.docks) {
      this.state.docks = saved.docks;
    }

    const panels = {};
    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      const s = (saved && saved.panels && saved.panels[id]) || {};
      const defW = def.defaultFloatW || 280;
      const defH = def.defaultFloatH || 200;
      let defX, defY;
      if (def.defaultFloatX !== undefined) {
        defX = def.defaultFloatX;
        if (defX < 0) defX = window.innerWidth + defX;
      } else {
        // Center horizontally
        defX = Math.round((window.innerWidth - defW) / 2);
      }
      if (def.defaultFloatY !== undefined) {
        defY = def.defaultFloatY;
        if (defY < 0) defY = window.innerHeight + defY;
      } else {
        // Center vertically
        defY = Math.round((window.innerHeight - defH) / 2);
      }
      panels[id] = {
        dock: s.dock || def.defaultDock,
        order: s.order !== undefined ? s.order : def.defaultOrder,
        collapsed: !!s.collapsed,
        visible: s.visible !== undefined ? s.visible : (def.defaultVisible !== undefined ? def.defaultVisible : true),
        floatX: s.floatX !== undefined ? s.floatX : defX,
        floatY: s.floatY !== undefined ? s.floatY : defY,
        floatW: s.floatW || defW,
        floatH: s.floatH || defH,
        snapLeft: s.snapLeft !== undefined ? !!s.snapLeft : !!def.defaultSnapLeft,
        snapTop: s.snapTop !== undefined ? !!s.snapTop : !!def.defaultSnapTop,
        snapRight: s.snapRight !== undefined ? !!s.snapRight : !!def.defaultSnapRight,
        snapBottom: s.snapBottom !== undefined ? !!s.snapBottom : !!def.defaultSnapBottom,
      };
    }
    this.state.panels = panels;
  },

  saveState() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(this.state)); }
      catch(e) { /* ignore */ }
    }, 500);
  },

  buildPanelsMenu() {
    const menu = document.getElementById('panels-menu');
    menu.innerHTML = '';
    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.state.panels[id].visible;
      cb.dataset.panelId = id;
      cb.addEventListener('change', () => {
        if (cb.checked) this.openPanel(id);
        else this.closePanel(id);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + def.title));
      menu.appendChild(label);
    }
  },

  createPanel(id) {
    if (this.panels[id]) return;

    const def = PANEL_DEFS[id];
    const st = this.state.panels[id];

    const el = document.createElement('div');
    el.className = 'gmcp-panel-widget';
    el.dataset.panelId = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.panelId = id;

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = def.title;

    const controls = document.createElement('span');
    controls.className = 'panel-controls';

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'panel-btn panel-collapse';
    collapseBtn.title = 'Collapse';
    collapseBtn.innerHTML = st.collapsed ? '&#x25BC;' : '&#x25B2;';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapsePanel(id, !this.state.panels[id].collapsed);
    });

    const floatBtn = document.createElement('button');
    floatBtn.className = 'panel-btn panel-float';
    floatBtn.title = st.dock === 'float' ? 'Dock' : 'Float';
    floatBtn.innerHTML = st.dock === 'float' ? '&#x25A3;' : '&#x25A1;';
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state.panels[id].dock === 'float') {
        this.dockPanel(id, PANEL_DEFS[id].defaultDock);
      } else {
        const rect = el.getBoundingClientRect();
        this.floatPanel(id, rect.left, rect.top);
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn panel-close';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePanel(id);
    });

    controls.appendChild(collapseBtn);
    controls.appendChild(floatBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body' + (st.collapsed ? ' collapsed' : '');
    body.id = 'panel-body-' + id;
    body.innerHTML = '<div class="placeholder">Waiting for data...</div>';

    el.appendChild(header);
    el.appendChild(body);

    this.panels[id] = { el, headerEl: header, bodyEl: body };

    if (st.dock === 'float') {
      this._makeFloat(el, st);
    } else {
      this._insertIntoDock(id, el, st.dock, st.order);
    }

    if (this.gmcpData[id]) {
      this._renderPanel(id);
    }
  },

  _insertIntoDock(id, el, side, order) {
    const dock = document.getElementById(side + '-dock');
    const children = Array.from(dock.querySelectorAll('.gmcp-panel-widget'));
    let inserted = false;
    for (const child of children) {
      const childId = child.dataset.panelId;
      const childOrder = this.state.panels[childId] ? this.state.panels[childId].order : 999;
      if (order < childOrder) {
        dock.insertBefore(el, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) dock.appendChild(el);
    el.classList.remove('floating');
    el.style.cssText = '';
  },

  _makeFloat(el, st) {
    document.body.appendChild(el);
    el.classList.add('floating');
    this._applyFloatPosition(el, st);

    const id = el.dataset.panelId;
    const ro = new ResizeObserver(() => {
      const s = this.state.panels[id];
      if (s && s.dock === 'float') {
        s.floatW = el.offsetWidth;
        s.floatH = el.offsetHeight;
        this.saveState();
      }
    });
    ro.observe(el);
  },

  _getSnapBounds() {
    const toolbar = document.getElementById('toolbar');
    const statusBar = document.getElementById('status-bar');
    const inputBar = document.getElementById('input-bar');
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    const top = toolbar ? toolbar.offsetHeight : 0;
    const bottom = (statusBar ? statusBar.offsetHeight : 0)
      + (inputBar ? inputBar.offsetHeight : 0);
    const leftEdge = leftDock ? leftDock.getBoundingClientRect().right : 0;
    let rightEdge = rightDock ? rightDock.getBoundingClientRect().left : window.innerWidth;
    // Always account for the output scrollbar width (8px per CSS)
    rightEdge -= 8;
    return {
      left: leftEdge,
      top: top,
      right: rightEdge,
      bottom: window.innerHeight - bottom,
    };
  },

  _applyFloatPosition(el, st) {
    el.style.width = st.floatW + 'px';
    el.style.height = st.floatH + 'px';
    const bounds = this._getSnapBounds();

    // Horizontal
    if (st.snapRight) {
      el.style.left = 'auto';
      el.style.right = (window.innerWidth - bounds.right) + 'px';
    } else if (st.snapLeft) {
      el.style.left = bounds.left + 'px';
      el.style.right = 'auto';
    } else {
      el.style.left = st.floatX + 'px';
      el.style.right = 'auto';
    }

    // Vertical
    if (st.snapBottom) {
      el.style.top = 'auto';
      el.style.bottom = (window.innerHeight - bounds.bottom) + 'px';
    } else if (st.snapTop) {
      el.style.top = bounds.top + 'px';
      el.style.bottom = 'auto';
    } else {
      el.style.top = st.floatY + 'px';
      el.style.bottom = 'auto';
    }
  },

  repositionSnappedPanels() {
    for (const [id, st] of Object.entries(this.state.panels)) {
      if (st.dock !== 'float') continue;
      if (!st.snapRight && !st.snapBottom && !st.snapLeft && !st.snapTop) continue;
      const p = this.panels[id];
      if (!p || !p.el) continue;
      this._applyFloatPosition(p.el, st);
    }
  },

  _attachResizeHandler() {
    window.addEventListener('resize', () => {
      this.repositionSnappedPanels();
    });
  },

  dockPanel(id, side, order) {
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;

    if (order === undefined) {
      const existing = Object.entries(this.state.panels)
        .filter(([pid, ps]) => ps.dock === side && pid !== id && this.panels[pid]);
      order = existing.length;
    }

    st.dock = side;
    st.order = order;
    this._insertIntoDock(id, p.el, side, order);

    // Renumber all panels in this dock to match actual DOM order
    const dock = document.getElementById(side + '-dock');
    const children = Array.from(dock.querySelectorAll('.gmcp-panel-widget'));
    children.forEach((child, i) => {
      const cid = child.dataset.panelId;
      if (this.state.panels[cid]) this.state.panels[cid].order = i;
    });

    const fb = p.el.querySelector('.panel-float');
    if (fb) { fb.title = 'Float'; fb.innerHTML = '&#x25A1;'; }

    this.saveState();
  },

  floatPanel(id, x, y) {
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;

    st.dock = 'float';
    st.floatX = x;
    st.floatY = y;

    const SNAP = 30;
    const w = st.floatW || p.el.offsetWidth || 280;
    const h = st.floatH || p.el.offsetHeight || 200;
    const bounds = this._getSnapBounds();

    st.snapLeft = x < (bounds.left + SNAP);
    st.snapTop = y < (bounds.top + SNAP);
    st.snapRight = (x + w) > (bounds.right - SNAP);
    st.snapBottom = (y + h) > (bounds.bottom - SNAP);

    if (st.snapLeft) st.floatX = bounds.left;
    if (st.snapTop) st.floatY = bounds.top;
    if (st.snapRight) st.floatX = bounds.right - w;
    if (st.snapBottom) st.floatY = bounds.bottom - h;

    this._makeFloat(p.el, st);

    const fb = p.el.querySelector('.panel-float');
    if (fb) { fb.title = 'Dock'; fb.innerHTML = '&#x25A3;'; }

    this.saveState();
  },

  collapsePanel(id, collapsed) {
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;
    st.collapsed = collapsed;
    p.bodyEl.classList.toggle('collapsed', collapsed);
    const cb = p.el.querySelector('.panel-collapse');
    if (cb) cb.innerHTML = collapsed ? '&#x25BC;' : '&#x25B2;';
    this.saveState();
  },

  closePanel(id) {
    const st = this.state.panels[id];
    st.visible = false;
    const p = this.panels[id];
    if (p) {
      p.el.remove();
      delete this.panels[id];
    }
    const cb = document.querySelector('#panels-menu input[data-panel-id="' + id + '"]');
    if (cb) cb.checked = false;
    this.saveState();
  },

  openPanel(id) {
    const st = this.state.panels[id];
    st.visible = true;
    this.createPanel(id);
    const cb = document.querySelector('#panels-menu input[data-panel-id="' + id + '"]');
    if (cb) cb.checked = true;
    this.saveState();
  },

  // ── Dynamic panels (server-driven, not persisted) ─────────────────
  createDynamicPanel(id, title, dock, order, onClose) {
    if (this.panels[id]) return this.panels[id].bodyEl;

    const el = document.createElement('div');
    el.className = 'gmcp-panel-widget';
    el.dataset.panelId = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.panelId = id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'panel-title';
    titleSpan.textContent = title;

    const controls = document.createElement('span');
    controls.className = 'panel-controls';

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'panel-btn panel-collapse';
    collapseBtn.innerHTML = '&#x25B2;';
    let collapsed = false;
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      body.classList.toggle('collapsed', collapsed);
      collapseBtn.innerHTML = collapsed ? '&#x25BC;' : '&#x25B2;';
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn panel-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClose) onClose();
      else this.removeDynamicPanel(id);
    });

    controls.appendChild(collapseBtn);
    controls.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body';

    el.appendChild(header);
    el.appendChild(body);

    this._insertIntoDock(id, el, dock, order);
    this.panels[id] = { el, headerEl: header, bodyEl: body, dynamic: true };
    this.state.panels[id] = { dock, order, collapsed: false, visible: true };

    return body;
  },

  removeDynamicPanel(id) {
    const p = this.panels[id];
    if (!p) return;
    p.el.remove();
    delete this.panels[id];
    delete this.state.panels[id];
  },

  resetData() {
    this.gmcpData = {};
    for (const [id, p] of Object.entries(this.panels)) {
      p.bodyEl.innerHTML = '<div class="placeholder">Waiting for data...</div>';
    }
  },

  _renderPanel(id) {
    const p = this.panels[id];
    if (!p) return;
    const renderer = panelRenderers[id];
    if (renderer) renderer(p.bodyEl, this.gmcpData[id]);
  },

  // ── Drag & Drop ───────────────────────────────────────────────────
  attachDragHandlers() {
    // Create snap edge indicators
    const snapEdges = {};
    ['left', 'top', 'right', 'bottom'].forEach(side => {
      const el = document.createElement('div');
      el.className = 'snap-edge snap-edge-' + side;
      document.body.appendChild(el);
      snapEdges[side] = el;
    });

    const drag = {
      active: false,
      panelId: null,
      ghostEl: null,
      startX: 0, startY: 0,
      offsetX: 0, offsetY: 0,
      indicator: null,
      snapEdges: snapEdges,
    };

    drag.indicator = document.createElement('div');
    drag.indicator.className = 'dock-drop-indicator';
    document.body.appendChild(drag.indicator);

    const THRESHOLD = 5;
    let pointerStarted = false;

    document.addEventListener('pointerdown', (e) => {
      const header = e.target.closest('.panel-header');
      if (!header) return;
      if (e.target.closest('.panel-btn')) return;

      const panelId = header.dataset.panelId;
      if (!panelId || !this.panels[panelId]) return;

      drag.panelId = panelId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;

      const rect = this.panels[panelId].el.getBoundingClientRect();
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;
      pointerStarted = true;

      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!pointerStarted) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (!drag.active) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        drag.active = true;

        const el = this.panels[drag.panelId].el;
        drag.ghostEl = el.cloneNode(true);
        drag.ghostEl.className = 'gmcp-panel-widget drag-ghost';
        drag.ghostEl.style.width = el.offsetWidth + 'px';
        document.body.appendChild(drag.ghostEl);

        el.style.opacity = '0.3';
      }

      let gx = e.clientX - drag.offsetX;
      let gy = e.clientY - drag.offsetY;
      const gw = drag.ghostEl.offsetWidth;
      const gh = drag.ghostEl.offsetHeight;
      const SNAP = 30;
      const bounds = this._getSnapBounds();

      // Detect snap edges and show indicators
      const snL = gx < (bounds.left + SNAP);
      const snT = gy < (bounds.top + SNAP);
      const snR = (gx + gw) > (bounds.right - SNAP);
      const snB = (gy + gh) > (bounds.bottom - SNAP);

      // Snap ghost position to edge
      if (snL) gx = bounds.left;
      if (snT) gy = bounds.top;
      if (snR) gx = bounds.right - gw;
      if (snB) gy = bounds.bottom - gh;

      drag.ghostEl.style.left = gx + 'px';
      drag.ghostEl.style.top = gy + 'px';

      // Show/hide snap edge indicators
      this._showSnapEdges(snL, snT, snR, snB, bounds, drag);

      this._updateDropZone(e.clientX, e.clientY, drag);
    });

    document.addEventListener('pointerup', (e) => {
      if (!pointerStarted) return;
      pointerStarted = false;

      if (!drag.active) {
        drag.panelId = null;
        return;
      }

      drag.active = false;
      const panelId = drag.panelId;
      const el = this.panels[panelId].el;

      if (drag.ghostEl) { drag.ghostEl.remove(); drag.ghostEl = null; }
      el.style.opacity = '';

      drag.indicator.style.display = 'none';
      this._showSnapEdges(false, false, false, false, null, drag);

      document.getElementById('left-dock').classList.remove('drag-over');
      document.getElementById('right-dock').classList.remove('drag-over');

      const drop = this._getDropTarget(e.clientX, e.clientY, panelId);
      if (drop.target === 'float') {
        this.floatPanel(panelId, e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      } else {
        this.dockPanel(panelId, drop.target, drop.order);
      }

      drag.panelId = null;
    });
  },

  _updateDropZone(x, y, drag) {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');

    leftDock.classList.remove('drag-over');
    rightDock.classList.remove('drag-over');
    drag.indicator.style.display = 'none';

    const drop = this._getDropTarget(x, y, drag.panelId);
    if (drop.target === 'left' || drop.target === 'right') {
      const dock = document.getElementById(drop.target + '-dock');
      dock.classList.add('drag-over');

      const panels = Array.from(dock.querySelectorAll('.gmcp-panel-widget'))
        .filter(el => el.dataset.panelId !== drag.panelId);

      if (panels.length === 0) {
        drag.indicator.style.display = 'block';
        const dockRect = dock.getBoundingClientRect();
        drag.indicator.style.left = dockRect.left + 'px';
        drag.indicator.style.top = (dockRect.top + 4) + 'px';
        drag.indicator.style.width = (dockRect.width - 8) + 'px';
        drag.indicator.style.position = 'fixed';
      } else if (drop.order <= 0) {
        const first = panels[0].getBoundingClientRect();
        drag.indicator.style.display = 'block';
        drag.indicator.style.left = first.left + 'px';
        drag.indicator.style.top = (first.top - 2) + 'px';
        drag.indicator.style.width = first.width + 'px';
        drag.indicator.style.position = 'fixed';
      } else {
        const idx = Math.min(drop.order - 1, panels.length - 1);
        const after = panels[idx].getBoundingClientRect();
        drag.indicator.style.display = 'block';
        drag.indicator.style.left = after.left + 'px';
        drag.indicator.style.top = (after.bottom + 1) + 'px';
        drag.indicator.style.width = after.width + 'px';
        drag.indicator.style.position = 'fixed';
      }
    }
  },

  _showSnapEdges(left, top, right, bottom, bounds, drag) {
    const edges = drag.snapEdges;
    if (!bounds) {
      edges.left.style.display = 'none';
      edges.top.style.display = 'none';
      edges.right.style.display = 'none';
      edges.bottom.style.display = 'none';
      return;
    }
    edges.left.style.display = left ? 'block' : 'none';
    edges.left.style.left = bounds.left + 'px';
    edges.left.style.top = bounds.top + 'px';
    edges.left.style.height = (bounds.bottom - bounds.top) + 'px';

    edges.top.style.display = top ? 'block' : 'none';
    edges.top.style.left = bounds.left + 'px';
    edges.top.style.top = bounds.top + 'px';
    edges.top.style.width = (bounds.right - bounds.left) + 'px';

    edges.right.style.display = right ? 'block' : 'none';
    edges.right.style.left = (bounds.right - 2) + 'px';
    edges.right.style.top = bounds.top + 'px';
    edges.right.style.height = (bounds.bottom - bounds.top) + 'px';

    edges.bottom.style.display = bottom ? 'block' : 'none';
    edges.bottom.style.left = bounds.left + 'px';
    edges.bottom.style.top = (bounds.bottom - 2) + 'px';
    edges.bottom.style.width = (bounds.right - bounds.left) + 'px';
  },

  _getDropTarget(x, y, panelId) {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    const leftRect = leftDock.getBoundingClientRect();
    const rightRect = rightDock.getBoundingClientRect();
    const margin = 30;

    let side = null;
    if (x < leftRect.right + margin && !leftDock.classList.contains('collapsed')) {
      side = 'left';
    } else if (x > rightRect.left - margin && !rightDock.classList.contains('collapsed')) {
      side = 'right';
    }

    if (!side) return { target: 'float' };

    const dock = document.getElementById(side + '-dock');
    const panels = Array.from(dock.querySelectorAll('.gmcp-panel-widget'))
      .filter(el => el.dataset.panelId !== panelId);

    let order = panels.length;
    for (let i = 0; i < panels.length; i++) {
      const rect = panels[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        order = this.state.panels[panels[i].dataset.panelId].order;
        break;
      }
    }

    return { target: side, order };
  },

  // ── GMCP Handlers ─────────────────────────────────────────────────
  registerGmcpHandlers() {
    gmcp.on('Char.Vitals', (data) => {
      this.gmcpData.vitals = data;
      this._renderPanel('vitals');
    });

    gmcp.on('Char.Stats', (data) => {
      if (!this.gmcpData.stats) this.gmcpData.stats = {};
      this.gmcpData.stats.current = data;
      this._renderPanel('stats');
    });

    gmcp.on('Char.RealStats', (data) => {
      if (!this.gmcpData.stats) this.gmcpData.stats = {};
      this.gmcpData.stats.base = data;
      this._renderPanel('stats');
    });

    gmcp.on('Char.Status', (data) => {
      this.gmcpData.status = data;
      this._renderPanel('status');
      if (!this.gmcpData.worth || !this.gmcpData.worth._dedicated) {
        this.gmcpData.worth = { gold: data.gold, bank: data.bank };
        this._renderPanel('worth');
      }
    });

    gmcp.on('Char.Worth', (data) => {
      this.gmcpData.worth = Object.assign({}, data, { _dedicated: true });
      this._renderPanel('worth');
    });

    gmcp.on('Room.Info', (data) => {
      if (!this.gmcpData.room) this.gmcpData.room = {};
      Object.assign(this.gmcpData.room, data);
      this._renderPanel('room');
      processRoomInfo(data);
      this._renderPanel('map');
    });

    gmcp.on('Darkwind.MapData.Area', (data) => {
      const merged = mergeServerAreaData(data);
      if (merged) this._renderPanel('map');
    });

    gmcp.on('Darkwind.MapData.Update', (data) => {
      const merged = mergeServerUpdate(data);
      if (merged) this._renderPanel('map');
    });

    gmcp.on('Darkwind.MapData.RoomCoords', (data) => {
      const merged = applyRoomCorrection(data);
      if (merged) this._renderPanel('map');
    });

    gmcp.on('Room.Players', (data) => {
      if (!this.gmcpData.room) this.gmcpData.room = {};
      this.gmcpData.room.players = data;
      this._renderPanel('room');
    });

    gmcp.on('Room.AddPlayer', (data) => {
      if (!this.gmcpData.room) this.gmcpData.room = {};
      if (!Array.isArray(this.gmcpData.room.players)) this.gmcpData.room.players = [];
      this.gmcpData.room.players.push(data);
      this._renderPanel('room');
    });

    gmcp.on('Room.RemovePlayer', (data) => {
      if (!this.gmcpData.room || !Array.isArray(this.gmcpData.room.players)) return;
      const name = typeof data === 'string' ? data : data.name;
      this.gmcpData.room.players = this.gmcpData.room.players.filter(p => p.name !== name);
      this._renderPanel('room');
    });

    gmcp.on('Char.Items.List', (data) => {
      if (data && data.location === 'inv') {
        this.gmcpData.inventory = Array.isArray(data.items) ? data.items : [];
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Add', (data) => {
      if (data && data.location === 'inv' && data.item) {
        if (!this.gmcpData.inventory) this.gmcpData.inventory = [];
        this.gmcpData.inventory.push(data.item);
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Remove', (data) => {
      if (data && data.location === 'inv' && data.item && this.gmcpData.inventory) {
        this.gmcpData.inventory = this.gmcpData.inventory.filter(i => i.id !== data.item.id);
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Update', (data) => {
      if (data && data.location === 'inv' && data.item && this.gmcpData.inventory) {
        const idx = this.gmcpData.inventory.findIndex(i => i.id === data.item.id);
        if (idx >= 0) this.gmcpData.inventory[idx] = data.item;
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Enemy', (data) => {
      this.gmcpData.enemy = data;
      const inCombat = data && data.enemy_name && data.enemy_name !== 'None' && data.enemy_name !== '';
      if (inCombat && !this.panels.enemy) {
        this.openPanel('enemy');
      }
      if (this.panels.enemy) {
        this.panels.enemy.el.style.display = inCombat ? '' : 'none';
      }
      this._renderPanel('enemy');
    });

    gmcp.on('Group', (data) => {
      this.gmcpData.group = data;
      this._renderPanel('group');
    });

    gmcp.on('Comm.Channel.Text', (data) => {
      if (!this.gmcpData.chat) this.gmcpData.chat = [];
      this.gmcpData.chat.push(data);
      if (this.gmcpData.chat.length > 200) this.gmcpData.chat.shift();
      this._renderPanel('chat');
    });

    gmcp.on('Darkwind.Quests.List', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.list = data;
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Active', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.active = data;
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Update', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.lastUpdate = data;
      // Update the active quest objective in-place if we have it
      if (this.gmcpData.quests.active && Array.isArray(this.gmcpData.quests.active.objectives)) {
        for (var i = 0; i < this.gmcpData.quests.active.objectives.length; i++) {
          if (this.gmcpData.quests.active.objectives[i].name === data.objective) {
            this.gmcpData.quests.active.objectives[i].current = data.current;
            this.gmcpData.quests.active.objectives[i].required = data.required;
            if (data.current >= data.required) {
              this.gmcpData.quests.active.objectives[i].status = 'finished';
            } else {
              this.gmcpData.quests.active.objectives[i].status = 'started';
            }
            break;
          }
        }
      }
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Complete', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.lastComplete = data;
      this._renderPanel('quests');
    });
  }
};
