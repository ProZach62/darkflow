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
    const isLogin = data.id === 'login';

    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay';
    if (isLogin) overlay.classList.add('dw-login-overlay');
    overlay.setAttribute('data-dw-window', data.id);

    const modal = document.createElement('div');
    modal.className = isLogin ? 'dw-modal dw-login-modal' : 'dw-modal';
    if (!isLogin) {
      if (data.width) modal.style.width = data.width + (typeof data.width === 'number' ? 'px' : '');
      if (data.height) modal.style.height = data.height + (typeof data.height === 'number' ? 'px' : '');
    }

    if (isLogin) {
      // Game-launcher two-panel layout: art left, form right
      const artPanel = document.createElement('div');
      artPanel.className = 'dw-login-art';
      const img = document.createElement('img');
      img.src = 'assets/login-background.jpg';
      img.alt = '';
      img.draggable = false;
      artPanel.appendChild(img);

      const formPanel = document.createElement('div');
      formPanel.className = 'dw-login-form';

      const brand = document.createElement('div');
      brand.className = 'dw-login-brand';
      brand.textContent = 'Darkwind';

      const tagline = document.createElement('div');
      tagline.className = 'dw-login-tagline';
      tagline.textContent = 'Enter the Realm';

      const body = document.createElement('div');
      body.className = 'dw-modal-body dw-login-body';
      body.appendChild(content);

      formPanel.appendChild(brand);
      formPanel.appendChild(tagline);
      formPanel.appendChild(body);

      modal.appendChild(artPanel);
      modal.appendChild(formPanel);
      overlay.appendChild(modal);
    } else {
      // Standard modal layout
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

      const body = document.createElement('div');
      body.className = 'dw-modal-body';
      body.appendChild(content);

      modal.appendChild(titleBar);
      modal.appendChild(body);
      overlay.appendChild(modal);
    }

    // Resolve the body container for form data collection
    const bodyContainer = isLogin
      ? modal.querySelector('.dw-login-body')
      : modal.querySelector('.dw-modal-body');

    // Close on backdrop click
    if (data.closable !== false) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this._userClose(data.id);
      });
    }

    // Close on Escape, submit on Enter
    const escHandler = (e) => {
      if (e.key === 'Escape' && data.closable !== false) {
        this._userClose(data.id);
      }
      if (e.key === 'Enter') {
        const active = document.activeElement;
        // Don't submit if typing in a textarea or explicitly focused on a non-submit button
        if (active && active.tagName === 'TEXTAREA') return;
        if (active && active.tagName === 'BUTTON' && !active.classList.contains('dw-button-primary')) return;
        const submitBtn = modal.querySelector('.dw-button-primary');
        if (submitBtn) {
          e.preventDefault();
          submitBtn.click();
        }
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);

    // Auto-focus first input for login modal
    if (isLogin) {
      const firstInput = modal.querySelector('.dw-input');
      if (firstInput) firstInput.focus();
    }

    this.windows[data.id] = {
      id: data.id,
      type: 'modal',
      el: overlay,
      containerEl: bodyContainer,
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
