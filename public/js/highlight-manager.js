import { dom } from './state.js';
import { FG_NAMES } from './constants.js';

const HIGHLIGHT_STORAGE_KEY = 'darkwind-client-highlights-v1';
const COLOR_INDEX_BY_NAME = FG_NAMES.reduce((map, name, index) => {
  map[name] = index;
  return map;
}, {});

function createId() {
  return 'highlight-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function emitHighlightDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:highlight-data-changed', {
    detail: detail || null,
  }));
}

function normalizeStyle(style) {
  if (!style || typeof style !== 'object') {
    return { fg: 'yellow', bg: 'black', bold: false };
  }

  const fg = typeof style.fg === 'string' && COLOR_INDEX_BY_NAME[style.fg] !== undefined
    ? style.fg
    : 'yellow';
  const bg = typeof style.bg === 'string' && COLOR_INDEX_BY_NAME[style.bg] !== undefined
    ? style.bg
    : 'black';

  return {
    fg,
    bg,
    bold: Boolean(style.bold),
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const patternSource = String(rule.patternSource || '').trim();
  if (!patternSource) return null;

  return {
    id: typeof rule.id === 'string' && rule.id ? rule.id : createId(),
    enabled: rule.enabled !== false,
    patternSource,
    ignoreCase: Boolean(rule.ignoreCase),
    style: normalizeStyle(rule.style),
  };
}

function normalizeScope(scope) {
  const rules = Array.isArray(scope && scope.rules)
    ? scope.rules.map(normalizeRule).filter(Boolean)
    : [];

  return { rules };
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

function compileRule(rule) {
  try {
    return {
      regex: new RegExp(rule.patternSource, 'g' + (rule.ignoreCase ? 'i' : '')),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : 'Invalid regex.',
    };
  }
}

function cloneStyle(style) {
  return {
    bold: Boolean(style && style.bold),
    underline: Boolean(style && style.underline),
    inverse: Boolean(style && style.inverse),
    fg: style && style.fg ? { ...style.fg } : null,
    bg: style && style.bg ? { ...style.bg } : null,
  };
}

function buildAnsiColor(name) {
  const index = COLOR_INDEX_BY_NAME[name];
  if (index === undefined) return null;
  return { type: 'standard', index };
}

function mergeHighlightStyle(baseStyle, highlightStyle) {
  const merged = cloneStyle(baseStyle || {});
  merged.bold = Boolean(highlightStyle.bold);
  merged.fg = buildAnsiColor(highlightStyle.fg);
  merged.bg = buildAnsiColor(highlightStyle.bg);
  return merged;
}

function stylesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyRulesToLine(line, compiledRules) {
  if (!line || !line.text || !Array.isArray(line.fragments) || !compiledRules.length) {
    return line;
  }

  const owners = new Array(line.text.length).fill(-1);
  let hasMatches = false;

  compiledRules.forEach((entry, entryIndex) => {
    if (!entry.regex) return;

    entry.regex.lastIndex = 0;
    let match = entry.regex.exec(line.text);

    while (match) {
      const matchedText = String(match[0] || '');
      if (!matchedText.length) {
        entry.regex.lastIndex += 1;
        match = entry.regex.exec(line.text);
        continue;
      }

      const start = match.index;
      const end = start + matchedText.length;
      let applied = false;
      for (let index = start; index < end; index++) {
        if (owners[index] !== -1) continue;
        owners[index] = entryIndex;
        applied = true;
      }
      hasMatches = hasMatches || applied;
      match = entry.regex.exec(line.text);
    }
  });

  if (!hasMatches) return line;

  const nextFragments = [];
  let textIndex = 0;

  for (const fragment of line.fragments) {
    const text = String(fragment.text || '');
    if (!text.length) continue;

    let segmentText = '';
    let segmentStyle = null;

    for (const ch of text) {
      const ownerIndex = owners[textIndex];
      const nextStyle = ownerIndex === -1
        ? cloneStyle(fragment.style || {})
        : mergeHighlightStyle(fragment.style || {}, compiledRules[ownerIndex].style);

      if (segmentText && stylesEqual(segmentStyle, nextStyle)) {
        segmentText += ch;
      } else {
        if (segmentText) {
          nextFragments.push({ text: segmentText, style: segmentStyle });
        }
        segmentText = ch;
        segmentStyle = nextStyle;
      }

      textIndex++;
    }

    if (segmentText) {
      nextFragments.push({ text: segmentText, style: segmentStyle });
    }
  }

  return {
    ...line,
    fragments: nextFragments,
  };
}

function parseTintinStyle(styleText) {
  const tokens = normalizeWhitespace(styleText).split(' ').filter(Boolean);
  if (!tokens.length) {
    return { style: null, error: 'Highlight style is required.' };
  }

  const colors = [];
  let bold = false;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === 'b') {
      bold = true;
      continue;
    }
    if (COLOR_INDEX_BY_NAME[normalized] === undefined) {
      return { style: null, error: 'Unknown color "' + token + '".' };
    }
    colors.push(normalized);
  }

  if (colors.length === 0) {
    return { style: null, error: 'Highlight style must include at least one color.' };
  }
  if (colors.length > 2) {
    return { style: null, error: 'Highlight style can only include foreground and background colors.' };
  }

  return {
    style: {
      fg: colors[0],
      bg: colors[1] || 'black',
      bold,
    },
    error: null,
  };
}

function formatTintinStyle(style) {
  const tokens = [style.fg];
  if (style.bold) tokens.push('b');
  if (style.bg) tokens.push(style.bg);
  return tokens.join(' ');
}

export const highlightManager = {
  _data: { scopes: {} },

  init() {
    try {
      const raw = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load highlights', error);
    }

    this._data = { scopes: {} };
  },

  _save(detail = null) {
    try {
      localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(this._data));
      emitHighlightDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save highlights', error);
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
      this._data.scopes[scopeKey] = { rules: [] };
    }
    return this._data.scopes[scopeKey];
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      rules: scope.rules.map((rule) => ({
        ...rule,
        style: { ...rule.style },
      })),
    };
  },

  saveScope(scopeKey, scope) {
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
  },

  createEmptyRule() {
    return {
      id: createId(),
      enabled: true,
      patternSource: '',
      ignoreCase: false,
      style: {
        fg: 'yellow',
        bg: 'black',
        bold: false,
      },
    };
  },

  findRuleByPattern(patternSource, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(patternSource || '').trim();
    if (!normalizedPattern) return null;
    return this._ensureScope(scopeKey).rules.find((rule) => rule.patternSource === normalizedPattern) || null;
  },

  upsertSimpleRule(patternSource, styleText, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(patternSource || '').trim();
    if (!normalizedPattern) {
      return { rule: null, error: 'Highlight pattern is required.' };
    }

    const parsedStyle = parseTintinStyle(styleText);
    if (parsedStyle.error) {
      return { rule: null, error: parsedStyle.error };
    }

    const scope = this._ensureScope(scopeKey);
    const existing = this.findRuleByPattern(normalizedPattern, scopeKey);
    const rule = existing || this.createEmptyRule();

    rule.enabled = true;
    rule.patternSource = normalizedPattern;
    rule.ignoreCase = false;
    rule.style = parsedStyle.style;

    const compiled = compileRule(rule);
    if (compiled.error) {
      return { rule: null, error: compiled.error };
    }

    if (!existing) {
      scope.rules.push(rule);
    }

    this._save({ scopeKey });
    return {
      rule: {
        ...rule,
        style: { ...rule.style },
      },
      error: null,
    };
  },

  removeRuleByPattern(patternSource, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = String(patternSource || '').trim();
    if (!normalizedPattern) return false;

    const scope = this._ensureScope(scopeKey);
    const nextRules = scope.rules.filter((rule) => rule.patternSource !== normalizedPattern);
    if (nextRules.length === scope.rules.length) return false;
    scope.rules = nextRules;
    this._save({ scopeKey });
    return true;
  },

  getRuleDiagnostics(scope, ruleId) {
    const rules = Array.isArray(scope && scope.rules) ? scope.rules : [];
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) return [];

    const diagnostics = [];
    if (!String(rule.patternSource || '').trim()) {
      diagnostics.push('Pattern is required.');
    }

    const duplicate = rules.find((item) => item.id !== rule.id && item.patternSource === rule.patternSource);
    if (duplicate) {
      diagnostics.push('Pattern conflicts with another highlight rule in this scope.');
    }

    const compiled = compileRule(rule);
    if (compiled.error) {
      diagnostics.push(compiled.error);
    }

    return diagnostics;
  },

  describeRule(rule) {
    if (!rule) return '';
    return '/' + rule.patternSource + '/ -> ' + formatTintinStyle(rule.style);
  },

  formatRuleStyle(rule) {
    return formatTintinStyle(rule.style);
  },

  getCompiledRules(scopeKey = this.getActiveScopeKey(), scopeOverride = null) {
    const sourceScope = scopeOverride ? normalizeScope(scopeOverride) : this._ensureScope(scopeKey);
    return sourceScope.rules
      .filter((rule) => rule.enabled !== false)
      .map((rule) => {
        const compiled = compileRule(rule);
        return {
          ...rule,
          regex: compiled.regex,
          error: compiled.error,
        };
      })
      .filter((rule) => rule.regex);
  },

  applyHighlightsToLines(lines, scopeKey = this.getActiveScopeKey()) {
    const compiledRules = this.getCompiledRules(scopeKey);
    if (!compiledRules.length || !Array.isArray(lines) || !lines.length) return lines;
    return lines.map((line) => applyRulesToLine(line, compiledRules));
  },

  applyHighlightsToText(text, rules) {
    const compiledRules = Array.isArray(rules)
      ? rules
        .map((rule) => {
          const compiled = compileRule(rule);
          return {
            ...rule,
            regex: compiled.regex,
            error: compiled.error,
          };
        })
        .filter((rule) => rule.enabled !== false && rule.regex)
      : this.getCompiledRules(this.getActiveScopeKey());

    const line = {
      id: 'preview',
      text: String(text || ''),
      cssClass: '',
      height: 0,
      fragments: [{ text: String(text || ''), style: {} }],
    };

    return applyRulesToLine(line, compiledRules).fragments;
  },
};

export { parseTintinStyle };
