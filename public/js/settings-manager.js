import { state, dom } from './state.js';
import { DEFAULT_OUTPUT_SCROLLBACK_PRESET } from './constants.js';
import { setOutputScrollbackPreset } from './output.js';

const SETTINGS_STORAGE_KEY = 'darkwind-client-settings';

export const settingsManager = {
  _defaults: {
    autoReconnect: true,
    repeatLastCommand: true,
    keyMapperEnabled: false,
    keyMappings: [],
    outputScrollbackPreset: DEFAULT_OUTPUT_SCROLLBACK_PRESET,
  },
  _settings: {},
  _draftSettings: {},
  _overlay: null,
  _escHandler: null,

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
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
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
    this.close();
    this._draftSettings = {
      ...this._settings,
      keyMappings: this._settings.keyMappings.map((mapping) => ({
        key: mapping.key,
        command: mapping.command,
      })),
    };

    const overlay = this._buildModal();
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };

    document.addEventListener('keydown', escHandler);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._escHandler = escHandler;
  },

  close() {
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this._draftSettings = {};
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
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
    this._save();
  },

  _normalizeSettings(settings) {
    return {
      autoReconnect: settings.autoReconnect !== false,
      repeatLastCommand: settings.repeatLastCommand !== false,
      keyMapperEnabled: Boolean(settings.keyMapperEnabled),
      keyMappings: this._normalizeKeyMappings(settings.keyMappings),
      outputScrollbackPreset: this._normalizeOutputScrollbackPreset(settings.outputScrollbackPreset),
    };
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

  _normalizeKeyMappings(mappings) {
    if (!Array.isArray(mappings)) return [];

    return mappings
      .map((mapping) => {
        if (!mapping || typeof mapping !== 'object') return null;
        const key = typeof mapping.key === 'string' ? mapping.key.trim() : '';
        const command = typeof mapping.command === 'string' ? mapping.command.trim() : '';
        if (!key || !command) return null;
        return { key, command };
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

  _createKeyMappingsEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-mapper-editor';

    const helpText = document.createElement('p');
    helpText.className = 'dw-paragraph settings-helper-text';
    helpText.textContent = 'Press a key in the Key field to capture it. Bound keys send their command instantly without pressing Enter.';

    const list = document.createElement('div');
    list.className = 'settings-mapping-list';

    const ensureMappings = () => {
      if (!Array.isArray(this._draftSettings.keyMappings)) {
        this._draftSettings.keyMappings = [];
      }
      return this._draftSettings.keyMappings;
    };

    const addRow = (mapping) => {
      const mappings = ensureMappings();
      mappings.push(mapping);

      const row = document.createElement('div');
      row.className = 'settings-mapping-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'dw-input settings-key-input';
      keyInput.placeholder = 'Press a key';
      keyInput.readOnly = true;
      keyInput.value = mapping.key;
      keyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Backspace' || event.key === 'Delete') {
          mapping.key = '';
          keyInput.value = '';
          return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;

        mapping.key = event.key;
        keyInput.value = event.key;
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
      });

      row.appendChild(keyInput);
      row.appendChild(commandInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
    };

    const savedMappings = ensureMappings().map((mapping) => ({
      key: mapping.key,
      command: mapping.command,
    }));
    this._draftSettings.keyMappings = [];
    savedMappings.forEach((mapping) => addRow(mapping));

    const actions = document.createElement('div');
    actions.className = 'settings-inline-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'dw-button dw-button-secondary settings-add-mapping';
    addBtn.textContent = 'Add mapping';
    addBtn.addEventListener('click', () => addRow({ key: '', command: '' }));

    actions.appendChild(addBtn);
    wrapper.appendChild(helpText);
    wrapper.appendChild(list);
    wrapper.appendChild(actions);

    return wrapper;
  },

  _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'dw-modal settings-modal';

    const header = document.createElement('div');
    header.className = 'dw-modal-header';

    const title = document.createElement('span');
    title.className = 'dw-modal-title';
    title.textContent = 'Settings';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dw-modal-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'dw-modal-body settings-modal-body';

    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';

    const tabPanels = document.createElement('div');
    tabPanels.className = 'settings-tab-panels';

    const tabButtons = new Map();
    const tabContents = new Map();
    const activateTab = (key) => {
      for (const [tabKey, btn] of tabButtons) {
        btn.classList.toggle('active', tabKey === key);
      }
      for (const [tabKey, panel] of tabContents) {
        panel.style.display = tabKey === key ? 'flex' : 'none';
      }
    };
    const createTab = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => activateTab(key));
      tabButtons.set(key, btn);
      tabs.appendChild(btn);

      const panel = document.createElement('section');
      panel.className = 'settings-section';
      panel.style.display = 'none';
      tabContents.set(key, panel);
      tabPanels.appendChild(panel);
      return panel;
    };

    const connectionSection = createTab('connection', 'Connection');
    const terminalSection = createTab('terminal', 'Terminal');
    const controlsSection = createTab('controls', 'Controls');

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

      const proto = dom.wssToggle.checked ? 'wss' : 'ws';
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

    activateTab('connection');
    body.appendChild(tabs);
    body.appendChild(tabPanels);

    const footer = document.createElement('div');
    footer.className = 'settings-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dw-button dw-button-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'dw-button dw-button-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      this._applySettings(this._draftSettings);
      this.close();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    body.appendChild(footer);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    return overlay;
  },
};
