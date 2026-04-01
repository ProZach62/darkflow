// ide-manager.js - GMCP glue for the in-browser IDE
// Lazy-loads the CodeMirror editor on first use and routes GMCP messages.

import { gmcp } from './gmcp.js';

const DW_IDE_OPEN = 'Darkwind.IDE.Open';
const DW_IDE_SAVE = 'Darkwind.IDE.Save';
const DW_IDE_SAVE_RESULT = 'Darkwind.IDE.SaveResult';
const DW_IDE_CLOSE = 'Darkwind.IDE.Close';

export const ideManager = {
  editor: null,
  loadPromise: null,

  init() {
    gmcp.on(DW_IDE_OPEN, (data) => this.handleOpen(data));
    gmcp.on(DW_IDE_SAVE_RESULT, (data) => this.handleSaveResult(data));
  },

  async handleOpen(data) {
    if (!this.editor) {
      this.showLoading();
      try {
        if (!this.loadPromise) {
          this.loadPromise = import('./ide-editor.js');
        }
        const mod = await this.loadPromise;
        this.editor = mod.ideEditor;
        await this.editor.init();
      } catch (e) {
        console.error('[IDE] Failed to load editor:', e);
        this.hideLoading();
        return;
      }
      this.hideLoading();
    }

    this.editor.open(data, {
      onSave: (path, content) => {
        gmcp.send(DW_IDE_SAVE, { path, content });
      },
      onClose: (path) => {
        gmcp.send(DW_IDE_CLOSE, { path });
        const input = document.getElementById('command-input');
        if (input) input.focus();
      },
    });
  },

  handleSaveResult(data) {
    if (this.editor) {
      this.editor.handleSaveResult(data);
    }
  },

  showLoading() {
    let el = document.getElementById('ide-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ide-loading';
      el.className = 'ide-loading';
      el.innerHTML = '<div class="ide-loading-spinner"></div><div class="ide-loading-text">Loading editor...</div>';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  },

  hideLoading() {
    const el = document.getElementById('ide-loading');
    if (el) el.style.display = 'none';
  },
};
