import { dom } from './state.js';
import { getSoundCatalog, isKnownSound } from './sound-manager.js';
import { getAutomationScriptDiagnostics } from './automation-script-core.mjs';

const TRIGGER_STORAGE_KEY = 'darkwind-client-triggers-v1';

function createId() {
  return 'trigger-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeTriggerMatchText(value) {
  return String(value || '').replace(/^>\s?/, '');
}

function normalizeVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

function formatSoundStep(step) {
  const match = getSoundCatalog().find((item) => (
    item.category === step.category && item.sound === step.sound
  ));
  if (match) return match.label;
  return [step.category, step.sound].filter(Boolean).join(' / ') || 'sound';
}

function emitTriggerDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:trigger-data-changed', {
    detail: detail || null,
  }));
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  const type = typeof step.type === 'string' ? step.type : 'send_command';

  if (type === 'set_variable') {
    const name = normalizeWhitespace(step.name);
    return name
      ? { type, name, template: String(step.template || '') }
      : null;
  }

  if (type === 'show_message') {
    return { type, template: String(step.template || '') };
  }

  if (type === 'script') {
    return { type, script: String(step.script || '') };
  }

  if (type === 'set_alias_enabled') {
    const mode = step.mode === 'enable' || step.mode === 'disable' ? step.mode : 'toggle';
    return { type, mode, target: String(step.target || ''), targetId: String(step.targetId || '') };
  }

  if (type === 'play_sound') {
    return {
      type,
      category: normalizeWhitespace(step.category),
      sound: normalizeWhitespace(step.sound),
      volume: normalizeVolume(step.volume),
    };
  }

  if (type === 'run_alias') {
    return { type, template: String(step.template || '') };
  }

  return { type: 'send_command', template: String(step.template || '') };
}

function normalizeTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') return null;
  const pattern = String(trigger.pattern || '').trim();
  if (!pattern) return null;

  const steps = Array.isArray(trigger.steps)
    ? trigger.steps.map(normalizeStep).filter(Boolean)
    : [];

  return {
    id: typeof trigger.id === 'string' && trigger.id ? trigger.id : createId(),
    enabled: trigger.enabled !== false,
    pattern,
    isRegex: Boolean(trigger.isRegex),
    ignoreCase: Boolean(trigger.ignoreCase),
    description: String(trigger.description || ''),
    group: normalizeWhitespace(trigger.group),
    gag: Boolean(trigger.gag),
    steps: steps.length ? steps : [{ type: 'send_command', template: '' }],
  };
}

function normalizeScope(scope) {
  const triggers = Array.isArray(scope && scope.triggers)
    ? scope.triggers.map(normalizeTrigger).filter(Boolean)
    : [];

  return { triggers };
}

function normalizeData(data) {
  const scopes = {};
  if (data && typeof data === 'object' && data.scopes && typeof data.scopes === 'object') {
    for (const [scopeKey, scope] of Object.entries(data.scopes)) {
      scopes[scopeKey] = normalizeScope(scope);
    }
  }
  return { scopes };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRegexPattern(pattern, ignoreCase) {
  const source = String(pattern || '').trim();
  if (!source) return { regex: null, error: 'Trigger pattern is required.' };

  try {
    return {
      regex: new RegExp(source, ignoreCase ? 'i' : ''),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : 'Invalid regex.',
    };
  }
}

function compilePattern(pattern, options = {}) {
  const source = String(pattern || '').trim();
  if (!source) return { regex: null, error: 'Trigger pattern is required.' };
  if (options.isRegex) return compileRegexPattern(source, options.ignoreCase);

  let compiled = '^';
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '*') {
      compiled += '(.*?)';
      index++;
      continue;
    }
    if (ch === '%' && /[1-9]/.test(source[index + 1] || '')) {
      compiled += '(.*?)';
      index += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      while (index < source.length && /\s/.test(source[index])) index++;
      compiled += '\\s+';
      continue;
    }
    compiled += escapeRegex(ch);
    index++;
  }
  compiled += '$';

  try {
    return {
      regex: new RegExp(compiled),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : 'Invalid trigger pattern.',
    };
  }
}

export const triggerManager = {
  _data: { scopes: {} },

  init() {
    try {
      const raw = localStorage.getItem(TRIGGER_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load triggers', error);
    }

    this._data = { scopes: {} };
  },

  _save(detail = null) {
    try {
      localStorage.setItem(TRIGGER_STORAGE_KEY, JSON.stringify(this._data));
      emitTriggerDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save triggers', error);
    }
  },

  getActiveScopeKey() {
    const host = normalizeWhitespace(dom.host && dom.host.value ? dom.host.value : '').toLowerCase() || 'default';
    const port = normalizeWhitespace(dom.port && dom.port.value ? dom.port.value : '') || '4242';
    // Preserve existing scope keys: secure (wss/telnets) → 'wss', plain → 'ws'.
    const sel = dom.protocolSelect && dom.protocolSelect.value;
    const protocol = (sel === 'wss' || sel === 'telnets') ? 'wss' : 'ws';
    return protocol + '://' + host + ':' + port;
  },

  _ensureScope(scopeKey) {
    if (!this._data.scopes[scopeKey]) {
      this._data.scopes[scopeKey] = { triggers: [] };
    }
    return this._data.scopes[scopeKey];
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      triggers: scope.triggers.map((trigger) => ({
        ...trigger,
        steps: trigger.steps.map((step) => ({ ...step })),
      })),
    };
  },

  saveScope(scopeKey, scope) {
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
  },

  createEmptyTrigger() {
    return {
      id: createId(),
      enabled: true,
      pattern: '',
      isRegex: false,
      ignoreCase: false,
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: '' }],
    };
  },

  findTriggerByPattern(pattern, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(pattern || '').trim();
    if (!normalizedPattern) return null;
    return this._ensureScope(scopeKey).triggers.find((trigger) => trigger.pattern === normalizedPattern) || null;
  },

  upsertSimpleTrigger(pattern, template, scopeKey = this.getActiveScopeKey(), options = {}) {
    const normalizedPattern = String(pattern || '').trim();
    const normalizedTemplate = String(template || '').trim();
    const isRegex = options.isRegex === true;
    const ignoreCase = options.ignoreCase === true;
    if (!normalizedPattern) {
      return { trigger: null, error: 'Trigger pattern is required.' };
    }
    if (!normalizedTemplate) {
      return { trigger: null, error: 'Trigger action is required.' };
    }

    const compiled = compilePattern(normalizedPattern, { isRegex, ignoreCase });
    if (compiled.error) {
      return { trigger: null, error: compiled.error };
    }

    const scope = this._ensureScope(scopeKey);
    const existing = this.findTriggerByPattern(normalizedPattern, scopeKey);
    const trigger = existing || this.createEmptyTrigger();

    trigger.enabled = true;
    trigger.pattern = normalizedPattern;
    trigger.isRegex = isRegex;
    trigger.ignoreCase = ignoreCase;
    trigger.gag = false;
    trigger.steps = [{ type: 'send_command', template: normalizedTemplate }];

    if (!existing) {
      scope.triggers.push(trigger);
    }

    this._save({ scopeKey });
    return {
      trigger: {
        ...trigger,
        steps: trigger.steps.map((step) => ({ ...step })),
      },
      error: null,
    };
  },

  removeTriggerByPattern(pattern, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(pattern || '').trim();
    if (!normalizedPattern) return false;

    const scope = this._ensureScope(scopeKey);
    const nextTriggers = scope.triggers.filter((trigger) => trigger.pattern !== normalizedPattern);
    if (nextTriggers.length === scope.triggers.length) return false;
    scope.triggers = nextTriggers;
    this._save({ scopeKey });
    return true;
  },

  setEnabledByTarget(pattern, enabled, scopeKey = this.getActiveScopeKey()) {
    const trigger = this.findTriggerByPattern(pattern, scopeKey);
    if (!trigger) return { target: null, enabled: null };
    trigger.enabled = enabled !== false;
    this._save({ scopeKey });
    return { target: trigger, enabled: trigger.enabled };
  },

  findTriggerById(id, scopeKey = this.getActiveScopeKey()) {
    const key = String(id || '');
    if (!key) return null;
    return this._ensureScope(scopeKey).triggers.find((trigger) => trigger.id === key) || null;
  },

  setEnabledById(id, enabled, scopeKey = this.getActiveScopeKey()) {
    const trigger = this.findTriggerById(id, scopeKey);
    if (!trigger) return { target: null, enabled: null };
    trigger.enabled = enabled !== false;
    this._save({ scopeKey });
    return { target: trigger, enabled: trigger.enabled };
  },

  toggleEnabledById(id, scopeKey = this.getActiveScopeKey()) {
    const trigger = this.findTriggerById(id, scopeKey);
    if (!trigger) return { target: null, enabled: null };
    trigger.enabled = trigger.enabled === false;
    this._save({ scopeKey });
    return { target: trigger, enabled: trigger.enabled };
  },

  toggleEnabledByTarget(pattern, scopeKey = this.getActiveScopeKey()) {
    const trigger = this.findTriggerByPattern(pattern, scopeKey);
    if (!trigger) return { target: null, enabled: null };
    trigger.enabled = trigger.enabled === false;
    this._save({ scopeKey });
    return { target: trigger, enabled: trigger.enabled };
  },

  getTriggerDiagnostics(scope, triggerId) {
    const triggers = Array.isArray(scope && scope.triggers) ? scope.triggers : [];
    const trigger = triggers.find((item) => item.id === triggerId);
    if (!trigger) return [];

    const diagnostics = [];
    if (!String(trigger.pattern || '').trim()) {
      diagnostics.push('Pattern is required.');
    }

    if (!String(trigger.description || '').trim()) {
      diagnostics.push('Name is required.');
    }

    const duplicate = triggers.find((item) => (
      item.id !== trigger.id
      && Boolean(item.isRegex) === Boolean(trigger.isRegex)
      && item.pattern === trigger.pattern
    ));
    if (duplicate) {
      diagnostics.push('Pattern conflicts with another trigger in this scope.');
    }

    const compiled = compilePattern(trigger.pattern, {
      isRegex: trigger.isRegex,
      ignoreCase: trigger.ignoreCase,
    });
    if (compiled.error) {
      diagnostics.push(compiled.error);
    }

    if (!Array.isArray(trigger.steps) || !trigger.steps.length) {
      diagnostics.push('At least one step is required.');
      return diagnostics;
    }

    for (let index = 0; index < trigger.steps.length; index++) {
      const step = trigger.steps[index];
      if (!step || !step.type) {
        diagnostics.push('Step ' + (index + 1) + ' is invalid.');
        continue;
      }
      if (step.type === 'set_variable' && !normalizeWhitespace(step.name)) {
        diagnostics.push('Step ' + (index + 1) + ' must choose a variable name.');
      }
      if ((step.type === 'send_command' || step.type === 'show_message' || step.type === 'set_variable')
        && !String(step.template || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must have content.');
      }
      if (step.type === 'script') {
        const scriptDiagnostics = getAutomationScriptDiagnostics(step.script || '');
        scriptDiagnostics.forEach((message) => {
          diagnostics.push('Step ' + (index + 1) + ': ' + message);
        });
      }
      if (step.type === 'set_alias_enabled'
        && !String(step.targetId || '').trim() && !String(step.target || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must select an alias.');
      }
      if (step.type === 'run_alias' && !String(step.template || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must choose an alias command.');
      }
      if (step.type === 'play_sound') {
        if (!String(step.category || '').trim() || !String(step.sound || '').trim()) {
          diagnostics.push('Step ' + (index + 1) + ' must choose a sound.');
        } else if (!isKnownSound(step.category, step.sound)) {
          diagnostics.push('Step ' + (index + 1) + ' uses a sound Darkflow does not know.');
        }
      }
    }

    return diagnostics;
  },

  describeTrigger(trigger) {
    if (!trigger) return '';
    const firstStep = trigger.steps && trigger.steps[0];
    let action = trigger.steps.length + ' step' + (trigger.steps.length === 1 ? '' : 's');
    if (firstStep && firstStep.template) action = firstStep.template;
    if (firstStep && firstStep.type === 'play_sound') action = 'Play sound: ' + formatSoundStep(firstStep);
    return '{' + trigger.pattern + '}'
      + (trigger.isRegex ? ' [regex' + (trigger.ignoreCase ? ', ignore case' : '') + ']' : '')
      + ' -> ' + action + (trigger.gag ? ' [gag]' : '');
  },

  getCompiledTriggers(scopeKey = this.getActiveScopeKey(), scopeOverride = null) {
    const sourceScope = scopeOverride ? normalizeScope(scopeOverride) : this._ensureScope(scopeKey);
    return sourceScope.triggers
      .filter((trigger) => trigger.enabled !== false)
      .map((trigger) => {
        const compiled = compilePattern(trigger.pattern, {
          isRegex: trigger.isRegex,
          ignoreCase: trigger.ignoreCase,
        });
        return {
          ...trigger,
          regex: compiled.regex,
          error: compiled.error,
        };
      })
      .filter((trigger) => trigger.regex);
  },

  evaluateLine(text, scopeKey = this.getActiveScopeKey(), scopeOverride = null) {
    const compiledTriggers = this.getCompiledTriggers(scopeKey, scopeOverride);
    if (!compiledTriggers.length) {
      return { matches: [], gag: false };
    }

    const line = normalizeTriggerMatchText(text);
    const matches = [];
    let gag = false;

    for (const trigger of compiledTriggers) {
      trigger.regex.lastIndex = 0;
      const match = trigger.regex.exec(line);
      if (!match) continue;

      matches.push({
        trigger,
        fullMatch: String(match[0] ?? line),
        captures: match.slice(1).map((value) => String(value ?? '')),
      });
      if (trigger.gag) gag = true;
    }

    return { matches, gag };
  },
};
