import { state, dom } from './state.js';
import { DEFAULT_OUTPUT_SCROLLBACK_PRESET, FG_NAMES } from './constants.js';
import { setOutputScrollbackPreset } from './output.js';
import { aliasManager } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { styleToElement } from './ansi.js';

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
  _aliasScopeKey: '',
  _draftAliasScope: null,
  _highlightScopeKey: '',
  _draftHighlightScope: null,
  _overlay: null,
  _escHandler: null,
  _dataSyncHandler: null,
  _refreshEditors: null,

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
    this._aliasScopeKey = aliasManager.getActiveScopeKey();
    this._draftAliasScope = aliasManager.getScopeSnapshot(this._aliasScopeKey);
    this._highlightScopeKey = highlightManager.getActiveScopeKey();
    this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);

    const overlay = this._buildModal();
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };

    document.addEventListener('keydown', escHandler);
    const dataSyncHandler = (event) => {
      const detail = event && event.detail ? event.detail : {};
      if (!this._overlay || !this._refreshEditors) return;
      if (detail.scopeKey && detail.scopeKey !== this._highlightScopeKey) return;
      this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);
      this._refreshEditors();
    };
    window.addEventListener('darkwind:highlight-data-changed', dataSyncHandler);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._escHandler = escHandler;
    this._dataSyncHandler = dataSyncHandler;
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
    if (this._dataSyncHandler) {
      window.removeEventListener('darkwind:highlight-data-changed', this._dataSyncHandler);
      this._dataSyncHandler = null;
    }
    this._draftSettings = {};
    this._draftAliasScope = null;
    this._aliasScopeKey = '';
    this._draftHighlightScope = null;
    this._highlightScopeKey = '';
    this._refreshEditors = null;
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

  _createColorSelect(value, onChange) {
    const select = document.createElement('select');
    select.className = 'dw-select';
    FG_NAMES.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      if (name === value) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    return select;
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

    const previewCard = document.createElement('div');
    previewCard.className = 'settings-mapper-editor settings-alias-preview-card';

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
      sidebar.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Highlight rules';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dw-input';
      search.placeholder = 'Search highlights';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        searchTerm = search.value;
        render();
      });

      const list = document.createElement('div');
      list.className = 'settings-alias-list';

      const filteredRules = this._draftHighlightScope.rules.filter((rule) => (
        rule.patternSource.toLowerCase().includes(searchTerm.trim().toLowerCase())
      ));

      filteredRules.forEach((rule) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-alias-list-item' + (rule.id === selectedRuleId ? ' active' : '');
        row.addEventListener('click', () => {
          selectedRuleId = rule.id;
          render();
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rule.enabled !== false;
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
          rule.enabled = checkbox.checked;
          render();
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
        row.appendChild(checkbox);
        row.appendChild(copy);
        list.appendChild(row);
      });

      if (!filteredRules.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = searchTerm ? 'No highlight rules match this filter.' : 'No highlight rules defined for this scope.';
        list.appendChild(empty);
      }

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
      });

      actions.appendChild(addBtn);
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);

      sidebar.appendChild(title);
      sidebar.appendChild(search);
      sidebar.appendChild(list);
      sidebar.appendChild(actions);
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

    const variableCard = document.createElement('div');
    variableCard.className = 'settings-mapper-editor settings-alias-variable-card';

    const previewCard = document.createElement('div');
    previewCard.className = 'settings-mapper-editor settings-alias-preview-card';

    let selectedAliasId = this._draftAliasScope.aliases[0] ? this._draftAliasScope.aliases[0].id : null;
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

      for (const step of match.alias.steps) {
        const row = document.createElement('div');
        row.className = 'settings-alias-preview-step';
        const resolved = aliasManager.resolveTemplate(step.template, {
          args: match.args,
          remainder: match.remainder,
          variables: previewVariables,
        });

        let prefix = 'Send';
        if (step.type === 'set_variable') prefix = 'Set $' + step.name;
        if (step.type === 'show_message') prefix = 'Show';

        row.textContent = prefix + ': ' + resolved.text;
        if (resolved.missingVariables.length) {
          row.classList.add('warning');
          row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
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

    const renderVariables = () => {
      variableCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Variables';

      const help = document.createElement('p');
      help.className = 'dw-paragraph settings-helper-text';
      help.textContent = 'Persistent variables back aliases like $pack. They can be edited here or written by alias steps.';

      variableCard.appendChild(title);
      variableCard.appendChild(help);

      const usage = aliasManager.collectAliasUsage(this._draftAliasScope);
      const list = document.createElement('div');
      list.className = 'settings-alias-variable-list';
      const entries = Object.entries(this._draftAliasScope.variables).sort((a, b) => a[0].localeCompare(b[0]));

      const addVariableRow = (name, value) => {
        let currentName = name;
        const row = document.createElement('div');
        row.className = 'settings-alias-variable-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dw-input';
        nameInput.placeholder = 'pack';
        nameInput.value = name;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'dw-input';
        valueInput.placeholder = 'mule';
        valueInput.value = value;

        const usageBadge = document.createElement('div');
        usageBadge.className = 'settings-alias-usage';
        usageBadge.textContent = (usage.get(name) || 0) + ' reference' + ((usage.get(name) || 0) === 1 ? '' : 's');

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          delete this._draftAliasScope.variables[currentName];
          render();
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
        row.appendChild(usageBadge);
        row.appendChild(removeBtn);
        list.appendChild(row);
      };

      entries.forEach(([name, value]) => addVariableRow(name, value));
      variableCard.appendChild(list);

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
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
      });

      actions.appendChild(addBtn);
      variableCard.appendChild(actions);
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
      triggerInput.placeholder = 'gi';
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
        { value: 'send_command', label: 'Send command' },
        { value: 'set_variable', label: 'Set variable' },
        { value: 'show_message', label: 'Show local message' },
      ];

      alias.steps.forEach((step, index) => {
        const stepCard = document.createElement('div');
        stepCard.className = 'settings-alias-step-card';

        const stepHeader = document.createElement('div');
        stepHeader.className = 'settings-alias-step-header';

        const stepSelect = document.createElement('select');
        stepSelect.className = 'dw-select';
        stepTypeOptions.forEach((option) => {
          const el = document.createElement('option');
          el.value = option.value;
          el.textContent = option.label;
          if (step.type === option.value) el.selected = true;
          stepSelect.appendChild(el);
        });
        stepSelect.addEventListener('change', () => {
          step.type = stepSelect.value;
          if (step.type !== 'set_variable') delete step.name;
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
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          alias.steps.splice(index, 1);
          if (!alias.steps.length) alias.steps.push({ type: 'send_command', template: '' });
          render();
        });

        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
        controls.appendChild(removeBtn);
        stepHeader.appendChild(stepSelect);
        stepHeader.appendChild(controls);
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

        const helper = document.createElement('div');
        helper.className = 'settings-helper-text';
        helper.textContent = 'Templates support %0 for the full remainder, %1-%9 for arguments, and $name for variables.';
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
        btn.textContent = option.label;
        btn.addEventListener('click', () => {
          const step = { type: option.value, template: '' };
          if (option.value === 'set_variable') step.name = '';
          alias.steps.push(step);
          render();
        });
        stepAddActions.appendChild(btn);
      });
      editor.appendChild(stepAddActions);
    };

    const renderAliasList = () => {
      sidebar.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'Aliases';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dw-input';
      search.placeholder = 'Search aliases';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        searchTerm = search.value;
        render();
      });

      const list = document.createElement('div');
      list.className = 'settings-alias-list';

      const filteredAliases = this._draftAliasScope.aliases.filter((alias) => {
        const haystack = (alias.trigger + ' ' + alias.description).toLowerCase();
        return haystack.includes(searchTerm.trim().toLowerCase());
      });

      filteredAliases.forEach((alias) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-alias-list-item' + (alias.id === selectedAliasId ? ' active' : '');
        row.addEventListener('click', () => {
          selectedAliasId = alias.id;
          render();
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = alias.enabled !== false;
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
          alias.enabled = checkbox.checked;
          render();
        });

        const copy = document.createElement('div');
        copy.className = 'settings-copy';

        const trigger = document.createElement('div');
        trigger.className = 'settings-label';
        trigger.textContent = alias.trigger || '(untitled)';

        const description = document.createElement('div');
        description.className = 'settings-alias-list-meta';
        description.textContent = alias.description || alias.steps.length + ' step' + (alias.steps.length === 1 ? '' : 's');

        copy.appendChild(trigger);
        copy.appendChild(description);
        row.appendChild(checkbox);
        row.appendChild(copy);
        list.appendChild(row);
      });

      if (!filteredAliases.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty';
        empty.textContent = searchTerm ? 'No aliases match this filter.' : 'No aliases defined for this scope.';
        list.appendChild(empty);
      }

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
      });

      actions.appendChild(addBtn);
      actions.appendChild(removeBtn);
      sidebar.appendChild(title);
      sidebar.appendChild(search);
      sidebar.appendChild(list);
      sidebar.appendChild(actions);
    };

    const render = () => {
      ensureSelectedAlias();
      renderAliasList();
      renderAliasDetail();
      renderVariables();
      renderPreview();
    };

    layout.appendChild(sidebar);
    layout.appendChild(editor);
    wrapper.appendChild(layout);
    wrapper.appendChild(variableCard);
    wrapper.appendChild(previewCard);

    render();
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
    const highlightsSection = createTab('highlights', 'Highlights');
    const aliasesSection = createTab('aliases', 'Aliases');

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

    const highlightsTitle = document.createElement('h3');
    highlightsTitle.className = 'dw-heading';
    highlightsTitle.textContent = 'Highlights';
    highlightsSection.appendChild(highlightsTitle);
    highlightsSection.appendChild(this._createHighlightEditor());

    const aliasesTitle = document.createElement('h3');
    aliasesTitle.className = 'dw-heading';
    aliasesTitle.textContent = 'Aliases';
    aliasesSection.appendChild(aliasesTitle);
    aliasesSection.appendChild(this._createAliasEditor());

    this._refreshEditors = () => {
      highlightsSection.textContent = '';
      const nextHighlightsTitle = document.createElement('h3');
      nextHighlightsTitle.className = 'dw-heading';
      nextHighlightsTitle.textContent = 'Highlights';
      highlightsSection.appendChild(nextHighlightsTitle);
      highlightsSection.appendChild(this._createHighlightEditor());
    };

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
      highlightManager.saveScope(this._highlightScopeKey, this._draftHighlightScope);
      aliasManager.saveScope(this._aliasScopeKey, this._draftAliasScope);
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
