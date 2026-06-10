import test from 'node:test';
import assert from 'node:assert/strict';

const { convertVsCodeTheme, deriveUiVars, normalizeTheme, BUILTIN_THEMES, DEFAULT_THEME_KEY } =
  await import('../public/js/theme-manager.js');

const sampleVsCode = {
  name: 'Test Dark',
  type: 'dark',
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'focusBorder': '#007acc',
    'sideBar.background': '#252526',
    'terminal.ansiBlack': '#000000',
    'terminal.ansiRed': '#cd3131',
    'terminal.ansiGreen': '#0dbc79',
    'terminal.ansiYellow': '#e5e510',
    'terminal.ansiBlue': '#2472c8',
    'terminal.ansiMagenta': '#bc3fbc',
    'terminal.ansiCyan': '#11a8cd',
    'terminal.ansiWhite': '#e5e5e5',
    'terminal.ansiBrightBlack': '#666666',
    'terminal.ansiBrightRed': '#f14c4c',
    'terminal.ansiBrightGreen': '#23d18b',
    'terminal.ansiBrightYellow': '#f5f543',
    'terminal.ansiBrightBlue': '#3b8eea',
    'terminal.ansiBrightMagenta': '#d670d6',
    'terminal.ansiBrightCyan': '#29b8db',
    'terminal.ansiBrightWhite': '#e5e5e5',
  },
};

test('convertVsCodeTheme maps the 16 ANSI colors, bg/fg, accent and type', () => {
  const t = convertVsCodeTheme(sampleVsCode);
  assert.equal(t.type, 'dark');
  assert.equal(t.ansi.length, 16);
  assert.equal(t.ansi[0], '#000000');
  assert.equal(t.ansi[1], '#cd3131');
  assert.equal(t.ansi[15], '#e5e5e5');
  assert.equal(t.bg, '#1e1e1e');
  assert.equal(t.fg, '#d4d4d4');
  assert.equal(t.accent, '#007acc'); // focusBorder
  assert.equal(t.ui.panel, '#252526'); // sideBar.background override
  assert.equal(t.label, 'Test Dark');
});

test('convertVsCodeTheme fills missing ANSI colors from a fallback (no undefined)', () => {
  const t = convertVsCodeTheme({ type: 'light', colors: { 'editor.background': '#ffffff' } });
  assert.equal(t.type, 'light');
  assert.equal(t.ansi.length, 16);
  assert.ok(t.ansi.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)));
  assert.equal(t.bg, '#ffffff');
});

test('deriveUiVars produces a full --df-* set with valid color values', () => {
  const t = convertVsCodeTheme(sampleVsCode);
  const vars = deriveUiVars(t);
  const required = [
    '--df-bg', '--df-panel', '--df-border', '--df-text', '--df-muted',
    '--df-accent', '--df-accent-strong', '--df-accent-blue',
    '--df-ok', '--df-warn', '--df-err', '--df-btn-bg',
    '--df-btn-fg', '--df-scrollbar-thumb', '--df-selection', '--df-overlay',
  ];
  for (const key of required) {
    assert.ok(key in vars, 'missing ' + key);
    assert.ok(/^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(vars[key]), key + ' is not a color: ' + vars[key]);
  }
  // explicit override is honored; status colors track the theme palette
  assert.equal(vars['--df-panel'], '#252526');
  assert.equal(vars['--df-err'], t.ansi[1]);
});

test('themes never expose terminal/ANSI variables (terminal output is fixed)', () => {
  const vars = deriveUiVars(convertVsCodeTheme(sampleVsCode));
  // terminal surface and the 16 ANSI colors must NOT be produced by a theme
  assert.equal(vars['--df-term-bg'], undefined);
  assert.equal(vars['--df-term-fg'], undefined);
  assert.ok(!Object.keys(vars).some((k) => k.startsWith('--ansi-')), 'no --ansi-* vars');
});

test('normalizeTheme throws without a 16-color palette', () => {
  assert.throws(() => normalizeTheme({ label: 'bad', ansi: ['#fff'] }));
});

test('builtin default theme is well-formed and reproduces the original palette', () => {
  const def = BUILTIN_THEMES[DEFAULT_THEME_KEY];
  assert.ok(def);
  assert.equal(def.ansi.length, 16);
  assert.equal(def.ui.bg, '#0d1117');
  assert.equal(def.ui.termBg, '#000000');
  // every builtin has 16 colors and a label
  for (const t of Object.values(BUILTIN_THEMES)) {
    assert.equal(t.ansi.length, 16, t.key + ' ansi length');
    assert.ok(t.label, t.key + ' label');
  }
});
