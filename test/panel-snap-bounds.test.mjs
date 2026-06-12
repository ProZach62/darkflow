// Regression tests for the floating-workspace pane save/restore corruption:
// _getSnapBounds() must never derive the float area from dock DOM geometry in
// floating mode (mid-load the docks can still report a width, and the startup
// snap sweep clamped every saved pane inward and SAVED the result), and the
// startup call to setPaneGridSnapEnabled must not re-sweep saved positions.
import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const stubEl = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop },
  appendChild: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], remove: noop,
  // Docks pretend to be 224px wide, as they can be mid-load.
  getBoundingClientRect: () => ({ left: 0, right: 224, top: 0, bottom: 0 }),
  offsetHeight: 0, offsetWidth: 0,
});
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  addEventListener: noop, removeEventListener: noop,
  createElement: stubEl, getElementById: () => stubEl(),
  querySelector: () => null, querySelectorAll: () => [],
  body: stubEl(), documentElement: stubEl(),
};
globalThis.window = globalThis;
globalThis.innerWidth = 2000;
globalThis.innerHeight = 1400;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.WebSocket = class { addEventListener() {} send() {} close() {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.Audio = class { play() { return Promise.resolve(); } addEventListener() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

const { panelManager } = await import('../public/js/panel-manager.js');
const { state: appState } = await import('../public/js/state.js');

test('floating workspace bounds ignore dock geometry', () => {
  panelManager._workspaceLayout = 'floating';
  const b = panelManager._getSnapBounds();
  assert.equal(b.left, 0, 'left edge is the viewport, not the dock');
  assert.equal(b.right, 2000 - 8, 'right edge is the viewport, not the dock');
});

test('classic workspace bounds still respect the docks', () => {
  panelManager._workspaceLayout = 'classic';
  const b = panelManager._getSnapBounds();
  assert.equal(b.left, 224, 'left dock bounds the float area in classic mode');
  panelManager._workspaceLayout = 'floating';
});

test('startup grid-snap enable does not re-sweep saved pane positions', () => {
  appState.settings = { paneGridSnapEnabled: true };
  let swept = 0;
  const orig = panelManager.snapFloatingPanesToGrid;
  panelManager.snapFloatingPanesToGrid = () => { swept++; };
  try {
    panelManager.setPaneGridSnapEnabled(true, { initializing: true });
    assert.equal(swept, 0, 'initializing call must not sweep');
    panelManager.setPaneGridSnapEnabled(true);
    assert.equal(swept, 1, 'user-driven call still sweeps');
  } finally {
    panelManager.snapFloatingPanesToGrid = orig;
  }
});
