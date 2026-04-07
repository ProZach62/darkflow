import { state, dom } from './state.js';

const SETTINGS_STORAGE_KEY = 'darkwind-client-settings';

export const settingsManager = {
  _defaults: {
    autoReconnect: true,
    repeatLastCommand: true,
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

    state.settings = { ...this._settings };
  },

  get(key) {
    if (Object.prototype.hasOwnProperty.call(this._settings, key)) {
      return this._settings[key];
    }
    return this._defaults[key];
  },

  set(key, value) {
    this._settings[key] = value;
    state.settings[key] = value;
    this._save();
  },

  open() {
    this.close();
    this._draftSettings = { ...this._settings };

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
    modal.style.width = '460px';

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

    const connectionSection = document.createElement('section');
    connectionSection.className = 'settings-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'dw-heading';
    sectionTitle.textContent = 'Connection';

    const autoReconnectRow = document.createElement('label');
    autoReconnectRow.className = 'settings-checkbox-row';

    const autoReconnectInput = document.createElement('input');
    autoReconnectInput.type = 'checkbox';
    autoReconnectInput.checked = !!this._draftSettings.autoReconnect;
    autoReconnectInput.addEventListener('change', () => {
      this._draftSettings.autoReconnect = autoReconnectInput.checked;
    });

    const autoReconnectText = document.createElement('div');
    autoReconnectText.className = 'settings-copy';

    const autoReconnectLabel = document.createElement('div');
    autoReconnectLabel.className = 'settings-label';
    autoReconnectLabel.textContent = 'Auto-reconnect';

    const autoReconnectDescription = document.createElement('p');
    autoReconnectDescription.className = 'dw-paragraph';
    autoReconnectDescription.textContent = 'Reconnect automatically after unexpected connection loss.';

    autoReconnectText.appendChild(autoReconnectLabel);
    autoReconnectText.appendChild(autoReconnectDescription);
    autoReconnectRow.appendChild(autoReconnectInput);
    autoReconnectRow.appendChild(autoReconnectText);

    connectionSection.appendChild(sectionTitle);
    connectionSection.appendChild(autoReconnectRow);

    const repeatLastCommandRow = document.createElement('label');
    repeatLastCommandRow.className = 'settings-checkbox-row';

    const repeatLastCommandInput = document.createElement('input');
    repeatLastCommandInput.type = 'checkbox';
    repeatLastCommandInput.checked = !!this._draftSettings.repeatLastCommand;
    repeatLastCommandInput.addEventListener('change', () => {
      this._draftSettings.repeatLastCommand = repeatLastCommandInput.checked;
    });

    const repeatLastCommandText = document.createElement('div');
    repeatLastCommandText.className = 'settings-copy';

    const repeatLastCommandLabel = document.createElement('div');
    repeatLastCommandLabel.className = 'settings-label';
    repeatLastCommandLabel.textContent = 'Keep last command selected after send';

    const repeatLastCommandDescription = document.createElement('p');
    repeatLastCommandDescription.className = 'dw-paragraph';
    repeatLastCommandDescription.textContent = 'Keep the last command in the input selected so Enter repeats it and typing replaces it.';

    repeatLastCommandText.appendChild(repeatLastCommandLabel);
    repeatLastCommandText.appendChild(repeatLastCommandDescription);
    repeatLastCommandRow.appendChild(repeatLastCommandInput);
    repeatLastCommandRow.appendChild(repeatLastCommandText);

    connectionSection.appendChild(repeatLastCommandRow);

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

    body.appendChild(connectionSection);

    const divider = document.createElement('hr');
    divider.className = 'dw-divider';
    body.appendChild(divider);

    const futureSection = document.createElement('section');
    futureSection.className = 'settings-section settings-section-muted';

    const futureCopy = document.createElement('p');
    futureCopy.className = 'dw-paragraph';
    futureCopy.textContent = 'More client settings can be added here as the UI expands.';

    futureSection.appendChild(futureCopy);
    body.appendChild(futureSection);

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
      Object.keys(this._draftSettings).forEach((key) => {
        this.set(key, this._draftSettings[key]);
      });
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
