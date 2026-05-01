import { dom } from './state.js';

const TRIGGER_STORAGE_KEY = 'darkwind-client-triggers-v1';

function createId() {
  return 'trigger-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
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

function compilePattern(pattern) {
  const source = String(pattern || '').trim();
  if (!source) return { regex: null, error: 'Trigger pattern is required.' };

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

  upsertSimpleTrigger(pattern, template, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(pattern || '').trim();
    const normalizedTemplate = String(template || '').trim();
    if (!normalizedPattern) {
      return { trigger: null, error: 'Trigger pattern is required.' };
    }
    if (!normalizedTemplate) {
      return { trigger: null, error: 'Trigger action is required.' };
    }

    const compiled = compilePattern(normalizedPattern);
    if (compiled.error) {
      return { trigger: null, error: compiled.error };
    }

    const scope = this._ensureScope(scopeKey);
    const existing = this.findTriggerByPattern(normalizedPattern, scopeKey);
    const trigger = existing || this.createEmptyTrigger();

    trigger.enabled = true;
    trigger.pattern = normalizedPattern;
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

  getTriggerDiagnostics(scope, triggerId) {
    const triggers = Array.isArray(scope && scope.triggers) ? scope.triggers : [];
    const trigger = triggers.find((item) => item.id === triggerId);
    if (!trigger) return [];

    const diagnostics = [];
    if (!String(trigger.pattern || '').trim()) {
      diagnostics.push('Pattern is required.');
    }

    const duplicate = triggers.find((item) => item.id !== trigger.id && item.pattern === trigger.pattern);
    if (duplicate) {
      diagnostics.push('Pattern conflicts with another trigger in this scope.');
    }

    const compiled = compilePattern(trigger.pattern);
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
    }

    return diagnostics;
  },

  describeTrigger(trigger) {
    if (!trigger) return '';
    const action = trigger.steps && trigger.steps[0] && trigger.steps[0].template
      ? trigger.steps[0].template
      : trigger.steps.length + ' step' + (trigger.steps.length === 1 ? '' : 's');
    return '{' + trigger.pattern + '} -> ' + action + (trigger.gag ? ' [gag]' : '');
  },

  getCompiledTriggers(scopeKey = this.getActiveScopeKey(), scopeOverride = null) {
    const sourceScope = scopeOverride ? normalizeScope(scopeOverride) : this._ensureScope(scopeKey);
    return sourceScope.triggers
      .filter((trigger) => trigger.enabled !== false)
      .map((trigger) => {
        const compiled = compilePattern(trigger.pattern);
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

    const line = String(text || '');
    const matches = [];
    let gag = false;

    for (const trigger of compiledTriggers) {
      const match = trigger.regex.exec(line);
      if (!match) continue;

      matches.push({
        trigger,
        fullMatch: line,
        captures: match.slice(1).map((value) => String(value ?? '')),
      });
      if (trigger.gag) gag = true;
    }

    return { matches, gag };
  },
};
