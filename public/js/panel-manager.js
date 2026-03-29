import { gmcp } from './gmcp.js';
import { PANEL_DEFS, PANEL_STORAGE_KEY } from './panel-defs.js';
import { panelRenderers } from './panel-renderers.js';

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

    this.attachDragHandlers();
    this.registerGmcpHandlers();
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
      panels[id] = {
        dock: s.dock || def.defaultDock,
        order: s.order !== undefined ? s.order : def.defaultOrder,
        collapsed: !!s.collapsed,
        visible: s.visible !== undefined ? s.visible : true,
        floatX: s.floatX || 100,
        floatY: s.floatY || 100,
        floatW: s.floatW || 280,
        floatH: s.floatH || 200,
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
    el.style.left = st.floatX + 'px';
    el.style.top = st.floatY + 'px';
    el.style.width = st.floatW + 'px';
    el.style.height = st.floatH + 'px';

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
    const drag = {
      active: false,
      panelId: null,
      ghostEl: null,
      startX: 0, startY: 0,
      offsetX: 0, offsetY: 0,
      indicator: null,
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

      drag.ghostEl.style.left = (e.clientX - drag.offsetX) + 'px';
      drag.ghostEl.style.top = (e.clientY - drag.offsetY) + 'px';

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
  }
};
