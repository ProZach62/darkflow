import { state, dom } from './state.js';
import { DEFAULT_OUTPUT_SCROLLBACK_PRESET } from './constants.js';
import {
  appendSystemMessage,
  closeOpenOutputLine,
  sendTerminalGeometry,
  setOutputScrollbackBehavior,
  setOutputScrollbackPreset,
  setOutputSplitRatio,
} from './output.js';
import { aliasManager } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { styleToElement } from './ansi.js';
import { panelManager } from './panel-manager.js';
import { PRODUCT_NAME } from './brand.js';
import { getSoundCatalog, isKnownSound, soundManager, SOUND_CATEGORIES, SOUND_CATEGORY_INFO } from './sound-manager.js';
import { getAutomationStepLabel } from './automation-executor.js';
import { applyTheme, convertVsCodeTheme, BUILTIN_THEMES, DEFAULT_THEME_KEY } from './theme-manager.js';

const SETTINGS_STORAGE_KEY = 'darkwind-client-settings';
const ALIAS_STORAGE_KEY = 'darkwind-client-aliases-v1';
const HIGHLIGHT_STORAGE_KEY = 'darkwind-client-highlights-v1';
const TRIGGER_STORAGE_KEY = 'darkwind-client-triggers-v1';
const MIN_TERMINAL_WIDTH_COLUMNS = 40;
const MAX_TERMINAL_WIDTH_COLUMNS = 240;

function formatKeyCodeLabel(code) {
  const value = String(code || '').trim();
  if (!value) return '';

  if (/^Digit[0-9]$/.test(value)) return value.slice(-1);
  if (/^Numpad[0-9]$/.test(value)) return 'Num ' + value.slice(-1);
  if (value === 'NumpadDecimal') return 'Num .';
  if (value === 'NumpadAdd') return 'Num +';
  if (value === 'NumpadSubtract') return 'Num -';
  if (value === 'NumpadMultiply') return 'Num *';
  if (value === 'NumpadDivide') return 'Num /';
  if (value === 'NumpadEnter') return 'Num Enter';
  if (value === 'Space') return 'Space';
  if (value.startsWith('Arrow')) return value.slice(5);
  if (/^Key[A-Z]$/.test(value)) return value.slice(3);
  if (/^F[0-9]{1,2}$/.test(value)) return value;

  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function normalizeAutomationMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function normalizeLegacyKeyToCode(key) {
  const value = String(key || '').trim();
  if (!value) return '';
  if (/^[0-9]$/.test(value)) return 'Digit' + value;
  if (/^[a-zA-Z]$/.test(value)) return 'Key' + value.toUpperCase();
  if (value === ' ') return 'Space';
  if (value === 'ArrowUp' || value === 'ArrowDown' || value === 'ArrowLeft' || value === 'ArrowRight') return value;
  if (value === 'Enter' || value === 'Escape' || value === 'Tab' || value === 'Backspace' || value === 'Delete') return value;
  return '';
}

export const settingsManager = {
  _defaults: {
    autoReconnect: true,
    repeatLastCommand: true,
    keyMapperEnabled: false,
    keyMappings: [],
    aliasTabCompletionEnabled: true,
    historyTabCompletionEnabled: false,
    scrollbackBehavior: 'pause',
    scrollbackSplitRatio: 0.6,
    outputScrollbackPreset: DEFAULT_OUTPUT_SCROLLBACK_PRESET,
    screenReaderMode: false,
    terminalWidthColumns: null,
    workspaceLayout: 'classic',
    paneGridSnapEnabled: false,
    settingsBackupPromptEnabled: true,
    theme: DEFAULT_THEME_KEY,
    customThemes: {},
  },
  _settings: {},
  _draftSettings: {},
  _aliasScopeKey: '',
  _draftAliasScope: null,
  _highlightScopeKey: '',
  _draftHighlightScope: null,
  _triggerScopeKey: '',
  _draftTriggerScope: null,
  _overlay: null,
  _escHandler: null,
  _dataSyncHandler: null,
  _refreshEditors: null,
  _activateTab: null,
  _pendingAliasSelection: null,
  _footerStatusEl: null,
  _previousFocusEl: null,
  _modalKeyHandler: null,
  _activeEditFocusScope: null,
  _settingsSessionBaseline: '',
  _backupClosePromptEl: null,

  init() {
    this._settings = { ...this._defaults };

    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this._settings = { ...this._settings, ...parsed };
        }
      }
    } catch (error) {
      console.warn('Failed to load client settings', error);
    }

    this._settings = this._normalizeSettings(this._settings);
    state.settings = { ...this._settings };
    setOutputScrollbackBehavior(this._settings.scrollbackBehavior);
    setOutputSplitRatio(this._settings.scrollbackSplitRatio);
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(this._settings.workspaceLayout, { initializing: true });
    panelManager.setPaneGridSnapEnabled(this._settings.paneGridSnapEnabled, { initializing: true });
    sendTerminalGeometry(false);
    this._applyActiveTheme();
  },

  get(key) {
    if (Object.prototype.hasOwnProperty.call(this._settings, key)) {
      return this._settings[key];
    }
    return this._defaults[key];
  },

  set(key, value) {
    this._applySettings({ [key]: value });
  },

  open() {
    this.close({ skipBackupPrompt: true });
    this._previousFocusEl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this._draftSettings = {
      ...this._settings,
      keyMappings: this._settings.keyMappings.map((mapping) => ({
        code: mapping.code || '',
        label: mapping.label || formatKeyCodeLabel(mapping.code || ''),
        legacyKey: mapping.legacyKey || '',
        command: mapping.command,
      })),
    };
    this._aliasScopeKey = aliasManager.getActiveScopeKey();
    this._draftAliasScope = aliasManager.getScopeSnapshot(this._aliasScopeKey);
    this._highlightScopeKey = highlightManager.getActiveScopeKey();
    this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);
    this._triggerScopeKey = triggerManager.getActiveScopeKey();
    this._draftTriggerScope = triggerManager.getScopeSnapshot(this._triggerScopeKey);
    this._settingsSessionBaseline = this._getCurrentSettingsSessionFingerprint();

    const overlay = this._buildModal();
    const modalKeyHandler = (event) => this._handleModalKeydown(event);

    document.addEventListener('keydown', modalKeyHandler, true);
    const dataSyncHandler = (event) => {
      const detail = event && event.detail ? event.detail : {};
      let refreshed = false;
      const isHighlightEvent = event && event.type === 'darkwind:highlight-data-changed';
      const isTriggerEvent = event && event.type === 'darkwind:trigger-data-changed';

      if (!this._overlay || !this._refreshEditors) return;
      if (isHighlightEvent && (!detail.scopeKey || detail.scopeKey === this._highlightScopeKey)) {
        this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);
        refreshed = true;
      }
      if (isTriggerEvent && (!detail.scopeKey || detail.scopeKey === this._triggerScopeKey)) {
        this._draftTriggerScope = triggerManager.getScopeSnapshot(this._triggerScopeKey);
        refreshed = true;
      }
      if (refreshed) this._refreshEditors();
    };
    window.addEventListener('darkwind:highlight-data-changed', dataSyncHandler);
    window.addEventListener('darkwind:trigger-data-changed', dataSyncHandler);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._escHandler = modalKeyHandler;
    this._modalKeyHandler = modalKeyHandler;
    this._dataSyncHandler = dataSyncHandler;
    this._focusSettingsControl('settings-tab-connection');
  },

  close(options = {}) {
    if (!options.skipBackupPrompt && this._shouldPromptForSettingsBackup()) {
      this._showSettingsBackupPrompt();
      return false;
    }

    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler, true);
      this._escHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    if (this._dataSyncHandler) {
      window.removeEventListener('darkwind:highlight-data-changed', this._dataSyncHandler);
      window.removeEventListener('darkwind:trigger-data-changed', this._dataSyncHandler);
      this._dataSyncHandler = null;
    }
    this._draftSettings = {};
    this._draftAliasScope = null;
    this._aliasScopeKey = '';
    this._draftHighlightScope = null;
    this._highlightScopeKey = '';
    this._draftTriggerScope = null;
    this._triggerScopeKey = '';
    this._refreshEditors = null;
    this._activateTab = null;
    this._pendingAliasSelection = null;
    this._footerStatusEl = null;
    this._modalKeyHandler = null;
    this._activeEditFocusScope = null;
    this._settingsSessionBaseline = '';
    this._backupClosePromptEl = null;
    const previous = this._previousFocusEl;
    this._previousFocusEl = null;
    if (previous && document.contains(previous)) {
      previous.focus();
    }
    return true;
  },

  _save() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this._settings));
    } catch (error) {
      console.warn('Failed to save client settings', error);
    }
  },

  _applySettings(nextSettings) {
    this._settings = this._normalizeSettings({
      ...this._settings,
      ...nextSettings,
    });
    state.settings = { ...this._settings };
    setOutputScrollbackBehavior(this._settings.scrollbackBehavior);
    setOutputSplitRatio(this._settings.scrollbackSplitRatio);
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(this._settings.workspaceLayout);
    panelManager.setPaneGridSnapEnabled(this._settings.paneGridSnapEnabled);
    sendTerminalGeometry(true);
    this._applyActiveTheme();
    this._save();
  },

  // --- Theming -------------------------------------------------------------

  _resolveTheme(key) {
    const custom = this._settings.customThemes && this._settings.customThemes[key];
    if (custom) return custom;
    return BUILTIN_THEMES[key] || BUILTIN_THEMES[DEFAULT_THEME_KEY];
  },

  _applyActiveTheme() {
    try {
      applyTheme(this._resolveTheme(this._settings.theme));
    } catch (error) {
      console.warn('Failed to apply theme', error);
    }
  },

  // Theme changes apply (and persist) immediately, independent of the modal's
  // save/cancel draft, since they are purely visual and low-risk.
  _setTheme(key) {
    this._settings.theme = key;
    if (this._draftSettings) this._draftSettings.theme = key;
    state.settings = { ...this._settings };
    this._applyActiveTheme();
    this._save();
  },

  _setFooterStatus(message, isError = false) {
    if (!this._footerStatusEl) return;
    this._footerStatusEl.textContent = message || '';
    this._footerStatusEl.classList.toggle('error', Boolean(message) && isError);
  },

  _getFocusableSettingsControls() {
    if (!this._overlay) return [];
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(this._overlay.querySelectorAll(selector))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        if (el.hidden) return false;
        if (el.tabIndex < 0) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.offsetParent === null && el !== document.activeElement) return false;
        return true;
      });
  },

  _focusSettingsControl(key) {
    if (!key) return;
    requestAnimationFrame(() => {
      if (!this._overlay) return;
      const escaped = window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape(key)
        : String(key).replace(/"/g, '\\"');
      const target = this._overlay.querySelector('[data-focus-key="' + escaped + '"]');
      if (target && target instanceof HTMLElement) {
        target.focus();
      }
    });
  },

  _focusSettingsTextControl(key, selectionStart, selectionEnd) {
    if (!key) return;
    requestAnimationFrame(() => {
      if (!this._overlay) return;
      const escaped = window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape(key)
        : String(key).replace(/"/g, '\\"');
      const target = this._overlay.querySelector('[data-focus-key="' + escaped + '"]');
      if (target && target instanceof HTMLElement) {
        target.focus();
        if (typeof target.setSelectionRange === 'function' &&
          typeof selectionStart === 'number') {
          target.setSelectionRange(selectionStart, selectionEnd || selectionStart);
        }
      }
    });
  },

  _handleModalKeydown(event) {
    if (!this._overlay) return;
    if (!this._overlay.contains(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
  },

  _getEditScopeName(target) {
    if (!(target instanceof HTMLElement)) return '';
    const scopeRoot = target.closest('[data-edit-focus-scope]');
    if (scopeRoot && scopeRoot instanceof HTMLElement) {
      return scopeRoot.dataset.editFocusScope || '';
    }
    if (target.dataset.focusKey === 'settings-save') {
      return this._activeEditFocusScope || '';
    }
    return '';
  },

  _getEditScopeControls(scopeName) {
    if (!this._overlay || !scopeName) return [];
    const escaped = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(scopeName)
      : String(scopeName).replace(/"/g, '\\"');
    const scopedRoots = Array.from(this._overlay.querySelectorAll('[data-edit-focus-scope="' + escaped + '"]'))
      .filter((el) => el instanceof HTMLElement);
    const scopedControls = [];

    scopedRoots.forEach((root) => {
      scopedControls.push(...Array.from(root.querySelectorAll([
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
      ].join(','))));
    });

    const save = this._overlay.querySelector('[data-focus-key="settings-save"]');
    if (save) scopedControls.push(save);

    return scopedControls
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        if (el.hidden) return false;
        if (el.tabIndex < 0) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.offsetParent === null && el !== document.activeElement) return false;
        return true;
      });
  },

  _handleEditScopeTab(event) {
    const scopeName = this._getEditScopeName(event.target);
    if (!scopeName) return false;

    const controls = this._getEditScopeControls(scopeName);
    if (!controls.length) return false;

    this._activeEditFocusScope = scopeName;
    const current = document.activeElement;
    let index = controls.indexOf(current);
    if (index < 0) index = event.shiftKey ? 0 : -1;
    const nextIndex = event.shiftKey
      ? (index <= 0 ? controls.length - 1 : index - 1)
      : (index >= controls.length - 1 ? 0 : index + 1);

    event.preventDefault();
    controls[nextIndex].focus();
    return true;
  },

  _applyDraftChanges(closeAfterApply = false) {
    this._syncDraftVariablesFromSteps();
    this._applySettings(this._draftSettings);
    triggerManager.saveScope(this._triggerScopeKey, this._draftTriggerScope);
    highlightManager.saveScope(this._highlightScopeKey, this._draftHighlightScope);
    aliasManager.saveScope(this._aliasScopeKey, this._draftAliasScope);
    this._setFooterStatus('Settings applied.');
    if (closeAfterApply) this.close();
  },

  _getCurrentSettingsSessionFingerprint() {
    const settings = this._draftSettings && Object.keys(this._draftSettings).length
      ? this._draftSettings
      : this._settings;
    const sessionState = {
      settings: this._normalizeSettings(settings),
      aliasScopeKey: this._aliasScopeKey,
      aliasScope: this._draftAliasScope,
      highlightScopeKey: this._highlightScopeKey,
      highlightScope: this._draftHighlightScope,
      triggerScopeKey: this._triggerScopeKey,
      triggerScope: this._draftTriggerScope,
      sound: soundManager.getSettings(),
    };
    return JSON.stringify(sessionState);
  },

  _shouldPromptForSettingsBackup() {
    if (!this._overlay || !this._settings.settingsBackupPromptEnabled) return false;
    if (!this._settingsSessionBaseline) return false;

    try {
      return this._getCurrentSettingsSessionFingerprint() !== this._settingsSessionBaseline;
    } catch (error) {
      return false;
    }
  },

  _dismissSettingsBackupPrompt() {
    if (this._backupClosePromptEl) {
      this._backupClosePromptEl.remove();
      this._backupClosePromptEl = null;
    }
  },

  _showSettingsBackupPrompt() {
    if (!this._overlay) return;
    if (this._backupClosePromptEl) {
      const primary = this._backupClosePromptEl.querySelector('[data-backup-action="download"]');
      if (primary instanceof HTMLElement) primary.focus();
      return;
    }

    const prompt = document.createElement('div');
    prompt.className = 'settings-backup-prompt';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const title = document.createElement('div');
    title.className = 'settings-label';
    title.textContent = 'Download a settings backup?';

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Your settings changed in this session. Save a JSON backup before closing.';

    copy.appendChild(title);
    copy.appendChild(description);

    const actions = document.createElement('div');
    actions.className = 'settings-backup-actions';

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'dw-button dw-button-secondary';
    continueBtn.textContent = 'Continue editing';
    continueBtn.addEventListener('click', () => this._dismissSettingsBackupPrompt());

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'dw-button dw-button-secondary';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => this.close({ skipBackupPrompt: true }));

    const neverBtn = document.createElement('button');
    neverBtn.type = 'button';
    neverBtn.className = 'dw-button dw-button-secondary';
    neverBtn.textContent = 'Never ask again';
    neverBtn.addEventListener('click', () => {
      this._draftSettings.settingsBackupPromptEnabled = false;
      this._applySettings({ settingsBackupPromptEnabled: false });
      this.close({ skipBackupPrompt: true });
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'dw-button dw-button-primary';
    downloadBtn.dataset.backupAction = 'download';
    downloadBtn.textContent = 'Download backup';
    downloadBtn.addEventListener('click', () => {
      this._downloadSettingsBundle();
      this.close({ skipBackupPrompt: true });
    });

    actions.appendChild(continueBtn);
    actions.appendChild(skipBtn);
    actions.appendChild(neverBtn);
    actions.appendChild(downloadBtn);
    prompt.appendChild(copy);
    prompt.appendChild(actions);

    const footer = this._overlay.querySelector('.settings-modal-footer');
    if (footer && footer.parentElement) {
      footer.parentElement.insertBefore(prompt, footer);
    } else {
      this._overlay.appendChild(prompt);
    }
    this._backupClosePromptEl = prompt;
    downloadBtn.focus();
  },

  _syncDraftVariablesFromSteps() {
    if (!this._draftAliasScope || !this._draftAliasScope.variables) return;
    const stepLists = [];
    if (Array.isArray(this._draftAliasScope.aliases)) {
      stepLists.push(...this._draftAliasScope.aliases.map((alias) => alias.steps || []));
    }
    if (this._draftTriggerScope && Array.isArray(this._draftTriggerScope.triggers)) {
      stepLists.push(...this._draftTriggerScope.triggers.map((trigger) => trigger.steps || []));
    }

    stepLists.forEach((steps) => {
      steps.forEach((step) => {
        const name = String(step && step.type === 'set_variable' ? step.name || '' : '').trim();
        if (name && !Object.prototype.hasOwnProperty.call(this._draftAliasScope.variables, name)) {
          this._draftAliasScope.variables[name] = '';
        }
      });
    });
  },

  _buildSettingsBundle() {
    this._syncDraftVariablesFromSteps();
    const aliasData = JSON.parse(JSON.stringify(aliasManager._data || { scopes: {} }));
    const highlightData = JSON.parse(JSON.stringify(highlightManager._data || { scopes: {} }));
    const triggerData = JSON.parse(JSON.stringify(triggerManager._data || { scopes: {} }));

    if (this._aliasScopeKey && this._draftAliasScope) {
      aliasData.scopes = aliasData.scopes || {};
      aliasData.scopes[this._aliasScopeKey] = JSON.parse(JSON.stringify(this._draftAliasScope));
    }
    if (this._highlightScopeKey && this._draftHighlightScope) {
      highlightData.scopes = highlightData.scopes || {};
      highlightData.scopes[this._highlightScopeKey] = JSON.parse(JSON.stringify(this._draftHighlightScope));
    }
    if (this._triggerScopeKey && this._draftTriggerScope) {
      triggerData.scopes = triggerData.scopes || {};
      triggerData.scopes[this._triggerScopeKey] = JSON.parse(JSON.stringify(this._draftTriggerScope));
    }

    return {
      format: 'darkwind-client-settings-export',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      clientVersion: state.clientVersion || 'unknown',
      data: {
        settings: this._normalizeSettings(this._draftSettings || this._settings),
        aliases: aliasData,
        highlights: highlightData,
        triggers: triggerData,
        panels: panelManager.exportState(),
        sound: soundManager.getSettings(),
      },
    };
  },

  _downloadSettingsBundle() {
    const bundle = this._buildSettingsBundle();
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = bundle.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
    link.href = url;
    link.download = 'darkflow-settings-' + timestamp + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this._setFooterStatus('Settings exported.');
  },

  _applyImportedBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'darkwind-client-settings-export') {
      throw new Error('That file is not a Darkflow settings export.');
    }
    if (!bundle.data || typeof bundle.data !== 'object') {
      throw new Error('That settings export is missing its data payload.');
    }

    const nextSettings = this._normalizeSettings(bundle.data.settings || this._defaults);
    this._settings = nextSettings;
    state.settings = { ...nextSettings };
    this._save();
    setOutputScrollbackBehavior(nextSettings.scrollbackBehavior);
    setOutputSplitRatio(nextSettings.scrollbackSplitRatio);
    setOutputScrollbackPreset(nextSettings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(nextSettings.workspaceLayout);
    panelManager.setPaneGridSnapEnabled(nextSettings.paneGridSnapEnabled);
    sendTerminalGeometry(true);
    this._applyActiveTheme();

    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(bundle.data.aliases || { scopes: {} }));
      localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(bundle.data.highlights || { scopes: {} }));
      localStorage.setItem(TRIGGER_STORAGE_KEY, JSON.stringify(bundle.data.triggers || { scopes: {} }));
      soundManager.importSettings(bundle.data.sound || {});
    } catch (error) {
      throw new Error('Unable to write imported client data to local storage.');
    }

    aliasManager.init();
    highlightManager.init();
    triggerManager.init();

    window.dispatchEvent(new CustomEvent('darkwind:alias-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:highlight-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:trigger-data-changed', { detail: {} }));

    panelManager.applyImportedState(bundle.data.panels || { docks: { left: false, right: false }, panels: {} });

    this.close();
    this.open();
    this._setFooterStatus('Settings imported.');
  },

  _promptImportSettingsBundle() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        this._applyImportedBundle(parsed);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import that settings file.';
        this._setFooterStatus(message, true);
      }
    });
    input.click();
  },

  _normalizeSettings(settings) {
    return {
      autoReconnect: settings.autoReconnect !== false,
      repeatLastCommand: settings.repeatLastCommand !== false,
      keyMapperEnabled: Boolean(settings.keyMapperEnabled),
      keyMappings: this._normalizeKeyMappings(settings.keyMappings),
      aliasTabCompletionEnabled: settings.aliasTabCompletionEnabled !== false,
      historyTabCompletionEnabled: Boolean(settings.historyTabCompletionEnabled),
      scrollbackBehavior: this._normalizeScrollbackBehavior(settings.scrollbackBehavior),
      scrollbackSplitRatio: this._normalizeSplitRatio(settings.scrollbackSplitRatio),
      outputScrollbackPreset: this._normalizeOutputScrollbackPreset(settings.outputScrollbackPreset),
      tabObservabilityEnabled: Boolean(settings.tabObservabilityEnabled),
      screenReaderMode: Boolean(settings.screenReaderMode),
      terminalWidthColumns: this._normalizeTerminalWidthColumns(settings.terminalWidthColumns),
      workspaceLayout: settings.workspaceLayout === 'floating' ? 'floating' : 'classic',
      paneGridSnapEnabled: Boolean(settings.paneGridSnapEnabled),
      settingsBackupPromptEnabled: settings.settingsBackupPromptEnabled !== false,
      theme: typeof settings.theme === 'string' && settings.theme ? settings.theme : DEFAULT_THEME_KEY,
      customThemes: (settings.customThemes && typeof settings.customThemes === 'object') ? settings.customThemes : {},
    };
  },

  _normalizeTerminalWidthColumns(value) {
    if (value === null || value === undefined || value === '') return null;

    const number = Number(value);
    if (!Number.isFinite(number)) return null;

    return Math.max(
      MIN_TERMINAL_WIDTH_COLUMNS,
      Math.min(MAX_TERMINAL_WIDTH_COLUMNS, Math.round(number))
    );
  },

  _syncScreenReaderServerSetting() {
    const command = 'set screenreader on';
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this._setFooterStatus('Connect before syncing the game screen reader setting.', true);
      return;
    }

    try {
      state.ws.send(command);
      closeOpenOutputLine();
      state.bytesSent += command.length;
      appendSystemMessage('Sent to game: ' + command);
      this._setFooterStatus('Game screen reader setting synced.');
    } catch (error) {
      this._setFooterStatus('Unable to sync the game screen reader setting.', true);
    }
  },

  _normalizeScrollbackBehavior(value) {
    return value === 'split' ? 'split' : 'pause';
  },

  _normalizeSplitRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return 0.6;
    return Math.max(0.2, Math.min(0.8, ratio));
  },

  _normalizeOutputScrollbackPreset(preset) {
    if (preset === 'low' || preset === 'high') return preset;
    return DEFAULT_OUTPUT_SCROLLBACK_PRESET;
  },

  _createSelectRow(labelText, descriptionText, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    const select = document.createElement('select');
    select.className = 'dw-select';
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === value) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener('change', () => onChange(select.value));

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(copy);
    row.appendChild(select);

    return row;
  },

  _themeOptionList() {
    const builtins = Object.values(BUILTIN_THEMES).map((t) => ({ value: t.key, label: t.label }));
    const customs = Object.entries(this._settings.customThemes || {}).map(([key, t]) => ({
      value: key,
      label: (t && t.label ? t.label : key) + ' (imported)',
    }));
    return [...builtins, ...customs];
  },

  _createThemeRow() {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';
    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Theme';
    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Recolor the terminal and interface. Import any VS Code theme (.json) to add your own. Applies immediately.';
    copy.appendChild(label);
    copy.appendChild(description);

    const controls = document.createElement('div');
    controls.className = 'settings-theme-controls';

    const select = document.createElement('select');
    select.className = 'dw-select';
    const rebuildOptions = () => {
      select.innerHTML = '';
      for (const opt of this._themeOptionList()) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        if (opt.value === this._settings.theme) el.selected = true;
        select.appendChild(el);
      }
    };
    rebuildOptions();
    select.addEventListener('change', () => this._setTheme(select.value));

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'dw-button';
    importBtn.textContent = 'Import theme…';
    importBtn.addEventListener('click', () => this._promptImportTheme(rebuildOptions));

    controls.appendChild(select);
    controls.appendChild(importBtn);
    row.appendChild(copy);
    row.appendChild(controls);
    return row;
  },

  _promptImportTheme(onAdded) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const theme = convertVsCodeTheme(json, {
          label: (json && json.name) || file.name.replace(/\.json$/i, ''),
        });
        let key = theme.key || 'imported';
        const base = key;
        let n = 2;
        while (BUILTIN_THEMES[key] || (this._settings.customThemes && this._settings.customThemes[key])) {
          key = base + '-' + n++;
        }
        theme.key = key;
        this._settings.customThemes = { ...(this._settings.customThemes || {}), [key]: theme };
        if (this._draftSettings) this._draftSettings.customThemes = this._settings.customThemes;
        this._setTheme(key);
        if (typeof onAdded === 'function') onAdded();
        this._setFooterStatus('Imported theme "' + theme.label + '".');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import that theme file.';
        this._setFooterStatus(message, true);
      }
    });
    input.click();
  },

  _createNumberRow(labelText, descriptionText, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('label');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'dw-input';
    input.value = value === null || value === undefined ? '' : String(value);
    input.placeholder = options.placeholder || '';
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step || 1);
    input.addEventListener('input', () => onChange(input.value));

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(copy);
    row.appendChild(input);

    return row;
  },

  _normalizeKeyMappings(mappings) {
    if (!Array.isArray(mappings)) return [];

    return mappings
      .map((mapping) => {
        if (!mapping || typeof mapping !== 'object') return null;
        const code = typeof mapping.code === 'string' ? mapping.code.trim() : '';
        const legacyKey = typeof mapping.key === 'string' ? mapping.key.trim() : '';
        const command = typeof mapping.command === 'string' ? mapping.command.trim() : '';
        const normalizedCode = code || normalizeLegacyKeyToCode(legacyKey);
        if (!normalizedCode || !command) return null;
        const label = typeof mapping.label === 'string' && mapping.label.trim()
          ? mapping.label.trim()
          : formatKeyCodeLabel(normalizedCode);
        return {
          code: normalizedCode,
          label,
          command,
          legacyKey: code ? '' : legacyKey,
        };
      })
      .filter(Boolean);
  },

  _createCheckboxRow(labelText, descriptionText, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'settings-checkbox-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(input);
    row.appendChild(copy);

    return row;
  },

  _createAudioSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-mapper-editor';
    const settings = soundManager.getSettings();

    wrapper.appendChild(this._createCheckboxRow(
      'Enable audio',
      'Allow game-triggered sound effects in this browser.',
      !!settings.enabled,
      (checked) => soundManager.setEnabled(checked)
    ));

    const volumeRow = document.createElement('div');
    volumeRow.className = 'settings-select-row';
    const copy = document.createElement('div');
    copy.className = 'settings-copy';
    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Master volume';
    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Controls the overall level for every audio category.';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(settings.volume * 100));
    slider.className = 'sound-settings-volume';
    slider.setAttribute('data-1p-ignore', 'true');
    slider.setAttribute('data-op-ignore', 'true');
    const value = document.createElement('span');
    value.className = 'settings-connection-value';
    value.textContent = slider.value + '%';
    slider.addEventListener('input', () => {
      value.textContent = slider.value + '%';
      soundManager.setVolume(Number(slider.value) / 100);
    });
    copy.appendChild(label);
    copy.appendChild(description);
    volumeRow.appendChild(copy);
    volumeRow.appendChild(slider);
    volumeRow.appendChild(value);
    wrapper.appendChild(volumeRow);

    const categories = document.createElement('div');
    categories.className = 'settings-sound-categories';
    for (const category of SOUND_CATEGORIES) {
      const info = SOUND_CATEGORY_INFO[category];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sound-widget-category';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', settings.categoryEnabled[category] ? 'true' : 'false');
      button.classList.toggle('enabled', !!settings.categoryEnabled[category]);
      button.classList.toggle('disabled', !settings.categoryEnabled[category]);
      button.innerHTML = '<span class="sound-widget-category-icon">' + info.icon + '</span>' +
        '<span class="sound-widget-category-label">' + info.label + '</span>';
      button.addEventListener('click', () => {
        soundManager.toggleCategory(category);
        const next = soundManager.getSettings().categoryEnabled[category];
        button.classList.toggle('enabled', !!next);
        button.classList.toggle('disabled', !next);
        button.setAttribute('aria-pressed', next ? 'true' : 'false');
      });
      categories.appendChild(button);
    }
    wrapper.appendChild(categories);

    return wrapper;
  },

  _createKeyMappingsEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-mapper-editor';
    wrapper.dataset.editFocusScope = 'key-mapping-editor';

    const helpText = document.createElement('p');
    helpText.className = 'dw-paragraph settings-helper-text';
    helpText.textContent = 'Press a key in the Key field to capture it. Top-row numbers and numpad numbers are treated as different keys.';

    const list = document.createElement('div');
    list.className = 'settings-mapping-list';

    const ensureMappings = () => {
      if (!Array.isArray(this._draftSettings.keyMappings)) {
        this._draftSettings.keyMappings = [];
      }
      return this._draftSettings.keyMappings;
    };

    const addRow = (mapping, focusNew) => {
      const mappings = ensureMappings();
      mappings.push(mapping);

      const row = document.createElement('div');
      row.className = 'settings-mapping-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'dw-input settings-key-input';
      keyInput.placeholder = 'Press a key';
      keyInput.readOnly = true;
      keyInput.value = mapping.label || formatKeyCodeLabel(mapping.code);
      keyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Backspace' || event.key === 'Delete') {
          mapping.code = '';
          mapping.label = '';
          mapping.legacyKey = '';
          keyInput.value = '';
          return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;

        mapping.code = event.code;
        mapping.label = formatKeyCodeLabel(event.code);
        mapping.legacyKey = '';
        keyInput.value = mapping.label;
      });

      const commandInput = document.createElement('input');
      commandInput.type = 'text';
      commandInput.className = 'dw-input settings-command-input';
      commandInput.placeholder = 'Command to send';
      commandInput.value = mapping.command;
      commandInput.addEventListener('input', () => {
        mapping.command = commandInput.value;
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const index = mappings.indexOf(mapping);
        if (index !== -1) mappings.splice(index, 1);
        row.remove();
        addBtn.focus();
      });

      row.appendChild(keyInput);
      row.appendChild(commandInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
      if (focusNew) requestAnimationFrame(() => keyInput.focus());
    };

    const savedMappings = ensureMappings().map((mapping) => ({
      code: mapping.code,
      label: mapping.label,
      legacyKey: mapping.legacyKey,
      command: mapping.command,
    }));
    this._draftSettings.keyMappings = [];
    savedMappings.forEach((mapping) => addRow(mapping));

    const actions = document.createElement('div');
    actions.className = 'settings-inline-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'dw-button dw-button-secondary settings-add-mapping';
    addBtn.type = 'button';
    addBtn.dataset.focusKey = 'key-mapping-add';
    addBtn.textContent = 'Add mapping';
    addBtn.addEventListener('click', () => addRow({ code: '', label: '', legacyKey: '', command: '' }, true));

    actions.appendChild(addBtn);
    wrapper.appendChild(helpText);
    wrapper.appendChild(list);
    wrapper.appendChild(actions);

    return wrapper;
  },

  _createColorSelect(value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-color-input-row';
    const input = document.createElement('input');
    const swatch = document.createElement('span');
    const datalistId = 'highlight-color-suggestions';
    let datalist = document.getElementById(datalistId);

    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = datalistId;
      highlightManager.getColorSuggestions().forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
      });
      document.body.appendChild(datalist);
    }

    const sync = () => {
      const normalized = highlightManager.normalizeColorToken(input.value);
      const cssColor = highlightManager.colorTokenToCss(input.value);
      input.classList.toggle('settings-input-invalid', Boolean(input.value.trim()) && !normalized);
      swatch.style.backgroundColor = cssColor || 'transparent';
      swatch.title = normalized || 'Invalid color';
      onChange(normalized || input.value.trim().toLowerCase());
    };

    input.type = 'text';
    input.className = 'dw-input';
    input.value = value || '';
    input.placeholder = 'yellow, bright-cyan, ansi-214, #38bdf8';
    input.setAttribute('list', datalistId);
    input.addEventListener('input', sync);
    input.addEventListener('blur', () => {
      const normalized = highlightManager.normalizeColorToken(input.value);
      if (normalized && input.value !== normalized) {
        input.value = normalized;
      }
      sync();
    });

    swatch.className = 'settings-color-swatch';
    wrapper.appendChild(input);
    wrapper.appendChild(swatch);
    sync();
    return wrapper;
  },

  _createHighlightEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-aliases-editor';

    const scopeCard = document.createElement('div');
    scopeCard.className = 'settings-connection-card';

    const scopeLabel = document.createElement('div');
    scopeLabel.className = 'settings-label';
    scopeLabel.textContent = 'Active highlight scope';

    const scopeValue = document.createElement('div');
    scopeValue.className = 'settings-connection-value';
    scopeValue.textContent = this._highlightScopeKey;

    const scopeHelp = document.createElement('p');
    scopeHelp.className = 'dw-paragraph';
    scopeHelp.textContent = 'Highlights are saved separately for each server connection target and apply to incoming terminal output.';

    scopeCard.appendChild(scopeLabel);
    scopeCard.appendChild(scopeValue);
    scopeCard.appendChild(scopeHelp);
    wrapper.appendChild(scopeCard);

    const layout = document.createElement('div');
    layout.className = 'settings-alias-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'settings-alias-sidebar';

    const editor = document.createElement('div');
    editor.className = 'settings-alias-detail';
    editor.dataset.editFocusScope = 'highlight-editor';

    const previewCard = document.createElement('div');
    previewCard.className = 'settings-mapper-editor settings-alias-preview-card';
    previewCard.dataset.editFocusScope = 'highlight-editor';

    let searchTerm = '';
    let sampleInput = 'You have emptied the keg!';
    let selectedRuleId = this._draftHighlightScope.rules[0] ? this._draftHighlightScope.rules[0].id : null;

    const ensureSelectedRule = () => {
      const rules = this._draftHighlightScope.rules;
      if (!rules.length) {
        selectedRuleId = null;
        return null;
      }
      const existing = rules.find((rule) => rule.id === selectedRuleId);
      if (existing) return existing;
      selectedRuleId = rules[0].id;
      return rules[0];
    };

    const createFieldLabel = (text) => {
      const label = document.createElement('div');
      label.className = 'settings-label';
      label.textContent = text;
      return label;
    };

    const previewBody = document.createElement('div');
    const sampleControl = document.createElement('textarea');
    sampleControl.className = 'dw-input settings-alias-template';
    sampleControl.value = sampleInput;
    sampleControl.addEventListener('input', () => {
      sampleInput = sampleControl.value;
      renderPreviewBody();
    });

    const renderPreviewBody = () => {
      previewBody.textContent = '';

      const previewLine = document.createElement('div');
      previewLine.className = 'settings-alias-preview-step';
      const fragments = highlightManager.applyHighlightsToText(sampleInput, this._draftHighlightScope.rules);
      fragments.forEach((fragment) => {
        const node = styleToElement(fragment.text, fragment.style || {});
        if (node) previewLine.appendChild(node);
      });
      previewBody.appendChild(previewLine);
    };

    const renderPreview = () => {
      previewCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Preview';
      previewCard.appendChild(title);

      const help = document.createElement('p');
      help.className = 'dw-paragraph settings-helper-text';
      help.textContent = 'Preview how the current rules will recolor matching terminal text.';
      previewCard.appendChild(help);

      const sampleField = document.createElement('label');
      sampleField.className = 'dw-field';
      sampleField.appendChild(createFieldLabel('Sample output'));
      sampleControl.value = sampleInput;
      sampleField.appendChild(sampleControl);
      previewCard.appendChild(sampleField);
      previewCard.appendChild(previewBody);
      renderPreviewBody();
    };

    const renderRuleDetail = () => {
      editor.textContent = '';
      const rule = ensureSelectedRule();
      if (!rule) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = 'Create a highlight rule to start coloring matched terminal output.';
        editor.appendChild(empty);
        return;
      }

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Highlight editor';
      editor.appendChild(title);

      const diagnostics = highlightManager.getRuleDiagnostics(this._draftHighlightScope, rule.id);
      if (diagnostics.length) {
        const warningBox = document.createElement('div');
        warningBox.className = 'settings-alias-diagnostics';
        diagnostics.forEach((message) => {
          const item = document.createElement('div');
          item.textContent = message;
          warningBox.appendChild(item);
        });
        editor.appendChild(warningBox);
      }

      const patternField = document.createElement('label');
      patternField.className = 'dw-field';
      patternField.appendChild(createFieldLabel('Regex pattern'));
      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.className = 'dw-input';
      patternInput.dataset.focusKey = 'highlight-pattern';
      patternInput.placeholder = 'You have emptied the keg!';
      patternInput.value = rule.patternSource;
      patternInput.addEventListener('input', () => {
        rule.patternSource = patternInput.value;
        renderHighlightList();
        renderPreview();
      });
      patternInput.addEventListener('blur', () => render());
      patternField.appendChild(patternInput);
      editor.appendChild(patternField);

      editor.appendChild(this._createCheckboxRow(
        'Highlight enabled',
        'Disabled highlight rules stay saved but never recolor output.',
        rule.enabled !== false,
        (checked) => {
          rule.enabled = checked;
          render();
        }
      ));

      editor.appendChild(this._createCheckboxRow(
        'Ignore letter casing',
        'Use regex ignore-case matching so pattern text matches regardless of capitalization.',
        rule.ignoreCase === true,
        (checked) => {
          rule.ignoreCase = checked;
          renderPreview();
        }
      ));

      const styleGrid = document.createElement('div');
      styleGrid.className = 'settings-highlight-style-grid';

      const fgField = document.createElement('label');
      fgField.className = 'dw-field';
      fgField.appendChild(createFieldLabel('Foreground'));
      fgField.appendChild(this._createColorSelect(rule.style.fg, (value) => {
        rule.style.fg = value;
        renderPreview();
      }));
      styleGrid.appendChild(fgField);

      const bgField = document.createElement('label');
      bgField.className = 'dw-field';
      bgField.appendChild(createFieldLabel('Background'));
      bgField.appendChild(this._createColorSelect(rule.style.bg, (value) => {
        rule.style.bg = value;
        renderPreview();
      }));
      styleGrid.appendChild(bgField);

      editor.appendChild(styleGrid);

      editor.appendChild(this._createCheckboxRow(
        'Bold matched text',
        'Force matched text to render bold in addition to the selected colors.',
        rule.style.bold === true,
        (checked) => {
          rule.style.bold = checked;
          renderPreview();
        }
      ));
    };

    const renderHighlightList = () => {
      const previousList = sidebar.querySelector('.settings-alias-list');
      const previousScrollTop = previousList ? previousList.scrollTop : 0;
      sidebar.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Highlight rules';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dw-input';
      search.dataset.focusKey = 'highlight-search';
      search.placeholder = 'Search highlights';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        const selectionStart = search.selectionStart;
        const selectionEnd = search.selectionEnd;
        searchTerm = search.value;
        render();
        this._focusSettingsTextControl('highlight-search', selectionStart, selectionEnd);
      });

      const list = document.createElement('div');
      list.className = 'settings-alias-list';

      const filteredRules = this._draftHighlightScope.rules.filter((rule) => (
        rule.patternSource.toLowerCase().includes(searchTerm.trim().toLowerCase())
      ));

      const focusRuleByOffset = (index, offset) => {
        if (!filteredRules.length) return;
        const nextIndex = Math.max(0, Math.min(filteredRules.length - 1, index + offset));
        selectedRuleId = filteredRules[nextIndex].id;
        render();
        this._focusSettingsControl('highlight-row-' + selectedRuleId);
      };

      filteredRules.forEach((rule, index) => {
        const selected = rule.id === selectedRuleId;
        const row = document.createElement('div');
        row.className = 'settings-alias-list-item' + (selected ? ' active' : '');

        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'settings-alias-list-select';
        rowBtn.dataset.focusKey = 'highlight-row-' + rule.id;
        rowBtn.tabIndex = selected ? 0 : -1;
        rowBtn.addEventListener('click', () => {
          selectedRuleId = rule.id;
          render();
        });
        rowBtn.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusRuleByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusRuleByOffset(index, -1);
          }
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rule.enabled !== false;
        checkbox.className = 'settings-alias-list-toggle';
        checkbox.dataset.focusKey = 'highlight-toggle-' + rule.id;
        checkbox.tabIndex = selected ? 0 : -1;
        checkbox.addEventListener('change', () => {
          rule.enabled = checkbox.checked;
          render();
          this._focusSettingsControl('highlight-toggle-' + rule.id);
        });
        checkbox.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusRuleByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusRuleByOffset(index, -1);
          }
        });

        const copy = document.createElement('div');
        copy.className = 'settings-copy';

        const pattern = document.createElement('div');
        pattern.className = 'settings-label';
        pattern.textContent = rule.patternSource || '(untitled)';

        const detail = document.createElement('div');
        detail.className = 'settings-alias-list-meta';
        detail.textContent = highlightManager.formatRuleStyle(rule) + (rule.ignoreCase ? ' | ignore case' : '');

        copy.appendChild(pattern);
        copy.appendChild(detail);
        rowBtn.appendChild(copy);
        row.appendChild(rowBtn);
        row.appendChild(checkbox);
        list.appendChild(row);
      });

      if (!filteredRules.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = searchTerm ? 'No highlight rules match this filter.' : 'No highlight rules defined for this scope.';
        list.appendChild(empty);
      }

      const addActions = document.createElement('div');
      addActions.className = 'settings-inline-actions';

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
      addBtn.textContent = 'Add rule';
      addBtn.addEventListener('click', () => {
        const rule = highlightManager.createEmptyRule();
        this._draftHighlightScope.rules.push(rule);
        selectedRuleId = rule.id;
        render();
        this._focusSettingsControl('highlight-pattern');
      });

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'dw-button dw-button-secondary';
      upBtn.textContent = 'Up';
      upBtn.disabled = !ensureSelectedRule() || this._draftHighlightScope.rules.findIndex((rule) => rule.id === selectedRuleId) <= 0;
      upBtn.addEventListener('click', () => {
        const index = this._draftHighlightScope.rules.findIndex((rule) => rule.id === selectedRuleId);
        if (index <= 0) return;
        const previous = this._draftHighlightScope.rules[index - 1];
        this._draftHighlightScope.rules[index - 1] = this._draftHighlightScope.rules[index];
        this._draftHighlightScope.rules[index] = previous;
        render();
        this._focusSettingsControl('highlight-row-' + selectedRuleId);
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'dw-button dw-button-secondary';
      downBtn.textContent = 'Down';
      downBtn.disabled = !ensureSelectedRule()
        || this._draftHighlightScope.rules.findIndex((rule) => rule.id === selectedRuleId) === this._draftHighlightScope.rules.length - 1;
      downBtn.addEventListener('click', () => {
        const index = this._draftHighlightScope.rules.findIndex((rule) => rule.id === selectedRuleId);
        if (index < 0 || index >= this._draftHighlightScope.rules.length - 1) return;
        const next = this._draftHighlightScope.rules[index + 1];
        this._draftHighlightScope.rules[index + 1] = this._draftHighlightScope.rules[index];
        this._draftHighlightScope.rules[index] = next;
        render();
        this._focusSettingsControl('highlight-row-' + selectedRuleId);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
      removeBtn.textContent = 'Remove selected';
      removeBtn.disabled = !ensureSelectedRule();
      removeBtn.addEventListener('click', () => {
        const rule = ensureSelectedRule();
        if (!rule) return;
        this._draftHighlightScope.rules = this._draftHighlightScope.rules.filter((item) => item.id !== rule.id);
        selectedRuleId = this._draftHighlightScope.rules[0] ? this._draftHighlightScope.rules[0].id : null;
        render();
        this._focusSettingsControl(selectedRuleId ? 'highlight-row-' + selectedRuleId : 'highlight-add');
      });

      addBtn.dataset.focusKey = 'highlight-add';
      addActions.appendChild(addBtn);
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);

      sidebar.appendChild(title);
      sidebar.appendChild(search);
      sidebar.appendChild(addActions);
      sidebar.appendChild(list);
      sidebar.appendChild(actions);
      list.scrollTop = previousScrollTop;
    };

    const render = () => {
      ensureSelectedRule();
      renderHighlightList();
      renderRuleDetail();
      renderPreview();
    };

    layout.appendChild(sidebar);
    layout.appendChild(editor);
    wrapper.appendChild(layout);
    wrapper.appendChild(previewCard);

    render();
    return wrapper;
  },

  _createVariablesEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-aliases-editor';

    const scopeCard = document.createElement('div');
    scopeCard.className = 'settings-connection-card';

    const scopeLabel = document.createElement('div');
    scopeLabel.className = 'settings-label';
    scopeLabel.textContent = 'Active alias scope';

    const scopeValue = document.createElement('div');
    scopeValue.className = 'settings-connection-value';
    scopeValue.textContent = this._aliasScopeKey;

    const scopeHelp = document.createElement('p');
    scopeHelp.className = 'dw-paragraph';
    scopeHelp.textContent = 'Variables are saved with aliases for each server connection target.';

    scopeCard.appendChild(scopeLabel);
    scopeCard.appendChild(scopeValue);
    scopeCard.appendChild(scopeHelp);
    wrapper.appendChild(scopeCard);

    const variableCard = document.createElement('div');
    variableCard.className = 'settings-mapper-editor settings-alias-variable-card';
    variableCard.dataset.editFocusScope = 'variables-editor';
    wrapper.appendChild(variableCard);

    const render = () => {
      this._syncDraftVariablesFromSteps();
      variableCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Variables';

      const help = document.createElement('p');
      help.className = 'dw-paragraph settings-helper-text';
      help.textContent = 'Persistent variables back aliases like $pack. Aliases can also write to them with Set variable steps.';

      variableCard.appendChild(title);
      variableCard.appendChild(help);

      const usageDetails = aliasManager.collectAliasUsageDetails(this._draftAliasScope);
      const entries = Object.entries(this._draftAliasScope.variables).sort((a, b) => a[0].localeCompare(b[0]));

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
      addBtn.dataset.focusKey = 'variable-add';
      addBtn.textContent = 'Add variable';
      addBtn.addEventListener('click', () => {
        let index = 1;
        let nextName = 'var' + index;
        while (Object.prototype.hasOwnProperty.call(this._draftAliasScope.variables, nextName)) {
          index++;
          nextName = 'var' + index;
        }
        this._draftAliasScope.variables[nextName] = '';
        render();
        this._focusSettingsControl('variable-name-' + nextName);
      });

      actions.appendChild(addBtn);

      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty settings-alias-variable-empty';

        const emptyText = document.createElement('div');
        emptyText.textContent = 'No variables yet. Add one here, or open Aliases and write a Set variable step.';

        const openAliasesBtn = document.createElement('button');
        openAliasesBtn.type = 'button';
        openAliasesBtn.className = 'dw-button dw-button-secondary';
        openAliasesBtn.textContent = 'Open Aliases';
        openAliasesBtn.addEventListener('click', () => {
          if (this._activateTab) this._activateTab('aliases');
          this._focusSettingsControl('alias-search');
        });

        empty.appendChild(emptyText);
        empty.appendChild(openAliasesBtn);
        variableCard.appendChild(empty);
        variableCard.appendChild(actions);
        return;
      }

      const list = document.createElement('div');
      list.className = 'settings-alias-variable-list';

      const addVariableRow = (name, value) => {
        let currentName = name;
        let expanded = false;
        const rowWrap = document.createElement('div');
        rowWrap.className = 'settings-alias-variable-row-wrap';

        const row = document.createElement('div');
        row.className = 'settings-alias-variable-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dw-input';
        nameInput.dataset.focusKey = 'variable-name-' + name;
        nameInput.placeholder = 'pack';
        nameInput.value = name;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'dw-input';
        valueInput.placeholder = 'mule';
        valueInput.value = value;

        const usageButton = document.createElement('button');
        usageButton.type = 'button';
        usageButton.className = 'dw-button dw-button-secondary settings-alias-usage-btn';
        const references = usageDetails.get(name) || [];
        usageButton.textContent = references.length + ' reference' + (references.length === 1 ? '' : 's');
        usageButton.disabled = !references.length;

        const usageList = document.createElement('div');
        usageList.className = 'settings-alias-usage-list';

        const renderUsageList = () => {
          usageList.textContent = '';
          if (!expanded || !references.length) return;
          references.forEach((alias) => {
            const aliasBtn = document.createElement('button');
            aliasBtn.type = 'button';
            aliasBtn.className = 'settings-alias-usage-item';
            aliasBtn.textContent = alias.trigger + (alias.description ? ' - ' + alias.description : '');
            aliasBtn.addEventListener('click', () => {
              this._pendingAliasSelection = alias.id;
              if (this._activateTab) this._activateTab('aliases');
              this._focusSettingsControl('alias-row-' + alias.id);
            });
            usageList.appendChild(aliasBtn);
          });
        };

        usageButton.addEventListener('click', () => {
          expanded = !expanded;
          renderUsageList();
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          delete this._draftAliasScope.variables[currentName];
          render();
          this._focusSettingsControl('variable-add');
        });

        const sync = () => {
          const normalizedName = nameInput.value.trim();
          if (normalizedName !== currentName) {
            delete this._draftAliasScope.variables[currentName];
            currentName = normalizedName;
          }
          if (!normalizedName) return;
          this._draftAliasScope.variables[normalizedName] = valueInput.value;
        };

        nameInput.addEventListener('input', sync);
        valueInput.addEventListener('input', sync);

        row.appendChild(nameInput);
        row.appendChild(valueInput);
        row.appendChild(usageButton);
        row.appendChild(removeBtn);
        rowWrap.appendChild(row);
        rowWrap.appendChild(usageList);
        list.appendChild(rowWrap);
      };

      entries.forEach(([name, value]) => addVariableRow(name, value));
      variableCard.appendChild(list);
      variableCard.appendChild(actions);
    };

    render();
    return wrapper;
  },

  _createAliasEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-aliases-editor';

    const scopeCard = document.createElement('div');
    scopeCard.className = 'settings-connection-card';

    const scopeLabel = document.createElement('div');
    scopeLabel.className = 'settings-label';
    scopeLabel.textContent = 'Active alias scope';

    const scopeValue = document.createElement('div');
    scopeValue.className = 'settings-connection-value';
    scopeValue.textContent = this._aliasScopeKey;

    const scopeHelp = document.createElement('p');
    scopeHelp.className = 'dw-paragraph';
    scopeHelp.textContent = 'Aliases and variables are saved separately for each server connection target.';

    scopeCard.appendChild(scopeLabel);
    scopeCard.appendChild(scopeValue);
    scopeCard.appendChild(scopeHelp);
    wrapper.appendChild(scopeCard);

    const layout = document.createElement('div');
    layout.className = 'settings-alias-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'settings-alias-sidebar';

    const editor = document.createElement('div');
    editor.className = 'settings-alias-detail';
    editor.dataset.editFocusScope = 'alias-editor';

    const previewCard = document.createElement('div');
    previewCard.className = 'settings-mapper-editor settings-alias-preview-card';
    previewCard.dataset.editFocusScope = 'alias-editor';

    let selectedAliasId = this._pendingAliasSelection || (this._draftAliasScope.aliases[0] ? this._draftAliasScope.aliases[0].id : null);
    this._pendingAliasSelection = null;
    let searchTerm = '';
    let sampleInput = '';

    const ensureSelectedAlias = () => {
      const aliases = this._draftAliasScope.aliases;
      if (!aliases.length) {
        selectedAliasId = null;
        return null;
      }
      const existing = aliases.find((alias) => alias.id === selectedAliasId);
      if (existing) return existing;
      selectedAliasId = aliases[0].id;
      return aliases[0];
    };

    const createFieldLabel = (text) => {
      const label = document.createElement('div');
      label.className = 'settings-label';
      label.textContent = text;
      return label;
    };

    const aliasPreviewBody = document.createElement('div');

    const sampleInputEl = document.createElement('input');
    sampleInputEl.type = 'text';
    sampleInputEl.className = 'dw-input';
    sampleInputEl.placeholder = 'Example: gi sword';
    sampleInputEl.value = sampleInput;
    sampleInputEl.addEventListener('input', () => {
      sampleInput = sampleInputEl.value;
      renderPreviewBody();
    });

    const renderPreviewBody = () => {
      aliasPreviewBody.textContent = '';
      if (!sampleInput.trim()) return;

      const match = aliasManager.matchAliasInAliases(sampleInput, this._draftAliasScope.aliases);
      const body = document.createElement('div');
      body.className = 'settings-alias-preview-results';

      if (!match) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = 'No enabled alias matches this input.';
        body.appendChild(empty);
        aliasPreviewBody.appendChild(body);
        return;
      }

      const matchLabel = document.createElement('div');
      matchLabel.className = 'settings-alias-preview-match';
      matchLabel.textContent = 'Matches: ' + match.alias.trigger;
      body.appendChild(matchLabel);

      const previewVariables = { ...this._draftAliasScope.variables };
      const previewTriggers = this._draftTriggerScope.triggers.map((trigger) => ({ ...trigger }));

      for (const step of match.alias.steps) {
        const row = document.createElement('div');
        row.className = 'settings-alias-preview-step';
        const resolved = aliasManager.resolveTemplate(
          step.type === 'set_trigger_enabled' ? step.target : step.template,
          {
            args: match.args,
            remainder: match.remainder,
            variables: previewVariables,
          }
        );

        if (step.type === 'set_trigger_enabled') {
          const target = resolved.text.trim();
          const mode = normalizeAutomationMode(step.mode);
          const trigger = previewTriggers.find((item) => item.pattern === target);
          row.textContent = getAutomationStepLabel(step) + ': ' + target;
          if (resolved.missingVariables.length) {
            row.classList.add('warning');
            row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
          } else if (resolved.errors.length) {
            row.classList.add('warning');
            row.textContent += ' (' + resolved.errors.join(' ') + ')';
          } else if (!target || !trigger) {
            row.classList.add('warning');
            row.textContent += target ? ' (trigger not found)' : ' (empty target)';
          } else {
            trigger.enabled = mode === 'toggle' ? trigger.enabled === false : mode === 'enable';
            row.textContent += ' -> ' + (trigger.enabled === false ? 'disabled' : 'enabled');
          }
          body.appendChild(row);
          continue;
        }

        let prefix = 'Send';
        if (step.type === 'set_variable') prefix = 'Set $' + step.name;
        if (step.type === 'show_message') prefix = 'Show';

        row.textContent = prefix + ': ' + resolved.text;
        if (resolved.missingVariables.length) {
          row.classList.add('warning');
          row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
        } else if (resolved.errors.length) {
          row.classList.add('warning');
          row.textContent += ' (' + resolved.errors.join(' ') + ')';
        } else if (step.type === 'set_variable' && step.name) {
          previewVariables[step.name] = resolved.text;
        }
        body.appendChild(row);
      }

      aliasPreviewBody.appendChild(body);
    };

    const renderPreview = () => {
      previewCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Live preview';

      const help = document.createElement('p');
      help.className = 'dw-paragraph settings-helper-text';
      help.textContent = 'Try an input line to see which alias matches and what it will do with the current variables.';

      sampleInputEl.value = sampleInput;
      previewCard.appendChild(title);
      previewCard.appendChild(help);
      previewCard.appendChild(sampleInputEl);
      previewCard.appendChild(aliasPreviewBody);
      renderPreviewBody();
    };

    const renderAliasDetail = () => {
      editor.textContent = '';
      const alias = ensureSelectedAlias();
      if (!alias) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = 'Create an alias to start building client-side command shortcuts.';
        editor.appendChild(empty);
        return;
      }

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Alias editor';
      editor.appendChild(title);

      const diagnostics = aliasManager.getAliasDiagnostics(this._draftAliasScope, alias.id);
      if (diagnostics.length) {
        const warningBox = document.createElement('div');
        warningBox.className = 'settings-alias-diagnostics';
        diagnostics.forEach((message) => {
          const item = document.createElement('div');
          item.textContent = message;
          warningBox.appendChild(item);
        });
        editor.appendChild(warningBox);
      }

      const triggerField = document.createElement('label');
      triggerField.className = 'dw-field';
      triggerField.appendChild(createFieldLabel('Trigger'));
      const triggerInput = document.createElement('input');
      triggerInput.type = 'text';
      triggerInput.className = 'dw-input';
      triggerInput.dataset.focusKey = 'alias-trigger';
      triggerInput.placeholder = alias.isRegex ? '^gi\\s+(.+)$' : 'gi';
      triggerInput.value = alias.trigger;
      triggerInput.addEventListener('input', () => {
        alias.trigger = triggerInput.value;
        renderAliasList();
        renderPreview();
      });
      triggerInput.addEventListener('blur', () => {
        render();
      });
      triggerField.appendChild(triggerInput);
      editor.appendChild(triggerField);

      editor.appendChild(this._createCheckboxRow(
        'Use regex',
        'Treat this alias trigger as a JavaScript regular expression. Capturing groups become %1, %2, and so on.',
        alias.isRegex === true,
        (checked) => {
          alias.isRegex = checked;
          render();
        }
      ));

      if (alias.isRegex) {
        editor.appendChild(this._createCheckboxRow(
          'Ignore case',
          'Match this regex alias without caring about capitalization.',
          alias.ignoreCase !== false,
          (checked) => {
            alias.ignoreCase = checked;
            render();
          }
        ));
      }

      const descriptionField = document.createElement('label');
      descriptionField.className = 'dw-field';
      descriptionField.appendChild(createFieldLabel('Description'));
      const descriptionInput = document.createElement('input');
      descriptionInput.type = 'text';
      descriptionInput.className = 'dw-input';
      descriptionInput.placeholder = 'Give an item to the pack animal';
      descriptionInput.value = alias.description;
      descriptionInput.addEventListener('input', () => {
        alias.description = descriptionInput.value;
        renderAliasList();
      });
      descriptionField.appendChild(descriptionInput);
      editor.appendChild(descriptionField);

      const groupField = document.createElement('label');
      groupField.className = 'dw-field';
      groupField.appendChild(createFieldLabel('Group / folder'));
      const groupInput = document.createElement('input');
      groupInput.type = 'text';
      groupInput.className = 'dw-input';
      groupInput.placeholder = 'Travel, Combat, Utility';
      groupInput.value = alias.group || '';
      groupInput.addEventListener('input', () => {
        alias.group = groupInput.value;
        renderAliasList();
      });
      groupField.appendChild(groupInput);
      editor.appendChild(groupField);

      const enabledRow = this._createCheckboxRow(
        'Alias enabled',
        'Disabled aliases stay saved but never match or expand.',
        alias.enabled !== false,
        (checked) => {
          alias.enabled = checked;
          render();
        }
      );
      editor.appendChild(enabledRow);

      const stepsTitle = createFieldLabel('Steps');
      editor.appendChild(stepsTitle);

      const stepList = document.createElement('div');
      stepList.className = 'settings-alias-step-list';

      const stepTypeOptions = [
        { value: 'send_command', type: 'send_command', label: 'Send command' },
        { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
        { value: 'show_message', type: 'show_message', label: 'Show local message' },
        { value: 'set_trigger_enabled:toggle', type: 'set_trigger_enabled', mode: 'toggle', label: 'Toggle trigger' },
        { value: 'set_trigger_enabled:enable', type: 'set_trigger_enabled', mode: 'enable', label: 'Enable trigger' },
        { value: 'set_trigger_enabled:disable', type: 'set_trigger_enabled', mode: 'disable', label: 'Disable trigger' },
      ];
      const getAliasStepOptionValue = (step) => (
        step.type === 'set_trigger_enabled'
          ? 'set_trigger_enabled:' + normalizeAutomationMode(step.mode)
          : step.type
      );

      alias.steps.forEach((step, index) => {
        const stepCard = document.createElement('div');
        stepCard.className = 'settings-alias-step-card';

        const stepHeader = document.createElement('div');
        stepHeader.className = 'settings-alias-step-header';

        const stepSelect = document.createElement('select');
        stepSelect.className = 'dw-select';
        stepSelect.dataset.focusKey = 'alias-step-' + index + '-type';
        stepTypeOptions.forEach((option) => {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          if (getAliasStepOptionValue(step) === option.value) el.selected = true;
          stepSelect.appendChild(el);
        });
        stepSelect.addEventListener('change', () => {
          const selectedOption = stepTypeOptions.find((option) => option.value === stepSelect.value) || stepTypeOptions[0];
          step.type = selectedOption.type;
          if (selectedOption.mode) step.mode = selectedOption.mode;
          else delete step.mode;
          if (step.type !== 'set_variable') delete step.name;
          if (step.type !== 'set_trigger_enabled') delete step.target;
          if (step.type === 'set_trigger_enabled' && !step.target) step.target = '';
          if (!step.template) step.template = '';
          render();
        });

        const controls = document.createElement('div');
        controls.className = 'settings-alias-step-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'dw-button dw-button-secondary';
        upBtn.textContent = 'Up';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          const previous = alias.steps[index - 1];
          alias.steps[index - 1] = step;
          alias.steps[index] = previous;
          render();
          this._focusSettingsControl('alias-step-' + (index - 1) + '-type');
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'dw-button dw-button-secondary';
        downBtn.textContent = 'Down';
        downBtn.disabled = index === alias.steps.length - 1;
        downBtn.addEventListener('click', () => {
          const next = alias.steps[index + 1];
          alias.steps[index + 1] = step;
          alias.steps[index] = next;
          render();
          this._focusSettingsControl('alias-step-' + (index + 1) + '-type');
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          alias.steps.splice(index, 1);
          if (!alias.steps.length) alias.steps.push({ type: 'send_command', template: '' });
          render();
          this._focusSettingsControl('alias-step-' + Math.min(index, alias.steps.length - 1) + '-type');
        });

        stepHeader.appendChild(stepSelect);
        stepCard.appendChild(stepHeader);

        if (step.type === 'set_variable') {
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.className = 'dw-input';
          nameInput.placeholder = 'pack';
          nameInput.value = step.name || '';
          nameInput.addEventListener('input', () => {
            step.name = nameInput.value;
          });
          stepCard.appendChild(nameInput);
        }

        if (step.type === 'set_trigger_enabled') {
          const targetInput = document.createElement('input');
          const listId = 'alias-trigger-targets-' + index;
          const targetList = document.createElement('datalist');
          targetInput.type = 'text';
          targetInput.className = 'dw-input';
          targetInput.placeholder = 'Exact trigger pattern';
          targetInput.setAttribute('list', listId);
          targetInput.value = step.target || '';
          targetList.id = listId;
          this._draftTriggerScope.triggers.forEach((trigger) => {
            const option = document.createElement('option');
            option.value = trigger.pattern;
            targetList.appendChild(option);
          });
          targetInput.addEventListener('input', () => {
            step.target = targetInput.value;
          });
          stepCard.appendChild(targetInput);
          stepCard.appendChild(targetList);
        } else {
          const templateInput = document.createElement('textarea');
          templateInput.className = 'dw-input settings-alias-template';
          templateInput.placeholder = step.type === 'show_message'
            ? 'Pack animal set to: $pack'
            : step.type === 'set_variable'
              ? '%0'
              : 'give %0 to $pack';
          templateInput.value = step.template || '';
          templateInput.addEventListener('input', () => {
            step.template = templateInput.value;
          });
          stepCard.appendChild(templateInput);
        }
        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
        controls.appendChild(removeBtn);
        stepCard.appendChild(controls);

        const helper = document.createElement('div');
        helper.className = 'settings-helper-text';
        helper.textContent = step.type === 'set_trigger_enabled'
          ? 'Target may be an exact trigger pattern or a template that resolves to one.'
          : 'Simple aliases match command words. Regex aliases use JavaScript regular expressions, with capture groups available as %1-%9. Templates support %0 for the full remainder or regex match, $name variables, and ${lower:%1} or ${lower:$name} for lowercase.';
        stepCard.appendChild(helper);

        stepList.appendChild(stepCard);
      });

      editor.appendChild(stepList);

      const stepAddActions = document.createElement('div');
      stepAddActions.className = 'settings-inline-actions';
      stepTypeOptions.forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dw-button dw-button-secondary';
        btn.dataset.focusKey = 'alias-step-add-' + option.value;
        btn.textContent = option.label;
        btn.addEventListener('click', () => {
          const step = { type: option.type, template: '' };
          if (option.mode) step.mode = option.mode;
          if (option.type === 'set_variable') step.name = '';
          if (option.type === 'set_trigger_enabled') step.target = '';
          alias.steps.push(step);
          render();
          this._focusSettingsControl('alias-step-' + (alias.steps.length - 1) + '-type');
        });
        stepAddActions.appendChild(btn);
      });
      editor.appendChild(stepAddActions);
    };

    const renderAliasList = () => {
      const previousList = sidebar.querySelector('.settings-alias-list');
      const previousScrollTop = previousList ? previousList.scrollTop : 0;
      sidebar.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Aliases';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dw-input';
      search.dataset.focusKey = 'alias-search';
      search.placeholder = 'Search aliases';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        const selectionStart = search.selectionStart;
        const selectionEnd = search.selectionEnd;
        searchTerm = search.value;
        render();
        this._focusSettingsTextControl('alias-search', selectionStart, selectionEnd);
      });

      const list = document.createElement('div');
      list.className = 'settings-alias-list';

      const filteredAliases = this._draftAliasScope.aliases
        .map((alias, index) => ({ alias, index }))
        .filter((entry) => {
          const alias = entry.alias;
          const haystack = (alias.trigger + ' ' + alias.description + ' ' + (alias.group || '')).toLowerCase();
          return haystack.includes(searchTerm.trim().toLowerCase());
        })
        .sort((a, b) => {
          const groupA = (a.alias.group || '').trim() || 'Ungrouped';
          const groupB = (b.alias.group || '').trim() || 'Ungrouped';
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.index - b.index;
        })
        .map((entry) => entry.alias);

      let lastGroup = null;
      const focusAliasByOffset = (index, offset) => {
        if (!filteredAliases.length) return;
        const nextIndex = Math.max(0, Math.min(filteredAliases.length - 1, index + offset));
        selectedAliasId = filteredAliases[nextIndex].id;
        render();
        this._focusSettingsControl('alias-row-' + selectedAliasId);
      };

      filteredAliases.forEach((alias, index) => {
        const group = (alias.group || '').trim() || 'Ungrouped';
        if (group !== lastGroup) {
          const groupHeader = document.createElement('div');
          groupHeader.className = 'settings-alias-group-header';
          groupHeader.textContent = group;
          list.appendChild(groupHeader);
          lastGroup = group;
        }

        const selected = alias.id === selectedAliasId;
        const row = document.createElement('div');
        row.className = 'settings-alias-list-item' + (selected ? ' active' : '');

        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'settings-alias-list-select';
        rowBtn.dataset.focusKey = 'alias-row-' + alias.id;
        rowBtn.tabIndex = selected ? 0 : -1;
        rowBtn.addEventListener('click', () => {
          selectedAliasId = alias.id;
          render();
        });
        rowBtn.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusAliasByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusAliasByOffset(index, -1);
          }
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = alias.enabled !== false;
        checkbox.className = 'settings-alias-list-toggle';
        checkbox.dataset.focusKey = 'alias-toggle-' + alias.id;
        checkbox.tabIndex = selected ? 0 : -1;
        checkbox.addEventListener('change', () => {
          alias.enabled = checkbox.checked;
          render();
          this._focusSettingsControl('alias-toggle-' + alias.id);
        });
        checkbox.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusAliasByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusAliasByOffset(index, -1);
          }
        });

        const copy = document.createElement('div');
        copy.className = 'settings-copy';

        const trigger = document.createElement('div');
        trigger.className = 'settings-label';
        trigger.textContent = alias.trigger || '(untitled)';

        const description = document.createElement('div');
        description.className = 'settings-alias-list-meta';
        description.textContent = alias.description
          || (alias.isRegex ? 'regex, ' : '') + alias.steps.length + ' step' + (alias.steps.length === 1 ? '' : 's');

        copy.appendChild(trigger);
        copy.appendChild(description);
        rowBtn.appendChild(copy);
        row.appendChild(rowBtn);
        row.appendChild(checkbox);
        list.appendChild(row);
      });

      if (!filteredAliases.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = searchTerm ? 'No aliases match this filter.' : 'No aliases defined for this scope.';
        list.appendChild(empty);
      }

      const addActions = document.createElement('div');
      addActions.className = 'settings-inline-actions';

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
      addBtn.textContent = 'Add alias';
      addBtn.addEventListener('click', () => {
        const alias = aliasManager.createEmptyAlias();
        this._draftAliasScope.aliases.push(alias);
        selectedAliasId = alias.id;
        render();
        this._focusSettingsControl('alias-trigger');
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
      removeBtn.textContent = 'Remove selected';
      removeBtn.disabled = !ensureSelectedAlias();
      removeBtn.addEventListener('click', () => {
        const alias = ensureSelectedAlias();
        if (!alias) return;
        this._draftAliasScope.aliases = this._draftAliasScope.aliases.filter((item) => item.id !== alias.id);
        selectedAliasId = this._draftAliasScope.aliases[0] ? this._draftAliasScope.aliases[0].id : null;
        render();
        this._focusSettingsControl(selectedAliasId ? 'alias-row-' + selectedAliasId : 'alias-add');
      });

      addBtn.dataset.focusKey = 'alias-add';
      addActions.appendChild(addBtn);
      actions.appendChild(removeBtn);
      sidebar.appendChild(title);
      sidebar.appendChild(search);
      sidebar.appendChild(addActions);
      sidebar.appendChild(list);
      sidebar.appendChild(actions);
      list.scrollTop = previousScrollTop;
    };

    const render = () => {
      ensureSelectedAlias();
      renderAliasList();
      renderAliasDetail();
      renderPreview();
    };

    layout.appendChild(sidebar);
    layout.appendChild(editor);
    wrapper.appendChild(layout);
    wrapper.appendChild(previewCard);

    render();
    return wrapper;
  },

  _createTriggerEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-aliases-editor';

    const scopeCard = document.createElement('div');
    scopeCard.className = 'settings-connection-card';

    const scopeLabel = document.createElement('div');
    scopeLabel.className = 'settings-label';
    scopeLabel.textContent = 'Active trigger scope';

    const scopeValue = document.createElement('div');
    scopeValue.className = 'settings-connection-value';
    scopeValue.textContent = this._triggerScopeKey;

    const scopeHelp = document.createElement('p');
    scopeHelp.className = 'dw-paragraph';
    scopeHelp.textContent = 'Triggers are saved separately for each server connection target and react to incoming output lines.';

    scopeCard.appendChild(scopeLabel);
    scopeCard.appendChild(scopeValue);
    scopeCard.appendChild(scopeHelp);
    wrapper.appendChild(scopeCard);

    const layout = document.createElement('div');
    layout.className = 'settings-alias-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'settings-alias-sidebar';

    const editor = document.createElement('div');
    editor.className = 'settings-alias-detail';
    editor.dataset.editFocusScope = 'trigger-editor';

    const previewCard = document.createElement('div');
    previewCard.className = 'settings-mapper-editor settings-alias-preview-card';
    previewCard.dataset.editFocusScope = 'trigger-editor';

    let selectedTriggerId = this._draftTriggerScope.triggers[0] ? this._draftTriggerScope.triggers[0].id : null;
    let searchTerm = '';
    let sampleInput = '';

    const ensureSelectedTrigger = () => {
      const triggers = this._draftTriggerScope.triggers;
      if (!triggers.length) {
        selectedTriggerId = null;
        return null;
      }
      const existing = triggers.find((trigger) => trigger.id === selectedTriggerId);
      if (existing) return existing;
      selectedTriggerId = triggers[0].id;
      return triggers[0];
    };

    const createFieldLabel = (text) => {
      const label = document.createElement('div');
      label.className = 'settings-label';
      label.textContent = text;
      return label;
    };

    const previewBody = document.createElement('div');
    const soundCatalog = getSoundCatalog();
    const soundCategories = SOUND_CATEGORIES.filter((category) => (
      soundCatalog.some((sound) => sound.category === category)
    ));
    const firstSound = soundCatalog[0] || { category: 'alert', sound: 'warning' };
    const soundLabel = (category, sound) => {
      const match = soundCatalog.find((item) => item.category === category && item.sound === sound);
      if (match) return match.label;
      return [category, sound].filter(Boolean).join(' / ') || 'No sound selected';
    };
    const soundsForCategory = (category) => soundCatalog.filter((item) => item.category === category);
    const ensureSoundStep = (step) => {
      if (!step.category || !soundsForCategory(step.category).length) step.category = firstSound.category;
      if (!step.sound || !isKnownSound(step.category, step.sound)) {
        const sounds = soundsForCategory(step.category);
        step.sound = sounds[0] ? sounds[0].sound : firstSound.sound;
      }
      if (!Number.isFinite(Number(step.volume))) step.volume = 1;
      step.volume = Math.max(0, Math.min(1, Number(step.volume)));
    };

    const sampleInputEl = document.createElement('textarea');
    sampleInputEl.className = 'dw-input settings-alias-template';
    sampleInputEl.placeholder = 'Example incoming line';
    sampleInputEl.value = sampleInput;
    sampleInputEl.addEventListener('input', () => {
      sampleInput = sampleInputEl.value;
      renderPreviewBody();
    });

    const renderPreviewBody = () => {
      previewBody.textContent = '';
      if (!sampleInput.trim()) return;

      const result = triggerManager.evaluateLine(sampleInput, this._triggerScopeKey, this._draftTriggerScope);
      const body = document.createElement('div');
      body.className = 'settings-alias-preview-results';

      if (!result.matches.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = 'No enabled trigger matches this output.';
        body.appendChild(empty);
        previewBody.appendChild(body);
        return;
      }

      const previewVariables = { ...this._draftAliasScope.variables };
      const previewAliases = this._draftAliasScope.aliases.map((alias) => ({
        ...alias,
        steps: alias.steps.map((step) => ({ ...step })),
      }));

      result.matches.forEach((match) => {
        const matchLabel = document.createElement('div');
        matchLabel.className = 'settings-alias-preview-match';
        matchLabel.textContent = 'Matches: ' + match.trigger.pattern + (match.trigger.gag ? ' [gag]' : '');
        body.appendChild(matchLabel);

        const captureRow = document.createElement('div');
        captureRow.className = 'settings-helper-text';
        captureRow.textContent = match.captures.length
          ? match.captures.map((value, index) => '%' + (index + 1) + '=' + value).join(' | ')
          : 'No captures';
        body.appendChild(captureRow);

        for (const step of match.trigger.steps || []) {
          const row = document.createElement('div');
          row.className = 'settings-alias-preview-step';

          if (step.type === 'play_sound') {
            row.textContent = getAutomationStepLabel(step) + ': ' + soundLabel(step.category, step.sound);
            if (!isKnownSound(step.category, step.sound)) {
              row.classList.add('warning');
              row.textContent += ' (sound not found)';
            }
            body.appendChild(row);
            continue;
          }

          const resolved = aliasManager.resolveTemplate(
            step.type === 'set_alias_enabled' ? step.target : step.template,
            {
              args: match.captures,
              remainder: match.fullMatch,
              variables: previewVariables,
            }
          );

          if (step.type === 'set_alias_enabled') {
            const target = resolved.text.trim();
            const mode = normalizeAutomationMode(step.mode);
            const alias = previewAliases.find((item) => item.trigger.trim().replace(/\s+/g, ' ').toLowerCase() === target.trim().replace(/\s+/g, ' ').toLowerCase());
            row.textContent = getAutomationStepLabel(step) + ': ' + target;
            if (resolved.missingVariables.length) {
              row.classList.add('warning');
              row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
            } else if (resolved.errors.length) {
              row.classList.add('warning');
              row.textContent += ' (' + resolved.errors.join(' ') + ')';
            } else if (!target || !alias) {
              row.classList.add('warning');
              row.textContent += target ? ' (alias not found)' : ' (empty target)';
            } else {
              alias.enabled = mode === 'toggle' ? alias.enabled === false : mode === 'enable';
              row.textContent += ' -> ' + (alias.enabled === false ? 'disabled' : 'enabled');
            }
            body.appendChild(row);
            continue;
          }

          if (step.type === 'run_alias') {
            const aliasMatch = aliasManager.matchAliasInAliases(resolved.text, previewAliases);
            row.textContent = getAutomationStepLabel(step) + ': ' + resolved.text;
            if (resolved.missingVariables.length) {
              row.classList.add('warning');
              row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
            } else if (resolved.errors.length) {
              row.classList.add('warning');
              row.textContent += ' (' + resolved.errors.join(' ') + ')';
            } else if (!aliasMatch) {
              row.classList.add('warning');
              row.textContent += ' (no enabled alias matches)';
            } else {
              row.textContent += ' -> ' + aliasMatch.alias.trigger;
            }
            body.appendChild(row);
            continue;
          }

          let prefix = 'Send';
          if (step.type === 'set_variable') prefix = 'Set $' + step.name;
          if (step.type === 'show_message') prefix = 'Show';

          row.textContent = prefix + ': ' + resolved.text;
          if (resolved.missingVariables.length) {
            row.classList.add('warning');
            row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
          } else if (resolved.errors.length) {
            row.classList.add('warning');
            row.textContent += ' (' + resolved.errors.join(' ') + ')';
          } else if (step.type === 'set_variable' && step.name) {
            previewVariables[step.name] = resolved.text;
          }
          body.appendChild(row);
        }
      });

      previewBody.appendChild(body);
    };

    const renderPreview = () => {
      previewCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Live preview';

      const help = document.createElement('p');
      help.className = 'dw-paragraph settings-helper-text';
      help.textContent = 'Try an incoming output line to see which triggers match, what they capture, and what actions will run.';

      sampleInputEl.value = sampleInput;
      previewCard.appendChild(title);
      previewCard.appendChild(help);
      previewCard.appendChild(sampleInputEl);
      previewCard.appendChild(previewBody);
      renderPreviewBody();
    };

    const renderTriggerDetail = () => {
      editor.textContent = '';
      const trigger = ensureSelectedTrigger();
      if (!trigger) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = 'Create a trigger to react to incoming output lines.';
        editor.appendChild(empty);
        return;
      }

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Trigger editor';
      editor.appendChild(title);

      const diagnostics = triggerManager.getTriggerDiagnostics(this._draftTriggerScope, trigger.id);
      if (diagnostics.length) {
        const warningBox = document.createElement('div');
        warningBox.className = 'settings-alias-diagnostics';
        diagnostics.forEach((message) => {
          const item = document.createElement('div');
          item.textContent = message;
          warningBox.appendChild(item);
        });
        editor.appendChild(warningBox);
      }

      const patternField = document.createElement('label');
      patternField.className = 'dw-field';
      patternField.appendChild(createFieldLabel('Pattern'));
      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.className = 'dw-input';
      patternInput.dataset.focusKey = 'trigger-pattern';
      patternInput.placeholder = trigger.isRegex ? 'You are attacked by (.+)' : 'You are attacked by *';
      patternInput.value = trigger.pattern;
      patternInput.addEventListener('input', () => {
        trigger.pattern = patternInput.value;
        renderTriggerList();
        renderPreview();
      });
      patternInput.addEventListener('blur', () => {
        render();
      });
      patternField.appendChild(patternInput);
      editor.appendChild(patternField);

      editor.appendChild(this._createCheckboxRow(
        'Use regex',
        'Treat this trigger pattern as a JavaScript regular expression. Capturing groups become %1, %2, and so on.',
        trigger.isRegex === true,
        (checked) => {
          trigger.isRegex = checked;
          render();
        }
      ));

      if (trigger.isRegex) {
        editor.appendChild(this._createCheckboxRow(
          'Ignore case',
          'Match this regex trigger without caring about capitalization.',
          trigger.ignoreCase === true,
          (checked) => {
            trigger.ignoreCase = checked;
            render();
          }
        ));
      }

      const descriptionField = document.createElement('label');
      descriptionField.className = 'dw-field';
      descriptionField.appendChild(createFieldLabel('Description'));
      const descriptionInput = document.createElement('input');
      descriptionInput.type = 'text';
      descriptionInput.className = 'dw-input';
      descriptionInput.placeholder = 'Capture attackers and respond';
      descriptionInput.value = trigger.description;
      descriptionInput.addEventListener('input', () => {
        trigger.description = descriptionInput.value;
        renderTriggerList();
      });
      descriptionField.appendChild(descriptionInput);
      editor.appendChild(descriptionField);

      const groupField = document.createElement('label');
      groupField.className = 'dw-field';
      groupField.appendChild(createFieldLabel('Group / folder'));
      const groupInput = document.createElement('input');
      groupInput.type = 'text';
      groupInput.className = 'dw-input';
      groupInput.placeholder = 'Loot, Combat, Alerts';
      groupInput.value = trigger.group || '';
      groupInput.addEventListener('input', () => {
        trigger.group = groupInput.value;
        renderTriggerList();
      });
      groupField.appendChild(groupInput);
      editor.appendChild(groupField);

      editor.appendChild(this._createCheckboxRow(
        'Trigger enabled',
        'Disabled triggers stay saved but never match incoming output.',
        trigger.enabled !== false,
        (checked) => {
          trigger.enabled = checked;
          render();
        }
      ));

      editor.appendChild(this._createCheckboxRow(
        'Gag matching output',
        'Hide matched lines from the terminal after this trigger runs.',
        trigger.gag === true,
        (checked) => {
          trigger.gag = checked;
          renderPreview();
        }
      ));

      const stepsTitle = createFieldLabel('Steps');
      editor.appendChild(stepsTitle);

      const stepList = document.createElement('div');
      stepList.className = 'settings-alias-step-list';

      const stepTypeOptions = [
        { value: 'send_command', type: 'send_command', label: 'Send command' },
        { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
        { value: 'show_message', type: 'show_message', label: 'Show local message' },
        { value: 'set_alias_enabled:toggle', type: 'set_alias_enabled', mode: 'toggle', label: 'Toggle alias' },
        { value: 'set_alias_enabled:enable', type: 'set_alias_enabled', mode: 'enable', label: 'Enable alias' },
        { value: 'set_alias_enabled:disable', type: 'set_alias_enabled', mode: 'disable', label: 'Disable alias' },
        { value: 'run_alias', type: 'run_alias', label: 'Run alias' },
        { value: 'play_sound', type: 'play_sound', label: 'Play sound' },
      ];
      const getTriggerStepOptionValue = (step) => (
        step.type === 'set_alias_enabled'
          ? 'set_alias_enabled:' + normalizeAutomationMode(step.mode)
          : step.type
      );

      trigger.steps.forEach((step, index) => {
        const stepCard = document.createElement('div');
        stepCard.className = 'settings-alias-step-card';

        const stepHeader = document.createElement('div');
        stepHeader.className = 'settings-alias-step-header';

        const stepSelect = document.createElement('select');
        stepSelect.className = 'dw-select';
        stepSelect.dataset.focusKey = 'trigger-step-' + index + '-type';
        stepTypeOptions.forEach((option) => {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          if (getTriggerStepOptionValue(step) === option.value) el.selected = true;
          stepSelect.appendChild(el);
        });
        stepSelect.addEventListener('change', () => {
          const selectedOption = stepTypeOptions.find((option) => option.value === stepSelect.value) || stepTypeOptions[0];
          step.type = selectedOption.type;
          if (selectedOption.mode) step.mode = selectedOption.mode;
          else delete step.mode;
          if (step.type !== 'set_variable') delete step.name;
          if (step.type !== 'set_alias_enabled') delete step.target;
          if (step.type === 'set_alias_enabled' && !step.target) step.target = '';
          if (step.type === 'play_sound') {
            delete step.template;
            ensureSoundStep(step);
          } else {
            delete step.category;
            delete step.sound;
            delete step.volume;
            if (!step.template) step.template = '';
          }
          render();
        });

        const controls = document.createElement('div');
        controls.className = 'settings-alias-step-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'dw-button dw-button-secondary';
        upBtn.textContent = 'Up';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          const previous = trigger.steps[index - 1];
          trigger.steps[index - 1] = step;
          trigger.steps[index] = previous;
          render();
          this._focusSettingsControl('trigger-step-' + (index - 1) + '-type');
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'dw-button dw-button-secondary';
        downBtn.textContent = 'Down';
        downBtn.disabled = index === trigger.steps.length - 1;
        downBtn.addEventListener('click', () => {
          const next = trigger.steps[index + 1];
          trigger.steps[index + 1] = step;
          trigger.steps[index] = next;
          render();
          this._focusSettingsControl('trigger-step-' + (index + 1) + '-type');
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          trigger.steps.splice(index, 1);
          if (!trigger.steps.length) trigger.steps.push({ type: 'send_command', template: '' });
          render();
          this._focusSettingsControl('trigger-step-' + Math.min(index, trigger.steps.length - 1) + '-type');
        });

        stepHeader.appendChild(stepSelect);
        stepCard.appendChild(stepHeader);

        if (step.type === 'set_variable') {
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.className = 'dw-input';
          nameInput.placeholder = 'enemy';
          nameInput.value = step.name || '';
          nameInput.addEventListener('input', () => {
            step.name = nameInput.value;
          });
          stepCard.appendChild(nameInput);
        }

        if (step.type === 'play_sound') {
          ensureSoundStep(step);

          const categorySelect = document.createElement('select');
          categorySelect.className = 'dw-select';
          categorySelect.dataset.focusKey = 'trigger-step-' + index + '-sound-category';
          soundCategories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = SOUND_CATEGORY_INFO[category] ? SOUND_CATEGORY_INFO[category].label : category;
            if (step.category === category) option.selected = true;
            categorySelect.appendChild(option);
          });
          categorySelect.addEventListener('change', () => {
            step.category = categorySelect.value;
            const sounds = soundsForCategory(step.category);
            step.sound = sounds[0] ? sounds[0].sound : '';
            render();
            this._focusSettingsControl('trigger-step-' + index + '-sound-category');
          });
          stepCard.appendChild(categorySelect);

          const soundSelect = document.createElement('select');
          soundSelect.className = 'dw-select';
          soundSelect.dataset.focusKey = 'trigger-step-' + index + '-sound';
          soundsForCategory(step.category).forEach((item) => {
            const option = document.createElement('option');
            option.value = item.sound;
            option.textContent = item.label.replace((SOUND_CATEGORY_INFO[item.category] ? SOUND_CATEGORY_INFO[item.category].label : item.category) + ' / ', '');
            if (step.sound === item.sound) option.selected = true;
            soundSelect.appendChild(option);
          });
          soundSelect.addEventListener('change', () => {
            step.sound = soundSelect.value;
            renderPreview();
          });
          stepCard.appendChild(soundSelect);

          const volumeField = document.createElement('label');
          volumeField.className = 'dw-field';
          volumeField.appendChild(createFieldLabel('Volume'));
          const volumeInput = document.createElement('input');
          volumeInput.type = 'range';
          volumeInput.min = '0';
          volumeInput.max = '100';
          volumeInput.value = String(Math.round(step.volume * 100));
          volumeInput.dataset.focusKey = 'trigger-step-' + index + '-sound-volume';
          const volumeValue = document.createElement('div');
          volumeValue.className = 'settings-helper-text';
          volumeValue.textContent = Math.round(step.volume * 100) + '%';
          volumeInput.addEventListener('input', () => {
            step.volume = Number(volumeInput.value) / 100;
            volumeValue.textContent = volumeInput.value + '%';
            renderPreview();
          });
          volumeField.appendChild(volumeInput);
          volumeField.appendChild(volumeValue);
          stepCard.appendChild(volumeField);

          const testBtn = document.createElement('button');
          testBtn.type = 'button';
          testBtn.className = 'dw-button dw-button-secondary';
          testBtn.textContent = 'Test';
          testBtn.addEventListener('click', () => {
            soundManager.play(step.category, step.sound, step.volume);
          });
          stepCard.appendChild(testBtn);
        } else if (step.type === 'set_alias_enabled') {
          const targetInput = document.createElement('input');
          const listId = 'trigger-alias-targets-' + index;
          const targetList = document.createElement('datalist');
          targetInput.type = 'text';
          targetInput.className = 'dw-input';
          targetInput.placeholder = 'Exact alias trigger';
          targetInput.setAttribute('list', listId);
          targetInput.value = step.target || '';
          targetList.id = listId;
          this._draftAliasScope.aliases.forEach((alias) => {
            const option = document.createElement('option');
            option.value = alias.trigger;
            targetList.appendChild(option);
          });
          targetInput.addEventListener('input', () => {
            step.target = targetInput.value;
          });
          stepCard.appendChild(targetInput);
          stepCard.appendChild(targetList);
        } else {
          const templateInput = document.createElement('textarea');
          templateInput.className = 'dw-input settings-alias-template';
          templateInput.placeholder = step.type === 'show_message'
            ? 'Attacker: %1'
            : step.type === 'set_variable'
              ? '%1'
              : step.type === 'run_alias'
                ? 'assist %1'
                : 'kill %1';
          templateInput.value = step.template || '';
          templateInput.addEventListener('input', () => {
            step.template = templateInput.value;
          });
          stepCard.appendChild(templateInput);
        }
        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
        controls.appendChild(removeBtn);
        stepCard.appendChild(controls);

        const helper = document.createElement('div');
        helper.className = 'settings-helper-text';
        helper.textContent = step.type === 'play_sound'
          ? 'Sound actions use Darkflow audio settings, category toggles, and browser audio unlock.'
          : step.type === 'set_alias_enabled'
            ? 'Target may be an exact alias trigger or a template that resolves to one.'
            : 'Simple patterns support * or %1-%9 as captures. Regex triggers use JavaScript regular expressions, with capture groups available as %1-%9. Step templates support %0 for the full match, $name variables, and ${lower:%1} or ${lower:$name} for lowercase.';
        stepCard.appendChild(helper);

        stepList.appendChild(stepCard);
      });

      editor.appendChild(stepList);

      const stepAddActions = document.createElement('div');
      stepAddActions.className = 'settings-inline-actions';
      stepTypeOptions.forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dw-button dw-button-secondary';
        btn.dataset.focusKey = 'trigger-step-add-' + option.value;
        btn.textContent = option.label;
        btn.addEventListener('click', () => {
          const step = { type: option.type, template: '' };
          if (option.mode) step.mode = option.mode;
          if (option.type === 'set_variable') step.name = '';
          if (option.type === 'set_alias_enabled') step.target = '';
          if (option.type === 'play_sound') {
            delete step.template;
            step.category = firstSound.category;
            step.sound = firstSound.sound;
            step.volume = 1;
          }
          trigger.steps.push(step);
          render();
          this._focusSettingsControl('trigger-step-' + (trigger.steps.length - 1) + '-type');
        });
        stepAddActions.appendChild(btn);
      });
      editor.appendChild(stepAddActions);
    };

    const renderTriggerList = () => {
      const previousList = sidebar.querySelector('.settings-alias-list');
      const previousScrollTop = previousList ? previousList.scrollTop : 0;
      sidebar.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Triggers';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dw-input';
      search.dataset.focusKey = 'trigger-search';
      search.placeholder = 'Search triggers';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        const selectionStart = search.selectionStart;
        const selectionEnd = search.selectionEnd;
        searchTerm = search.value;
        render();
        this._focusSettingsTextControl('trigger-search', selectionStart, selectionEnd);
      });

      const list = document.createElement('div');
      list.className = 'settings-alias-list';

      const filteredTriggers = this._draftTriggerScope.triggers
        .map((trigger, index) => ({ trigger, index }))
        .filter((entry) => {
          const trigger = entry.trigger;
          const haystack = (trigger.pattern + ' ' + trigger.description + ' ' + (trigger.group || '')).toLowerCase();
          return haystack.includes(searchTerm.trim().toLowerCase());
        })
        .sort((a, b) => {
          const groupA = (a.trigger.group || '').trim() || 'Ungrouped';
          const groupB = (b.trigger.group || '').trim() || 'Ungrouped';
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.index - b.index;
        })
        .map((entry) => entry.trigger);

      let lastGroup = null;
      const focusTriggerByOffset = (index, offset) => {
        if (!filteredTriggers.length) return;
        const nextIndex = Math.max(0, Math.min(filteredTriggers.length - 1, index + offset));
        selectedTriggerId = filteredTriggers[nextIndex].id;
        render();
        this._focusSettingsControl('trigger-row-' + selectedTriggerId);
      };

      filteredTriggers.forEach((trigger, index) => {
        const group = (trigger.group || '').trim() || 'Ungrouped';
        if (group !== lastGroup) {
          const groupHeader = document.createElement('div');
          groupHeader.className = 'settings-alias-group-header';
          groupHeader.textContent = group;
          list.appendChild(groupHeader);
          lastGroup = group;
        }

        const selected = trigger.id === selectedTriggerId;
        const row = document.createElement('div');
        row.className = 'settings-alias-list-item' + (selected ? ' active' : '');

        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'settings-alias-list-select';
        rowBtn.dataset.focusKey = 'trigger-row-' + trigger.id;
        rowBtn.tabIndex = selected ? 0 : -1;
        rowBtn.addEventListener('click', () => {
          selectedTriggerId = trigger.id;
          render();
        });
        rowBtn.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusTriggerByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusTriggerByOffset(index, -1);
          }
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = trigger.enabled !== false;
        checkbox.className = 'settings-alias-list-toggle';
        checkbox.dataset.focusKey = 'trigger-toggle-' + trigger.id;
        checkbox.tabIndex = selected ? 0 : -1;
        checkbox.addEventListener('change', () => {
          trigger.enabled = checkbox.checked;
          render();
          this._focusSettingsControl('trigger-toggle-' + trigger.id);
        });
        checkbox.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusTriggerByOffset(index, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusTriggerByOffset(index, -1);
          }
        });

        const copy = document.createElement('div');
        copy.className = 'settings-copy';

        const pattern = document.createElement('div');
        pattern.className = 'settings-label';
        pattern.textContent = trigger.pattern || '(untitled)';

        const description = document.createElement('div');
        description.className = 'settings-alias-list-meta';
        if (trigger.description) description.textContent = trigger.description;
        else if (trigger.gag) description.textContent = (trigger.isRegex ? 'regex, ' : '') + 'gag enabled';
        else if (trigger.steps[0] && trigger.steps[0].type === 'play_sound')
          description.textContent = (trigger.isRegex ? 'regex, ' : '') + 'Play sound: ' + soundLabel(trigger.steps[0].category, trigger.steps[0].sound);
        else description.textContent = (trigger.isRegex ? 'regex, ' : '') + trigger.steps.length + ' step' + (trigger.steps.length === 1 ? '' : 's');

        copy.appendChild(pattern);
        copy.appendChild(description);
        rowBtn.appendChild(copy);
        row.appendChild(rowBtn);
        row.appendChild(checkbox);
        list.appendChild(row);
      });

      if (!filteredTriggers.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = searchTerm ? 'No triggers match this filter.' : 'No triggers defined for this scope.';
        list.appendChild(empty);
      }

      const addActions = document.createElement('div');
      addActions.className = 'settings-inline-actions';

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
      addBtn.textContent = 'Add trigger';
      addBtn.addEventListener('click', () => {
        const trigger = triggerManager.createEmptyTrigger();
        this._draftTriggerScope.triggers.push(trigger);
        selectedTriggerId = trigger.id;
        render();
        this._focusSettingsControl('trigger-pattern');
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
      removeBtn.textContent = 'Remove selected';
      removeBtn.disabled = !ensureSelectedTrigger();
      removeBtn.addEventListener('click', () => {
        const trigger = ensureSelectedTrigger();
        if (!trigger) return;
        this._draftTriggerScope.triggers = this._draftTriggerScope.triggers.filter((item) => item.id !== trigger.id);
        selectedTriggerId = this._draftTriggerScope.triggers[0] ? this._draftTriggerScope.triggers[0].id : null;
        render();
        this._focusSettingsControl(selectedTriggerId ? 'trigger-row-' + selectedTriggerId : 'trigger-add');
      });

      addBtn.dataset.focusKey = 'trigger-add';
      addActions.appendChild(addBtn);
      actions.appendChild(removeBtn);
      sidebar.appendChild(title);
      sidebar.appendChild(search);
      sidebar.appendChild(addActions);
      sidebar.appendChild(list);
      sidebar.appendChild(actions);
      list.scrollTop = previousScrollTop;
    };

    const render = () => {
      ensureSelectedTrigger();
      renderTriggerList();
      renderTriggerDetail();
      renderPreview();
    };

    layout.appendChild(sidebar);
    layout.appendChild(editor);
    wrapper.appendChild(layout);
    wrapper.appendChild(previewCard);

    render();
    return wrapper;
  },

  _createAboutPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-about';

    const hero = document.createElement('div');
    hero.className = 'settings-about-hero';

    const mark = document.createElement('img');
    mark.className = 'settings-about-mark';
    mark.src = 'assets/brand/darkflow-app-icon.png';
    mark.alt = PRODUCT_NAME + ' app icon';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const name = document.createElement('div');
    name.className = 'settings-about-title';
    name.textContent = PRODUCT_NAME;

    const siteLink = document.createElement('a');
    siteLink.className = 'settings-about-extlink';
    siteLink.href = 'https://darkflow.darkwind.ai';
    siteLink.target = '_blank';
    siteLink.rel = 'noopener noreferrer';
    siteLink.title = 'Open ' + PRODUCT_NAME + ' site';
    siteLink.setAttribute('aria-label', 'Open ' + PRODUCT_NAME + ' site');
    siteLink.appendChild(this._externalLinkIcon());
    name.appendChild(siteLink);

    const tagline = document.createElement('div');
    tagline.className = 'settings-about-tagline';
    tagline.appendChild(document.createTextNode('Web-based MUD client - built for '));
    const darkwindLink = document.createElement('a');
    darkwindLink.href = 'https://play.darkwind.ai';
    darkwindLink.target = '_blank';
    darkwindLink.rel = 'noopener noreferrer';
    darkwindLink.className = 'settings-about-link';
    darkwindLink.textContent = 'Darkwind';
    tagline.appendChild(darkwindLink);

    copy.appendChild(name);
    copy.appendChild(tagline);
    hero.appendChild(mark);
    hero.appendChild(copy);
    wrapper.appendChild(hero);

    const infoGrid = document.createElement('div');
    infoGrid.className = 'settings-about-grid';

    const addInfo = (label, valueNode) => {
      const card = document.createElement('div');
      card.className = 'settings-connection-card';

      const labelEl = document.createElement('div');
      labelEl.className = 'settings-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('div');
      valueEl.className = 'settings-connection-value';
      if (typeof valueNode === 'string') valueEl.textContent = valueNode;
      else valueEl.appendChild(valueNode);

      card.appendChild(labelEl);
      card.appendChild(valueEl);
      infoGrid.appendChild(card);
    };

    addInfo('Client version', state.clientVersion || 'unknown');

    const gmcpLink = document.createElement('a');
    gmcpLink.href = 'https://github.com/jasona/darkflow/tree/main/docs';
    gmcpLink.target = '_blank';
    gmcpLink.rel = 'noopener noreferrer';
    gmcpLink.className = 'settings-about-link';
    gmcpLink.textContent = 'See custom GMCP extensions';
    gmcpLink.appendChild(this._externalLinkIcon());
    addInfo('GMCP packages', gmcpLink);

    wrapper.appendChild(infoGrid);

    return wrapper;
  },

  _externalLinkIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'settings-about-extlink-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML =
      '<path fill="currentColor" d="M9 2h5v5h-1.5V4.56L7.78 9.28 6.72 8.22 11.44 3.5H9V2z"/>' +
      '<path fill="currentColor" d="M3 4h4v1.5H4.5v6h6V9H12v4H3V4z"/>';
    return svg;
  },

  _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay settings-overlay';
    overlay.addEventListener('focusin', (event) => {
      const scopeRoot = event.target instanceof HTMLElement
        ? event.target.closest('[data-edit-focus-scope]')
        : null;
      if (scopeRoot && scopeRoot instanceof HTMLElement) {
        this._activeEditFocusScope = scopeRoot.dataset.editFocusScope || null;
      } else if (!(event.target instanceof HTMLElement) ||
        event.target.dataset.focusKey !== 'settings-save') {
        this._activeEditFocusScope = null;
      }
    });

    const modal = document.createElement('div');
    modal.className = 'dw-modal settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'settings-modal-title');

    const header = document.createElement('div');
    header.className = 'dw-modal-header';

    const title = document.createElement('span');
    title.className = 'dw-modal-title';
    title.id = 'settings-modal-title';
    title.textContent = 'Settings';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dw-modal-close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'dw-modal-body settings-modal-body';

    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Settings sections');

    const tabPanels = document.createElement('div');
    tabPanels.className = 'settings-tab-panels';

    const tabButtons = new Map();
    const tabContents = new Map();
    const tabOrder = [];
    let renderAliasesSection = null;
    let renderVariablesSection = null;
    const activateTab = (key) => {
      if (key === 'aliases' && renderAliasesSection) renderAliasesSection();
      if (key === 'variables' && renderVariablesSection) renderVariablesSection();
      for (const [tabKey, btn] of tabButtons) {
        btn.classList.toggle('active', tabKey === key);
        btn.setAttribute('aria-selected', tabKey === key ? 'true' : 'false');
        btn.tabIndex = tabKey === key ? 0 : -1;
      }
      for (const [tabKey, panel] of tabContents) {
        panel.hidden = tabKey !== key;
        panel.style.display = tabKey === key ? 'flex' : 'none';
      }
    };
    this._activateTab = activateTab;
    const createTab = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab-btn';
      btn.id = 'settings-tab-' + key;
      btn.dataset.focusKey = 'settings-tab-' + key;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'settings-panel-' + key);
      btn.setAttribute('aria-selected', 'false');
      btn.tabIndex = -1;
      btn.textContent = label;
      btn.addEventListener('click', () => activateTab(key));
      btn.addEventListener('keydown', (event) => {
        const index = tabOrder.indexOf(key);
        let nextIndex = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (index + 1) % tabOrder.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (index - 1 + tabOrder.length) % tabOrder.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabOrder.length - 1;
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activateTab(key);
          return;
        }
        if (nextIndex < 0) return;
        event.preventDefault();
        const nextKey = tabOrder[nextIndex];
        activateTab(nextKey);
        const nextBtn = tabButtons.get(nextKey);
        if (nextBtn) nextBtn.focus();
      });
      tabButtons.set(key, btn);
      tabOrder.push(key);
      tabs.appendChild(btn);

      const panel = document.createElement('section');
      panel.id = 'settings-panel-' + key;
      panel.className = 'settings-section';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'settings-tab-' + key);
      panel.hidden = true;
      panel.style.display = 'none';
      tabContents.set(key, panel);
      tabPanels.appendChild(panel);
      return panel;
    };

    const connectionSection = createTab('connection', 'Connection');
    const terminalSection = createTab('terminal', 'Terminal');
    const audioSection = createTab('audio', 'Audio');
    const controlsSection = createTab('controls', 'Controls');
    const triggersSection = createTab('triggers', 'Triggers');
    const highlightsSection = createTab('highlights', 'Highlights');
    const aliasesSection = createTab('aliases', 'Aliases');
    const variablesSection = createTab('variables', 'Variables');
    const aboutSection = createTab('about', 'About');

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'dw-heading';
    sectionTitle.textContent = 'Connection';

    connectionSection.appendChild(sectionTitle);
    connectionSection.appendChild(this._createCheckboxRow(
      'Auto-reconnect',
      'Reconnect automatically after unexpected connection loss.',
      !!this._draftSettings.autoReconnect,
      (checked) => {
        this._draftSettings.autoReconnect = checked;
      }
    ));

    if (state.ws) {
      const connectionDetails = document.createElement('div');
      connectionDetails.className = 'settings-connection-card';

      const detailsLabel = document.createElement('div');
      detailsLabel.className = 'settings-label';
      detailsLabel.textContent = 'Current connection';

      const proto = dom.protocolSelect ? dom.protocolSelect.value : 'wss';
      const detailsValue = document.createElement('div');
      detailsValue.className = 'settings-connection-value';
      detailsValue.textContent = proto + '://' + (dom.host.value || 'localhost') + ':' + (dom.port.value || '4242');

      const disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'dw-button settings-disconnect-btn';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.addEventListener('click', () => {
        state.userDisconnected = true;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        if (state.ws) {
          state.ws.close(1000, 'User disconnect');
        }
        this.close();
      });

      connectionDetails.appendChild(detailsLabel);
      connectionDetails.appendChild(detailsValue);
      connectionDetails.appendChild(disconnectBtn);
      connectionSection.appendChild(connectionDetails);
    }

    const terminalTitle = document.createElement('h3');
    terminalTitle.className = 'dw-heading';
    terminalTitle.textContent = 'Terminal';

    terminalSection.appendChild(terminalTitle);
    terminalSection.appendChild(this._createThemeRow());
    terminalSection.appendChild(this._createSelectRow(
      'Scrollback memory',
      'Choose how much terminal history to retain before the oldest lines are discarded.',
      this._draftSettings.outputScrollbackPreset,
      [
        { value: 'low', label: 'Low (5,000 lines)' },
        { value: 'normal', label: 'Normal (10,000 lines)' },
        { value: 'high', label: 'High (20,000 lines)' },
      ],
      (value) => {
        this._draftSettings.outputScrollbackPreset = value;
      }
    ));
    terminalSection.appendChild(this._createSelectRow(
      'Scrollback mode',
      'Choose whether scrolling back pauses the terminal or opens a split view with live output below.',
      this._draftSettings.scrollbackBehavior,
      [
        { value: 'pause', label: 'Pause terminal' },
        { value: 'split', label: 'Split history + live' },
      ],
      (value) => {
        this._draftSettings.scrollbackBehavior = value;
      }
    ));
    terminalSection.appendChild(this._createNumberRow(
      'Screen width',
      'Leave blank for automatic pane width, or enter a fixed column width for server-side wrapping.',
      this._draftSettings.terminalWidthColumns,
      {
        min: MIN_TERMINAL_WIDTH_COLUMNS,
        max: MAX_TERMINAL_WIDTH_COLUMNS,
        step: 1,
        placeholder: 'Auto',
      },
      (value) => {
        this._draftSettings.terminalWidthColumns = value;
      }
    ));
    terminalSection.appendChild(this._createSelectRow(
      'Workspace layout',
      'Choose the classic fixed terminal and sidebars, or a floating workspace where the terminal and panes can all move and dock.',
      this._draftSettings.workspaceLayout,
      [
        { value: 'classic', label: 'Classic terminal + sidebars' },
        { value: 'floating', label: 'Floating workspace' },
      ],
      (value) => {
        this._draftSettings.workspaceLayout = value;
      }
    ));
    terminalSection.appendChild(this._createCheckboxRow(
      'Snap floating panes to grid',
      'Align floating pane positions and resized pane dimensions to a 16px grid.',
      !!this._draftSettings.paneGridSnapEnabled,
      (checked) => {
        this._draftSettings.paneGridSnapEnabled = checked;
      }
    ));
    const resetLayoutCard = document.createElement('div');
    resetLayoutCard.className = 'settings-connection-card';
    const resetLayoutLabel = document.createElement('div');
    resetLayoutLabel.className = 'settings-label';
    resetLayoutLabel.textContent = 'Pane layout';
    const resetLayoutCopy = document.createElement('p');
    resetLayoutCopy.className = 'dw-paragraph';
    resetLayoutCopy.textContent = 'Reset saved pane, dock, and terminal window positions for the current browser.';
    const resetLayoutBtn = document.createElement('button');
    resetLayoutBtn.className = 'dw-button dw-button-secondary';
    resetLayoutBtn.type = 'button';
    resetLayoutBtn.textContent = 'Reset layout';
    resetLayoutBtn.addEventListener('click', () => {
      const confirmed = window.confirm('Reset saved pane and terminal layout for this browser?');
      if (!confirmed) return;
      panelManager.resetLayoutState();
      this._setFooterStatus('Layout reset.');
    });
    resetLayoutCard.appendChild(resetLayoutLabel);
    resetLayoutCard.appendChild(resetLayoutCopy);
    resetLayoutCard.appendChild(resetLayoutBtn);
    terminalSection.appendChild(resetLayoutCard);
    terminalSection.appendChild(this._createCheckboxRow(
      'Screen reader announcements',
      'Mirror new terminal lines into a hidden polite live region for browser screen readers.',
      !!this._draftSettings.screenReaderMode,
      (checked) => {
        this._draftSettings.screenReaderMode = checked;
      }
    ));
    const screenReaderSyncCard = document.createElement('div');
    screenReaderSyncCard.className = 'settings-connection-card';
    const screenReaderSyncLabel = document.createElement('div');
    screenReaderSyncLabel.className = 'settings-label';
    screenReaderSyncLabel.textContent = 'Game screen reader setting';
    const screenReaderSyncCopy = document.createElement('p');
    screenReaderSyncCopy.className = 'dw-paragraph';
    screenReaderSyncCopy.textContent = 'This sends set screenreader on to the game. It changes your saved MUD setting only when you press the button.';
    const screenReaderSyncBtn = document.createElement('button');
    screenReaderSyncBtn.className = 'dw-button dw-button-secondary';
    screenReaderSyncBtn.type = 'button';
    screenReaderSyncBtn.textContent = 'Sync now';
    screenReaderSyncBtn.disabled = !state.ws || state.ws.readyState !== WebSocket.OPEN;
    screenReaderSyncBtn.addEventListener('click', () => this._syncScreenReaderServerSetting());
    screenReaderSyncCard.appendChild(screenReaderSyncLabel);
    screenReaderSyncCard.appendChild(screenReaderSyncCopy);
    screenReaderSyncCard.appendChild(screenReaderSyncBtn);
    terminalSection.appendChild(screenReaderSyncCard);
    const audioTitle = document.createElement('h3');
    audioTitle.className = 'dw-heading';
    audioTitle.textContent = 'Audio';
    audioSection.appendChild(audioTitle);
    audioSection.appendChild(this._createAudioSettingsPanel());

    const controlsTitle = document.createElement('h3');
    controlsTitle.className = 'dw-heading';
    controlsTitle.textContent = 'Controls';

    controlsSection.appendChild(controlsTitle);
    controlsSection.appendChild(this._createCheckboxRow(
      'Keep last command selected after send',
      'Keep the last command in the input selected so Enter repeats it and typing replaces it.',
      !!this._draftSettings.repeatLastCommand,
      (checked) => {
        this._draftSettings.repeatLastCommand = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Use aliases for Tab completion',
      'Complete matching client aliases before falling back to command history or server-side Tab completion.',
      !!this._draftSettings.aliasTabCompletionEnabled,
      (checked) => {
        this._draftSettings.aliasTabCompletionEnabled = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Use command history for Tab completion',
      'Try recent commands with the same verb before falling back to server-side Tab completion.',
      !!this._draftSettings.historyTabCompletionEnabled,
      (checked) => {
        this._draftSettings.historyTabCompletionEnabled = checked;
      }
    ));

    const keyMapperFields = this._createKeyMappingsEditor();
    keyMapperFields.style.display = this._draftSettings.keyMapperEnabled ? 'flex' : 'none';

    controlsSection.appendChild(this._createCheckboxRow(
      'Enable custom key mappings',
      'Bind keys like ArrowUp or 1 to send commands immediately without pressing Enter.',
      !!this._draftSettings.keyMapperEnabled,
      (checked) => {
        this._draftSettings.keyMapperEnabled = checked;
        keyMapperFields.style.display = checked ? 'flex' : 'none';
      }
    ));
    controlsSection.appendChild(keyMapperFields);
    controlsSection.appendChild(this._createCheckboxRow(
      'Send tab-away / tab-back on tab changes',
      'Automatically notifies the game when this browser tab becomes inactive or active again.',
      !!this._draftSettings.tabObservabilityEnabled,
      (checked) => {
        this._draftSettings.tabObservabilityEnabled = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Prompt to export changed settings',
      'Ask to download a backup when settings changed during the session and the settings panel is closed.',
      !!this._draftSettings.settingsBackupPromptEnabled,
      (checked) => {
        this._draftSettings.settingsBackupPromptEnabled = checked;
      }
    ));

    const triggersTitle = document.createElement('h3');
    triggersTitle.className = 'dw-heading';
    triggersTitle.textContent = 'Triggers';
    triggersSection.appendChild(triggersTitle);
    triggersSection.appendChild(this._createTriggerEditor());

    const highlightsTitle = document.createElement('h3');
    highlightsTitle.className = 'dw-heading';
    highlightsTitle.textContent = 'Highlights';
    highlightsSection.appendChild(highlightsTitle);
    highlightsSection.appendChild(this._createHighlightEditor());

    renderAliasesSection = () => {
      aliasesSection.textContent = '';
      const aliasesTitle = document.createElement('h3');
      aliasesTitle.className = 'dw-heading';
      aliasesTitle.textContent = 'Aliases';
      aliasesSection.appendChild(aliasesTitle);
      aliasesSection.appendChild(this._createAliasEditor());
    };
    renderAliasesSection();

    renderVariablesSection = () => {
      variablesSection.textContent = '';
      const variablesTitle = document.createElement('h3');
      variablesTitle.className = 'dw-heading';
      variablesTitle.textContent = 'Variables';
      variablesSection.appendChild(variablesTitle);
      variablesSection.appendChild(this._createVariablesEditor());
    };
    renderVariablesSection();

    const aboutTitle = document.createElement('h3');
    aboutTitle.className = 'dw-heading';
    aboutTitle.textContent = 'About';
    aboutSection.appendChild(aboutTitle);
    aboutSection.appendChild(this._createAboutPanel());

    this._refreshEditors = () => {
      triggersSection.textContent = '';
      const nextTriggersTitle = document.createElement('h3');
      nextTriggersTitle.className = 'dw-heading';
      nextTriggersTitle.textContent = 'Triggers';
      triggersSection.appendChild(nextTriggersTitle);
      triggersSection.appendChild(this._createTriggerEditor());

      highlightsSection.textContent = '';
      const nextHighlightsTitle = document.createElement('h3');
      nextHighlightsTitle.className = 'dw-heading';
      nextHighlightsTitle.textContent = 'Highlights';
      highlightsSection.appendChild(nextHighlightsTitle);
      highlightsSection.appendChild(this._createHighlightEditor());

      if (renderAliasesSection) renderAliasesSection();
      if (renderVariablesSection) renderVariablesSection();
    };

    activateTab('connection');
    body.appendChild(tabs);
    body.appendChild(tabPanels);

    const footer = document.createElement('div');
    footer.className = 'settings-modal-footer';

    const footerStatus = document.createElement('div');
    footerStatus.className = 'settings-footer-status';
    this._footerStatusEl = footerStatus;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'dw-button dw-button-secondary';
    exportBtn.textContent = 'Export settings';
    exportBtn.addEventListener('click', () => this._downloadSettingsBundle());

    const importBtn = document.createElement('button');
    importBtn.className = 'dw-button dw-button-secondary';
    importBtn.textContent = 'Import settings';
    importBtn.addEventListener('click', () => this._promptImportSettingsBundle());

    const closePanelBtn = document.createElement('button');
    closePanelBtn.className = 'dw-button dw-button-secondary';
    closePanelBtn.textContent = 'Close';
    closePanelBtn.addEventListener('click', () => this.close());

    const applyBtn = document.createElement('button');
    applyBtn.className = 'dw-button dw-button-secondary';
    applyBtn.dataset.focusKey = 'settings-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this._applyDraftChanges(false));

    const saveBtn = document.createElement('button');
    saveBtn.className = 'dw-button dw-button-primary';
    saveBtn.dataset.focusKey = 'settings-save';
    saveBtn.textContent = 'Save & Close';
    saveBtn.addEventListener('click', () => this._applyDraftChanges(true));

    footer.appendChild(footerStatus);
    footer.appendChild(exportBtn);
    footer.appendChild(importBtn);
    footer.appendChild(closePanelBtn);
    footer.appendChild(applyBtn);
    footer.appendChild(saveBtn);
    body.appendChild(footer);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    return overlay;
  },
};
