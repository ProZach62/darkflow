// ide-editor.js - CodeMirror 6 in-browser IDE for Darkwind MUD
// Loaded lazily by ide-manager.js on first use.
// CodeMirror is fetched from esm.sh CDN (no bundler required).

const CM_CDN = 'https://esm.sh';

let cm = null; // CodeMirror modules, loaded once

async function loadCodeMirror() {
  if (cm) return cm;

  const [
    viewMod,
    stateMod,
    setupMod,
    themeMod,
    cppMod,
    jsonMod,
    markdownMod,
    lintMod,
  ] = await Promise.all([
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/view`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/state`),
    import(/* @vite-ignore */ `${CM_CDN}/codemirror`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/theme-one-dark`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/lang-cpp`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/lang-json`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/lang-markdown`),
    import(/* @vite-ignore */ `${CM_CDN}/@codemirror/lint`),
  ]);

  cm = {
    EditorView: viewMod.EditorView,
    keymap: viewMod.keymap,
    lineNumbers: viewMod.lineNumbers,
    EditorState: stateMod.EditorState,
    Compartment: stateMod.Compartment,
    basicSetup: setupMod.basicSetup,
    oneDark: themeMod.oneDark,
    cpp: cppMod.cpp,
    json: jsonMod.json,
    markdown: markdownMod.markdown,
    linter: lintMod.linter,
    lintGutter: lintMod.lintGutter,
  };
  return cm;
}

function getLangExtension(language) {
  if (!cm) return [];
  switch (language) {
    case 'c': return [cm.cpp()];
    case 'json': return [cm.json()];
    case 'markdown': return [cm.markdown()];
    default: return [];
  }
}

function isReadOnlyValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isEditableValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export const ideEditor = {
  view: null,
  root: null,
  hostEl: null,
  callbacks: null,
  originalContent: '',
  currentPath: '',
  lintCompartment: null,
  statusBar: null,
  errorPanel: null,
  errorList: null,
  errorTitle: null,
  filepathEl: null,
  cursorPosEl: null,
  saveBtn: null,
  closeBtn: null,
  statusText: null,
  readOnly: false,
  saveTimeout: null,

  async init() {
    await loadCodeMirror();
  },

  open(data, callbacks, hostEl) {
    if (!hostEl) throw new Error('IDE host element is required.');

    // Remove any existing editor view before assigning callbacks; close(true)
    // clears callback state for the previous editor instance.
    if (this.root || this.view) this.close(true);

    this.callbacks = callbacks;
    this.hostEl = hostEl;
    this.currentPath = data.path || '';
    this.originalContent = data.content || '';
    this.readOnly = isEditableValue(data.editable) ? false : isReadOnlyValue(data.readOnly);
    this.saveBtn = null;
    this.closeBtn = null;
    this.filepathEl = null;
    this.cursorPosEl = null;

    this.lintCompartment = new cm.Compartment();

    // Build DOM
    this.root = document.createElement('div');
    this.root.className = 'ide-pane';

    const modal = document.createElement('div');
    modal.className = 'ide-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'ide-header';

    const filepath = document.createElement('div');
    filepath.className = 'ide-filepath';
    filepath.textContent = data.title || data.path || 'untitled';
    this.filepathEl = filepath;
    if (this.readOnly) {
      const badge = document.createElement('span');
      badge.className = 'ide-readonly-badge';
      badge.textContent = 'READ ONLY';
      filepath.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'ide-actions';

    if (!this.readOnly) {
      this.saveBtn = document.createElement('button');
      this.saveBtn.type = 'button';
      this.saveBtn.className = 'ide-btn ide-btn-save';
      this.saveBtn.textContent = 'Save';
      this.saveBtn.title = 'Ctrl+S';
      this.saveBtn.addEventListener('click', () => this.save());
      actions.appendChild(this.saveBtn);
    }

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'ide-btn ide-btn-close';
    this.closeBtn.textContent = 'Close';
    this.closeBtn.title = 'Escape';
    this.closeBtn.addEventListener('click', () => this.tryClose());
    actions.appendChild(this.closeBtn);

    header.appendChild(filepath);
    header.appendChild(actions);

    // Editor container
    const editorContainer = document.createElement('div');
    editorContainer.className = 'ide-editor-container';

    // Error panel
    this.errorPanel = document.createElement('div');
    this.errorPanel.className = 'ide-error-panel';
    this.errorPanel.style.display = 'none';

    this.errorTitle = document.createElement('div');
    this.errorTitle.className = 'ide-error-title';
    this.errorPanel.appendChild(this.errorTitle);

    this.errorList = document.createElement('div');
    this.errorList.className = 'ide-error-list';
    this.errorPanel.appendChild(this.errorList);

    // Status bar
    this.statusBar = document.createElement('div');
    this.statusBar.className = 'ide-status-bar';

    this.statusText = document.createElement('span');
    this.statusText.className = 'ide-status-text';

    const posInfo = document.createElement('span');
    posInfo.className = 'ide-status-pos';
    posInfo.textContent = 'Ln 1, Col 1';
    this.cursorPosEl = posInfo;

    this.statusBar.appendChild(this.statusText);
    this.statusBar.appendChild(posInfo);

    // Assemble
    modal.appendChild(header);
    modal.appendChild(editorContainer);
    modal.appendChild(this.errorPanel);
    modal.appendChild(this.statusBar);
    this.root.appendChild(modal);
    hostEl.textContent = '';
    hostEl.appendChild(this.root);

    // Create CodeMirror
    const extensions = [
      cm.basicSetup,
      cm.oneDark,
      ...getLangExtension(data.language),
      this.lintCompartment.of([]),
      cm.lintGutter(),
      cm.keymap.of([
        {
          key: 'Mod-s',
          run: () => { this.save(); return true; },
        },
      ]),
      cm.EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          this.updateCursorPos();
        }
        if (update.docChanged) {
          this.updateModified();
        }
      }),
    ];

    if (this.readOnly) {
      extensions.push(cm.EditorState.readOnly.of(true));
    }

    // Filter out any undefined extensions from CDN load issues
    const validExtensions = extensions.filter(e => e !== undefined && e !== null);

    this.view = new cm.EditorView({
      state: cm.EditorState.create({
        doc: data.content || '',
        extensions: validExtensions,
      }),
      parent: editorContainer,
    });

    this.view.focus();
    this.updateStatus('');

    // Escape key handler on overlay
    this._keyHandler = (e) => {
      const loweredKey = String(e.key || '').toLowerCase();

      if ((e.ctrlKey || e.metaKey) && !e.altKey && loweredKey === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (!this.readOnly) this.save();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.tryClose();
      }
    };
    document.addEventListener('keydown', this._keyHandler, true);
  },

  save() {
    if (!this.view || !this.callbacks) return;
    const content = this.view.state.doc.toString();
    this.updateStatus('Saving...');
    if (this.saveBtn) this.saveBtn.disabled = true;
    this.startSaveTimeout();
    const result = this.callbacks.onSave(this.currentPath, content);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        this.clearSaveTimeout();
        if (this.saveBtn) this.saveBtn.disabled = false;
        this.updateStatus('Save failed');
        this.showErrors([], error && error.message ? error.message : 'Save failed.');
      });
    }
  },

  handleSaveResult(data) {
    if (!this.view) return;
    this.clearSaveTimeout();
    if (this.saveBtn) this.saveBtn.disabled = false;

    if (data.success) {
      this.originalContent = this.view.state.doc.toString();
      this.updateStatus('Saved successfully');
      this.updateModified();
      this.clearErrors();
    } else {
      this.updateStatus(data && data.message ? 'Save failed' : 'Compile failed');
      this.showErrors(data.errors || [], data.message || '');
    }
  },

  handleTransferProgress(label) {
    this.updateStatus(label || 'Transferring...');
  },

  handleTransferFailure(message) {
    if (!this.view) return;
    this.clearSaveTimeout();
    if (this.saveBtn) this.saveBtn.disabled = false;
    this.updateStatus('Save failed');
    this.showErrors([], message || 'The save did not complete.');
  },

  startSaveTimeout() {
    this.clearSaveTimeout();
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.handleTransferFailure('Timed out waiting for the IDE save response.');
    }, 60000);
  },

  clearSaveTimeout() {
    if (!this.saveTimeout) return;
    clearTimeout(this.saveTimeout);
    this.saveTimeout = null;
  },

  showErrors(errors, message) {
    if (!this.errorPanel || !this.errorList || !this.errorTitle) return;
    if (!errors.length && !message) {
      this.clearErrors();
      return;
    }

    this.errorPanel.style.display = 'block';
    this.errorTitle.textContent = 'Compile Errors (' + (errors.length || 1) + ')';
    this.errorList.innerHTML = '';

    if (errors.length) {
      for (const err of errors) {
        const item = document.createElement('div');
        item.className = 'ide-error-item';

        const loc = document.createElement('span');
        loc.className = 'ide-error-location';
        loc.textContent = 'Line ' + err.line;

        const msg = document.createElement('span');
        msg.className = 'ide-error-message';
        msg.textContent = err.message;

        item.appendChild(loc);
        item.appendChild(msg);
        item.addEventListener('click', () => this.jumpToLine(err.line, err.column));
        this.errorList.appendChild(item);
      }

      // Update CodeMirror lint diagnostics
      if (this.view && this.lintCompartment) {
        const diagnostics = errors.map((err) => {
          const line = this.view.state.doc.line(Math.min(err.line, this.view.state.doc.lines));
          const from = line.from + Math.max(0, (err.column || 1) - 1);
          return { from, to: from + 1, severity: 'error', message: err.message };
        });
        this.view.dispatch({
          effects: this.lintCompartment.reconfigure(
            cm.linter(() => diagnostics)
          ),
        });
      }
    } else if (message) {
      const item = document.createElement('div');
      item.className = 'ide-error-item';
      item.textContent = message;
      this.errorList.appendChild(item);
    }
  },

  clearErrors() {
    if (!this.errorPanel || !this.errorList) return;
    this.errorPanel.style.display = 'none';
    this.errorList.innerHTML = '';
    if (this.view && this.lintCompartment) {
      this.view.dispatch({
        effects: this.lintCompartment.reconfigure([]),
      });
    }
  },

  jumpToLine(line, column) {
    if (!this.view) return;
    const lineInfo = this.view.state.doc.line(Math.min(line, this.view.state.doc.lines));
    const pos = lineInfo.from + Math.max(0, (column || 1) - 1);
    this.view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    this.view.focus();
  },

  updateCursorPos() {
    if (!this.view) return;
    const pos = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(pos);
    const col = pos - line.from + 1;
    if (this.cursorPosEl) this.cursorPosEl.textContent = 'Ln ' + line.number + ', Col ' + col;
  },

  updateModified() {
    const current = this.view ? this.view.state.doc.toString() : '';
    const modified = current !== this.originalContent;
    const el = this.filepathEl;
    if (el) {
      const existing = el.querySelector('.ide-modified-dot');
      if (modified && !existing) {
        const dot = document.createElement('span');
        dot.className = 'ide-modified-dot';
        dot.textContent = ' \u25CF';
        el.appendChild(dot);
      } else if (!modified && existing) {
        existing.remove();
      }
    }
  },

  updateStatus(text) {
    if (this.statusText) this.statusText.textContent = text;
  },

  tryClose(options = {}) {
    const confirmDirty = options.confirmDirty !== false;

    if (this.view) {
      const current = this.view.state.doc.toString();
      if (current !== this.originalContent) {
        if (!confirmDirty) {
          this.updateStatus('Unsaved changes');
          return false;
        }
        if (!confirm('You have unsaved changes. Close anyway?')) return false;
      }
    }
    this.close(false);
    return true;
  },

  close(silent) {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.clearSaveTimeout();
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this.saveBtn = null;
    this.closeBtn = null;
    this.filepathEl = null;
    this.cursorPosEl = null;
    this.statusBar = null;
    this.errorPanel = null;
    this.errorList = null;
    this.errorTitle = null;
    if (!silent && this.callbacks) {
      this.callbacks.onClose(this.currentPath);
    }
    this.callbacks = null;
    this.hostEl = null;
  },
};
