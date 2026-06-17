import { dom } from './state.js';
import { getAutomationScriptDiagnostics } from './automation-script-core.mjs';

const FUNCTION_STORAGE_KEY = 'darkwind-client-functions-v1';
const MAX_FUNCTION_DEPTH = 10;

function createId() {
  return 'function-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeFunctionName(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function isValidFunctionName(value) {
  return /^[a-z_][a-z0-9_-]*$/.test(String(value || ''));
}

function emitFunctionDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:function-data-changed', {
    detail: detail || null,
  }));
}

function normalizeFunction(fn) {
  if (!fn || typeof fn !== 'object') return null;
  const name = normalizeFunctionName(fn.name);
  if (!name) return null;

  return {
    id: typeof fn.id === 'string' && fn.id ? fn.id : createId(),
    enabled: fn.enabled !== false,
    name,
    description: String(fn.description || ''),
    group: normalizeWhitespace(fn.group),
    script: String(fn.script || ''),
  };
}

function normalizeScope(scope) {
  const functions = Array.isArray(scope && scope.functions)
    ? scope.functions.map(normalizeFunction).filter(Boolean)
    : [];
  return { functions };
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

function cloneFunction(fn) {
  return { ...fn };
}

export const functionManager = {
  _data: { scopes: {} },

  init() {
    try {
      const raw = localStorage.getItem(FUNCTION_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load functions', error);
    }

    this._data = { scopes: {} };
  },

  _save(detail = null) {
    try {
      localStorage.setItem(FUNCTION_STORAGE_KEY, JSON.stringify(this._data));
      emitFunctionDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save functions', error);
    }
  },

  getMaxFunctionDepth() {
    return MAX_FUNCTION_DEPTH;
  },

  getActiveScopeKey() {
    const host = normalizeWhitespace(dom.host && dom.host.value ? dom.host.value : '').toLowerCase() || 'default';
    const port = normalizeWhitespace(dom.port && dom.port.value ? dom.port.value : '') || '4242';
    const sel = dom.protocolSelect && dom.protocolSelect.value;
    const protocol = (sel === 'wss' || sel === 'telnets') ? 'wss' : 'ws';
    return protocol + '://' + host + ':' + port;
  },

  _ensureScope(scopeKey) {
    if (!this._data.scopes[scopeKey]) {
      this._data.scopes[scopeKey] = { functions: [] };
    }
    return this._data.scopes[scopeKey];
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      functions: scope.functions.map(cloneFunction),
    };
  },

  saveScope(scopeKey, scope) {
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
  },

  createEmptyFunction() {
    return {
      id: createId(),
      enabled: true,
      name: '',
      description: '',
      group: '',
      script: 'send look',
    };
  },

  findFunctionById(id, scopeKey = this.getActiveScopeKey()) {
    const key = String(id || '');
    if (!key) return null;
    return this._ensureScope(scopeKey).functions.find((fn) => fn.id === key) || null;
  },

  findFunctionByName(name, scopeKey = this.getActiveScopeKey()) {
    const normalized = normalizeFunctionName(name);
    if (!normalized) return null;
    return this._ensureScope(scopeKey).functions.find((fn) => fn.name === normalized) || null;
  },

  setEnabledById(id, enabled, scopeKey = this.getActiveScopeKey()) {
    const fn = this.findFunctionById(id, scopeKey);
    if (!fn) return { target: null, enabled: null };
    fn.enabled = enabled !== false;
    this._save({ scopeKey });
    return { target: fn, enabled: fn.enabled };
  },

  setEnabledByTarget(name, enabled, scopeKey = this.getActiveScopeKey()) {
    const fn = this.findFunctionByName(name, scopeKey);
    if (!fn) return { target: null, enabled: null };
    fn.enabled = enabled !== false;
    this._save({ scopeKey });
    return { target: fn, enabled: fn.enabled };
  },

  toggleEnabledById(id, scopeKey = this.getActiveScopeKey()) {
    const fn = this.findFunctionById(id, scopeKey);
    if (!fn) return { target: null, enabled: null };
    fn.enabled = fn.enabled === false;
    this._save({ scopeKey });
    return { target: fn, enabled: fn.enabled };
  },

  toggleEnabledByTarget(name, scopeKey = this.getActiveScopeKey()) {
    const fn = this.findFunctionByName(name, scopeKey);
    if (!fn) return { target: null, enabled: null };
    fn.enabled = fn.enabled === false;
    this._save({ scopeKey });
    return { target: fn, enabled: fn.enabled };
  },

  getFunctionDiagnostics(scope, functionId) {
    const functions = Array.isArray(scope && scope.functions) ? scope.functions : [];
    const fn = functions.find((item) => item.id === functionId);
    if (!fn) return [];

    const diagnostics = [];
    const name = normalizeFunctionName(fn.name);
    if (!name) {
      diagnostics.push('Function name is required.');
    } else {
      if (!isValidFunctionName(name)) {
        diagnostics.push('Function names may use letters, numbers, underscores, and dashes, and must start with a letter or underscore.');
      }
      const duplicate = functions.find((item) => item.id !== fn.id && normalizeFunctionName(item.name) === name);
      if (duplicate) diagnostics.push('Function name conflicts with another function in this scope.');
    }

    if (!String(fn.script || '').trim()) {
      diagnostics.push('Script is required.');
    } else {
      getAutomationScriptDiagnostics(fn.script).forEach((message) => diagnostics.push(message));
    }

    return diagnostics;
  },
};
