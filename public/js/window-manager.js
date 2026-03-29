import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import { renderLayout, collectFormData, updateElements } from './window-renderer.js';
import {
  DW_WINDOW_OPEN, DW_WINDOW_UPDATE, DW_WINDOW_CLOSE,
  DW_WINDOW_SUBMIT, DW_WINDOW_ACTION, DW_WINDOW_CLOSED,
  ACTION_SUBMIT, ACTION_CLOSE,
} from './window-types.js';

export const windowManager = {
  windows: {},  // id -> { id, type, el, containerEl }

  init() {
    gmcp.on(DW_WINDOW_OPEN, (data) => this.openWindow(data));
    gmcp.on(DW_WINDOW_UPDATE, (data) => this.updateWindow(data));
    gmcp.on(DW_WINDOW_CLOSE, (data) => this.closeWindow(data.id));
  },

  openWindow(data) {
    if (!data || !data.id || !data.layout) return;

    // Close existing window with same id
    if (this.windows[data.id]) {
      this.closeWindow(data.id, true);
    }

    const buttonHandler = (buttonId, action) => {
      this._handleButton(data.id, buttonId, action);
    };

    const content = renderLayout(data.layout, buttonHandler);

    if (data.type === 'panel') {
      this._openPanel(data, content);
    } else {
      this._openModal(data, content);
    }
  },

  _openModal(data, content) {
    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay';
    overlay.setAttribute('data-dw-window', data.id);

    const modal = document.createElement('div');
    modal.className = 'dw-modal';
    if (data.width) modal.style.width = data.width + (typeof data.width === 'number' ? 'px' : '');
    if (data.height) modal.style.height = data.height + (typeof data.height === 'number' ? 'px' : '');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.className = 'dw-modal-header';
    const titleText = document.createElement('span');
    titleText.className = 'dw-modal-title';
    titleText.textContent = data.title || '';
    titleBar.appendChild(titleText);

    if (data.closable !== false) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'dw-modal-close';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.addEventListener('click', () => this._userClose(data.id));
      titleBar.appendChild(closeBtn);
    }

    // Body
    const body = document.createElement('div');
    body.className = 'dw-modal-body';
    body.appendChild(content);

    modal.appendChild(titleBar);
    modal.appendChild(body);
    overlay.appendChild(modal);

    // Close on backdrop click
    if (data.closable !== false) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this._userClose(data.id);
      });
    }

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape' && data.closable !== false) {
        this._userClose(data.id);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);

    this.windows[data.id] = {
      id: data.id,
      type: 'modal',
      el: overlay,
      containerEl: body,
      escHandler,
    };
  },

  _openPanel(data, content) {
    const dock = data.dock || 'right';
    const order = data.order !== undefined ? data.order : 99;

    const bodyEl = panelManager.createDynamicPanel(
      'dw-' + data.id,
      data.title || data.id,
      dock,
      order,
      () => this._userClose(data.id)
    );

    if (!bodyEl) return;
    bodyEl.appendChild(content);

    this.windows[data.id] = {
      id: data.id,
      type: 'panel',
      el: null,
      containerEl: bodyEl,
      panelId: 'dw-' + data.id,
    };
  },

  updateWindow(data) {
    if (!data || !data.id) return;
    const win = this.windows[data.id];
    if (!win) return;
    if (Array.isArray(data.updates)) {
      updateElements(win.containerEl, data.updates);
    }
  },

  closeWindow(id, silent) {
    const win = this.windows[id];
    if (!win) return;

    if (win.type === 'modal') {
      if (win.escHandler) document.removeEventListener('keydown', win.escHandler);
      if (win.el) win.el.remove();
    } else if (win.type === 'panel' && win.panelId) {
      panelManager.removeDynamicPanel(win.panelId);
    }

    delete this.windows[id];
  },

  _userClose(id) {
    gmcp.send(DW_WINDOW_CLOSED, { id });
    this.closeWindow(id, true);
  },

  _handleButton(windowId, buttonId, action) {
    if (action === ACTION_SUBMIT) {
      const win = this.windows[windowId];
      if (!win) return;
      const data = collectFormData(win.containerEl);
      gmcp.send(DW_WINDOW_SUBMIT, { id: windowId, button: buttonId, data });
    } else if (action === ACTION_CLOSE) {
      this._userClose(windowId);
    } else {
      gmcp.send(DW_WINDOW_ACTION, { id: windowId, button: buttonId });
    }
  },

  resetAll() {
    for (const id of Object.keys(this.windows)) {
      this.closeWindow(id, true);
    }
  },
};
