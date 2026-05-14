import { dom } from './state.js';
import {
  evaluateArithmeticExpression,
  isArithmeticExpressionCandidate,
} from './alias-expression-core.mjs';

const ALIAS_STORAGE_KEY = 'darkwind-client-aliases-v1';
const MAX_ALIAS_DEPTH = 10;

function createId() {
  return 'alias-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function tokenizeInput(line) {
  const tokens = [];
  const text = String(line || '');
  const length = text.length;
  let index = 0;

  while (index < length) {
    while (index < length && /\s/.test(text[index])) index++;
    if (index >= length) break;

    const start = index;
    let value = '';
    let quote = null;

    while (index < length) {
      const ch = text[index];
      if (quote) {
        if (ch === '\\' && index + 1 < length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
          index++;
          continue;
        }
        value += ch;
        index++;
        continue;
      }

      if (ch === '"' || ch === '\'') {
        quote = ch;
        index++;
        continue;
      }

      if (/\s/.test(ch)) break;

      if (ch === '\\' && index + 1 < length) {
        value += text[index + 1];
        index += 2;
        continue;
      }

      value += ch;
      index++;
    }

    tokens.push({
      value,
      start,
      end: index,
      lower: value.toLowerCase(),
    });
  }

  return tokens;
}

function emitAliasDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:alias-data-changed', {
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

  if (type === 'set_trigger_enabled') {
    const mode = step.mode === 'enable' || step.mode === 'disable' ? step.mode : 'toggle';
    return { type, mode, target: String(step.target || '') };
  }

  return { type: 'send_command', template: String(step.template || '') };
}

function normalizeAlias(alias) {
  if (!alias || typeof alias !== 'object') return null;
  const trigger = normalizeWhitespace(alias.trigger);
  if (!trigger) return null;

  const steps = Array.isArray(alias.steps)
    ? alias.steps.map(normalizeStep).filter(Boolean)
    : [];

  return {
    id: typeof alias.id === 'string' && alias.id ? alias.id : createId(),
    enabled: alias.enabled !== false,
    trigger,
    description: String(alias.description || ''),
    group: normalizeWhitespace(alias.group),
    steps: steps.length ? steps : [{ type: 'send_command', template: '' }],
  };
}

function normalizeVariables(variables) {
  const normalized = {};
  if (!variables || typeof variables !== 'object') return normalized;

  for (const [key, value] of Object.entries(variables)) {
    const name = normalizeWhitespace(key);
    if (!name) continue;
    normalized[name] = String(value ?? '');
  }

  return normalized;
}

function normalizeScope(scope) {
  const aliases = Array.isArray(scope && scope.aliases)
    ? scope.aliases.map(normalizeAlias).filter(Boolean)
    : [];

  return {
    aliases,
    variables: normalizeVariables(scope && scope.variables),
  };
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

function compareAliasPriority(a, b) {
  const aTokens = tokenizeInput(a.trigger).length;
  const bTokens = tokenizeInput(b.trigger).length;
  if (aTokens !== bTokens) return bTokens - aTokens;
  return b.trigger.length - a.trigger.length;
}

function resolveTemplateToken(token, context, missingVariables) {
  const value = String(token || '');

  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    const variableName = value.slice(1);
    if (!Object.prototype.hasOwnProperty.call(context.variables, variableName)) {
      missingVariables.add(variableName);
      return '';
    }
    return String(context.variables[variableName] ?? '');
  }

  if (/^%[0-9]$/.test(value)) {
    if (value === '%0') return context.remainder || '';

    const index = Number(value.slice(1)) - 1;
    if (index < 0 || index >= context.args.length) return '';
    return context.args[index];
  }

  return value;
}

function collectVariableNamesFromText(text) {
  return (String(text || '').match(/\$([A-Za-z_][A-Za-z0-9_]*)/g) || [])
    .map((match) => match.slice(1));
}

export const aliasManager = {
  _data: { scopes: {} },

  init() {
    try {
      const raw = localStorage.getItem(ALIAS_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load aliases', error);
    }

    this._data = { scopes: {} };
  },

  _save(detail = null) {
    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(this._data));
      emitAliasDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save aliases', error);
    }
  },

  getMaxAliasDepth() {
    return MAX_ALIAS_DEPTH;
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
      this._data.scopes[scopeKey] = { aliases: [], variables: {} };
    }
    return this._data.scopes[scopeKey];
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      aliases: scope.aliases.map((alias) => ({
        ...alias,
        steps: alias.steps.map((step) => ({ ...step })),
      })),
      variables: { ...scope.variables },
    };
  },

  saveScope(scopeKey, scope) {
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
  },

  createEmptyAlias() {
    return {
      id: createId(),
      enabled: true,
      trigger: '',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: '' }],
    };
  },

  listVariableNames(scopeKey = this.getActiveScopeKey()) {
    return Object.keys(this._ensureScope(scopeKey).variables).sort((a, b) => a.localeCompare(b));
  },

  getVariable(name, scopeKey = this.getActiveScopeKey()) {
    return this._ensureScope(scopeKey).variables[name];
  },

  setVariable(name, value, scopeKey = this.getActiveScopeKey()) {
    const cleanName = normalizeWhitespace(name);
    if (!cleanName) return false;
    this._ensureScope(scopeKey).variables[cleanName] = String(value ?? '');
    this._save({ scopeKey });
    return true;
  },

  removeVariable(name, scopeKey = this.getActiveScopeKey()) {
    if (!name) return;
    delete this._ensureScope(scopeKey).variables[name];
    this._save({ scopeKey });
  },

  findAliasByTrigger(trigger, scopeKey = this.getActiveScopeKey()) {
    const normalizedTrigger = normalizeWhitespace(trigger).toLowerCase();
    if (!normalizedTrigger) return null;
    return this._ensureScope(scopeKey).aliases.find((alias) => (
      normalizeWhitespace(alias.trigger).toLowerCase() === normalizedTrigger
    )) || null;
  },

  upsertSimpleAlias(trigger, template, scopeKey = this.getActiveScopeKey()) {
    const normalizedTrigger = normalizeWhitespace(trigger);
    if (!normalizedTrigger) return null;

    const scope = this._ensureScope(scopeKey);
    const existing = this.findAliasByTrigger(normalizedTrigger, scopeKey);
    const normalizedTemplate = String(template || '').trim();
    const alias = existing || {
      id: createId(),
      enabled: true,
      trigger: normalizedTrigger,
      description: '',
      steps: [],
    };

    alias.enabled = true;
    alias.trigger = normalizedTrigger;
    alias.steps = [{ type: 'send_command', template: normalizedTemplate }];

    if (!existing) {
      scope.aliases.push(alias);
    }

    this._save({ scopeKey });
    return {
      ...alias,
      steps: alias.steps.map((step) => ({ ...step })),
    };
  },

  removeAliasByTrigger(trigger, scopeKey = this.getActiveScopeKey()) {
    const normalizedTrigger = normalizeWhitespace(trigger).toLowerCase();
    if (!normalizedTrigger) return false;

    const scope = this._ensureScope(scopeKey);
    const nextAliases = scope.aliases.filter((alias) => (
      normalizeWhitespace(alias.trigger).toLowerCase() !== normalizedTrigger
    ));

    if (nextAliases.length === scope.aliases.length) return false;
    scope.aliases = nextAliases;
    this._save({ scopeKey });
    return true;
  },

  setEnabledByTarget(trigger, enabled, scopeKey = this.getActiveScopeKey()) {
    const alias = this.findAliasByTrigger(trigger, scopeKey);
    if (!alias) return { target: null, enabled: null };
    alias.enabled = enabled !== false;
    this._save({ scopeKey });
    return { target: alias, enabled: alias.enabled };
  },

  toggleEnabledByTarget(trigger, scopeKey = this.getActiveScopeKey()) {
    const alias = this.findAliasByTrigger(trigger, scopeKey);
    if (!alias) return { target: null, enabled: null };
    alias.enabled = alias.enabled === false;
    this._save({ scopeKey });
    return { target: alias, enabled: alias.enabled };
  },

  matchAliasInAliases(rawLine, aliases) {
    const line = String(rawLine || '');
    const inputTokens = tokenizeInput(line);
    if (!inputTokens.length) return null;

    const candidates = (Array.isArray(aliases) ? aliases : [])
      .filter((alias) => alias.enabled !== false)
      .slice()
      .sort(compareAliasPriority);

    for (const alias of candidates) {
      const triggerTokens = tokenizeInput(alias.trigger);
      if (!triggerTokens.length || triggerTokens.length > inputTokens.length) continue;

      let matches = true;
      for (let index = 0; index < triggerTokens.length; index++) {
        if (triggerTokens[index].lower !== inputTokens[index].lower) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      const remainderToken = inputTokens[triggerTokens.length];
      const remainder = remainderToken ? line.slice(remainderToken.start).trimStart() : '';
      const args = inputTokens.slice(triggerTokens.length).map((token) => token.value);

      return {
        alias,
        args,
        remainder,
      };
    }

    return null;
  },

  matchAlias(rawLine, scopeKey = this.getActiveScopeKey()) {
    return this.matchAliasInAliases(rawLine, this._ensureScope(scopeKey).aliases);
  },

  resolveTemplate(template, context) {
    const missingVariables = new Set();
    const errors = [];
    const normalizedContext = {
      args: Array.isArray(context && context.args) ? context.args : [],
      remainder: context && typeof context.remainder === 'string' ? context.remainder : '',
      variables: context && context.variables && typeof context.variables === 'object' ? context.variables : {},
    };
    const text = String(template || '')
      .replace(/\$\{lower:([^}]+)\}/g, (match, token) => (
        resolveTemplateToken(String(token || '').trim(), normalizedContext, missingVariables).toLowerCase()
      ))
      .replace(/\{([^{}]+)\}/g, (match, expression) => {
        const trimmedExpression = String(expression || '').trim();
        if (!isArithmeticExpressionCandidate(trimmedExpression)) return match;

        const result = evaluateArithmeticExpression(trimmedExpression, normalizedContext, missingVariables);
        if (result.errors.length) {
          errors.push(...result.errors);
          return '';
        }

        return result.text;
      })
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)|%([0-9])/g, (match, variableName, argIndex) => (
        resolveTemplateToken(variableName ? '$' + variableName : '%' + argIndex, normalizedContext, missingVariables)
      ));

    return {
      text,
      missingVariables: Array.from(missingVariables),
      errors,
    };
  },

  getAliasDiagnostics(scope, aliasId) {
    const aliases = Array.isArray(scope && scope.aliases) ? scope.aliases : [];
    const alias = aliases.find((item) => item.id === aliasId);
    if (!alias) return [];

    const diagnostics = [];
    const normalizedTrigger = normalizeWhitespace(alias.trigger).toLowerCase();
    if (!normalizedTrigger) {
      diagnostics.push('Trigger is required.');
    } else {
      const duplicate = aliases.find((item) => item.id !== alias.id && normalizeWhitespace(item.trigger).toLowerCase() === normalizedTrigger);
      if (duplicate) diagnostics.push('Trigger conflicts with another alias in this scope.');
    }

    if (!Array.isArray(alias.steps) || alias.steps.length === 0) {
      diagnostics.push('At least one step is required.');
      return diagnostics;
    }

    for (let index = 0; index < alias.steps.length; index++) {
      const step = alias.steps[index];
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
      if (step.type === 'set_trigger_enabled' && !String(step.target || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must choose a trigger target.');
      }
    }

    return diagnostics;
  },

  collectAliasUsage(scope) {
    const usage = new Map();
    const aliases = Array.isArray(scope && scope.aliases) ? scope.aliases : [];

    for (const alias of aliases) {
      for (const step of alias.steps || []) {
        for (const name of collectVariableNamesFromText(step.template)) {
          const count = usage.get(name) || 0;
          usage.set(name, count + 1);
        }
        for (const name of collectVariableNamesFromText(step.target)) {
          const count = usage.get(name) || 0;
          usage.set(name, count + 1);
        }
      }
    }

    return usage;
  },

  collectAliasUsageDetails(scope) {
    const usage = new Map();
    const aliases = Array.isArray(scope && scope.aliases) ? scope.aliases : [];

    for (const alias of aliases) {
      const names = new Set();
      for (const step of alias.steps || []) {
        collectVariableNamesFromText(step.template).forEach((name) => names.add(name));
        collectVariableNamesFromText(step.target).forEach((name) => names.add(name));
      }

      for (const name of names) {
        if (!usage.has(name)) usage.set(name, []);
        usage.get(name).push({
          id: alias.id,
          trigger: alias.trigger || '(untitled)',
          description: alias.description || '',
        });
      }
    }

    return usage;
  },
};

export { tokenizeInput };
