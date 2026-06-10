// theme-manager.js
//
// Darkflow theming. A theme is normalized to a canonical shape:
//
//   { key, label, type: 'dark'|'light', bg, fg, accent, ansi: [16 hex], ui: {} }
//
// applyTheme() writes a set of --df-* UI variables onto :root. UI chrome not
// explicitly given by a theme is DERIVED from bg/fg/accent/type, so even a bare
// 16-color palette (or a sparse VS Code theme) yields a cohesive interface.
//
// IMPORTANT: themes restyle the UI chrome ONLY. The terminal pane (game output,
// the 16 ANSI colors, the default fg/bg) is intentionally fixed in constants.js
// and the .ansi-* CSS classes, and is NEVER touched here, so game output looks
// identical under every theme. (A theme's ansi[] palette is still used to tint
// in-family UI status colors like --df-ok/--df-warn/--df-err, not the terminal.)
//
// VS Code theme JSON is the import format: convertVsCodeTheme() reads its
// `colors` map (terminal.ansi*, editor.background/foreground, and assorted
// workbench keys) into the canonical shape.

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // drop alpha
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// mix a toward b by t (0..1)
function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

const lighten = (hex, t) => mix(hex, '#ffffff', t);
const darken = (hex, t) => mix(hex, '#000000', t);

// 0..1 relative luminance (WCAG-ish), used to pick readable text on a fill.
function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

const isLight = (hex) => luminance(hex) > 0.5;
// readable text color to sit on `bg`
const readableOn = (bg) => (isLight(bg) ? '#10141a' : '#ffffff');
// rgba string from a hex + alpha
function alpha(hex, a) {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Canonical theme -> CSS variables
// ---------------------------------------------------------------------------

const ANSI_KEYS = [
  'ansiBlack', 'ansiRed', 'ansiGreen', 'ansiYellow', 'ansiBlue', 'ansiMagenta', 'ansiCyan', 'ansiWhite',
  'ansiBrightBlack', 'ansiBrightRed', 'ansiBrightGreen', 'ansiBrightYellow',
  'ansiBrightBlue', 'ansiBrightMagenta', 'ansiBrightCyan', 'ansiBrightWhite',
];

// Build the full --df-* UI variable map for a theme, deriving anything the theme
// didn't specify explicitly in `ui`.
export function deriveUiVars(theme) {
  const dark = theme.type !== 'light';
  const bg = theme.bg;
  const fg = theme.fg;
  const accent = theme.accent || theme.ansi[12] || theme.ansi[6];
  const ui = theme.ui || {};
  const up = (hex, t) => (dark ? lighten(hex, t) : darken(hex, t));

  const panel = ui.panel || up(bg, 0.05);
  const border = ui.border || up(bg, 0.16);

  return {
    '--df-bg': ui.bg || bg,
    '--df-panel': panel,
    '--df-border': border,
    '--df-text': ui.text || fg,
    '--df-muted': ui.muted || mix(fg, bg, 0.4),
    '--df-faint': ui.faint || mix(fg, bg, 0.62),
    '--df-text-strong': ui.textStrong || (dark ? lighten(fg, 0.3) : darken(fg, 0.25)),
    '--df-accent': accent,
    '--df-accent-strong': ui.accentStrong || (dark ? lighten(accent, 0.2) : darken(accent, 0.12)),
    '--df-accent-blue': ui.accentBlue || theme.ansi[12] || accent,
    '--df-elevated': ui.elevated || up(bg, 0.1),
    '--df-border-muted': ui.borderMuted || up(bg, 0.24),
    // status colors track the theme's own ANSI palette so they stay in-family
    // (these are UI chrome accents, NOT the fixed terminal palette)
    '--df-ok': ui.ok || theme.ansi[2],
    '--df-warn': ui.warn || theme.ansi[3],
    '--df-err': ui.err || theme.ansi[1],
    // primary button: filled with accent, text chosen for contrast
    '--df-btn-bg': ui.btnBg || accent,
    '--df-btn-hover': ui.btnHover || (dark ? lighten(accent, 0.12) : darken(accent, 0.08)),
    '--df-btn-fg': ui.btnFg || readableOn(accent),
    '--df-btn-secondary': ui.btnSecondary || up(bg, 0.1),
    '--df-scrollbar-thumb': ui.scrollbarThumb || border,
    '--df-scrollbar-track': ui.scrollbarTrack || bg,
    '--df-selection': ui.selection || alpha(accent, dark ? 0.32 : 0.24),
    '--df-overlay': ui.overlay || alpha('#000000', dark ? 0.6 : 0.4),
  };
}

// Normalize a possibly-partial object into a full canonical theme.
export function normalizeTheme(t) {
  const ansi = Array.isArray(t.ansi) && t.ansi.length === 16 ? t.ansi.slice() : null;
  if (!ansi) throw new Error('theme is missing a 16-color ansi palette');
  const type = t.type === 'light' ? 'light' : 'dark';
  return {
    key: t.key || (t.label || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: t.label || t.key || 'Theme',
    type,
    bg: t.bg || (type === 'light' ? '#ffffff' : '#000000'),
    fg: t.fg || (type === 'light' ? '#1f2328' : '#c9d1d9'),
    accent: t.accent || ansi[12] || ansi[6],
    ansi,
    ui: t.ui || {},
  };
}

// Apply a (canonical or partial) theme to the document.
export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  const root = document.documentElement;
  // Note: the 16 --ansi-* terminal vars and terminal fg/bg are intentionally
  // NOT set here — terminal/game output colors are fixed, never themed.
  const vars = deriveUiVars(t);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.themeType = t.type;
  root.style.setProperty('color-scheme', t.type);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--df-bg']);
  const cs = document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.setAttribute('content', t.type);
  return t;
}

// ---------------------------------------------------------------------------
// VS Code theme JSON -> canonical
// ---------------------------------------------------------------------------

// Map VS Code workbench color keys onto our UI overrides where the theme
// provides them (the rest is derived). Each entry tries keys in order.
function pick(colors, keys) {
  for (const k of keys) {
    const v = colors[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

export function convertVsCodeTheme(json, opts = {}) {
  const colors = (json && json.colors) || {};
  const type = (json && (json.type || json.uiTheme)) === 'vs' || json.type === 'light' ? 'light' : 'dark';

  const editorBg = pick(colors, ['terminal.background', 'editor.background', 'editorPane.background']);
  const editorFg = pick(colors, ['terminal.foreground', 'editor.foreground', 'foreground']);
  const bg = editorBg || (type === 'light' ? '#ffffff' : '#1e1e1e');
  const fg = editorFg || (type === 'light' ? '#1f2328' : '#d4d4d4');

  // 16 ANSI colors, falling back to a sane default if a key is missing.
  const fallbackAnsi = type === 'light' ? LIGHT_FALLBACK_ANSI : DARK_FALLBACK_ANSI;
  const ansi = ANSI_KEYS.map((k, i) => pick(colors, ['terminal.' + k]) || fallbackAnsi[i]);

  const accent = pick(colors, ['focusBorder', 'button.background', 'textLink.foreground',
    'progressBar.background', 'activityBarBadge.background']) || ansi[12] || ansi[6];

  const ui = {};
  const set = (key, vscKeys) => { const v = pick(colors, vscKeys); if (v) ui[key] = v; };
  set('bg', ['editor.background']);
  set('panel', ['sideBar.background', 'panel.background', 'editorGroupHeader.tabsBackground']);
  set('border', ['panel.border', 'editorGroup.border', 'sideBar.border', 'contrastBorder']);
  set('text', ['foreground', 'editor.foreground']);
  set('muted', ['descriptionForeground', 'disabledForeground', 'tab.inactiveForeground']);
  set('accentBlue', ['textLink.foreground', 'button.background']);
  set('btnBg', ['button.background']);
  set('btnFg', ['button.foreground']);
  set('elevated', ['input.background', 'dropdown.background', 'editorWidget.background']);
  set('selection', ['editor.selectionBackground', 'selection.background']);

  return normalizeTheme({
    key: opts.key,
    label: opts.label || (json && json.name) || 'Imported theme',
    type,
    bg,
    fg,
    accent,
    ansi,
    ui,
  });
}

const DARK_FALLBACK_ANSI = [
  '#555555', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
];
const LIGHT_FALLBACK_ANSI = [
  '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#073642',
  '#586e75', '#cb4b16', '#859900', '#b58900', '#268bd2', '#6c71c4', '#2aa198', '#002b36',
];

// ---------------------------------------------------------------------------
// Bundled themes (pre-normalized canonical palettes). Users can import any VS
// Code theme JSON via convertVsCodeTheme for more.
// ---------------------------------------------------------------------------

export const BUILTIN_THEMES = {
  'darkflow-default': normalizeTheme({
    key: 'darkflow-default', label: 'Darkflow (default)', type: 'dark',
    bg: '#000000', fg: '#c9d1d9', accent: '#42d6c9',
    ansi: ['#555555', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
      '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'],
    // exact original UI palette so the default is pixel-identical
    ui: {
      bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9',
      muted: '#8b949e', accentStrong: '#7ee7df', accentBlue: '#58a6ff',
      termBg: '#000000', termFg: '#c9d1d9',
    },
  }),
  'one-dark': normalizeTheme({
    key: 'one-dark', label: 'One Dark', type: 'dark',
    bg: '#282c34', fg: '#abb2bf', accent: '#61afef',
    ansi: ['#3f4451', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  }),
  'dracula': normalizeTheme({
    key: 'dracula', label: 'Dracula', type: 'dark',
    bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9',
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  }),
  'nord': normalizeTheme({
    key: 'nord', label: 'Nord', type: 'dark',
    bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0',
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  }),
  'solarized-light': normalizeTheme({
    key: 'solarized-light', label: 'Solarized Light', type: 'light',
    bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  }),
  'github-light': normalizeTheme({
    key: 'github-light', label: 'GitHub Light', type: 'light',
    bg: '#ffffff', fg: '#24292e', accent: '#0366d6',
    ansi: ['#24292e', '#d73a49', '#28a745', '#dbab09', '#0366d6', '#5a32a3', '#0598bc', '#6a737d',
      '#959da5', '#cb2431', '#22863a', '#b08800', '#005cc5', '#5a32a3', '#3192aa', '#d1d5da'],
  }),
};

export const DEFAULT_THEME_KEY = 'darkflow-default';
