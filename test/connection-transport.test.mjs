// Transport fallback ladder: connect attempts prefer wss, then ws, then
// telnets, then telnet. The user's explicit protocol selection starts the
// ladder, the remaining rungs keep priority order, and plain ws is skipped
// on https pages where the browser would block it as mixed content.
import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const stubEl = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop },
  appendChild: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], remove: noop,
  getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  offsetHeight: 0, offsetWidth: 0,
});
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  addEventListener: noop, removeEventListener: noop,
  dispatchEvent: noop,
  createElement: stubEl, getElementById: () => stubEl(),
  querySelector: () => null, querySelectorAll: () => [],
  body: stubEl(), documentElement: stubEl(),
};
globalThis.window = globalThis;
globalThis.location = { protocol: 'http:', host: 'localhost:3000' };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.WebSocket = class { addEventListener() {} send() {} close() {} };
globalThis.WebSocket.CLOSED = 3;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.Audio = class { play() { return Promise.resolve(); } addEventListener() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

const { buildTransportLadder } = await import('../public/js/connection.js');

test('default selection walks the full priority ladder', () => {
  assert.deepEqual(buildTransportLadder('wss'), ['wss', 'ws', 'telnets', 'telnet']);
});

test('explicit selection starts the ladder, rest stay in priority order', () => {
  assert.deepEqual(buildTransportLadder('telnets'), ['telnets', 'wss', 'ws', 'telnet']);
  assert.deepEqual(buildTransportLadder('ws'), ['ws', 'wss', 'telnets', 'telnet']);
});

test('unknown selection falls back to the priority ladder', () => {
  assert.deepEqual(buildTransportLadder('bogus'), ['wss', 'ws', 'telnets', 'telnet']);
});

test('https pages skip plain ws (mixed content)', () => {
  globalThis.location.protocol = 'https:';
  try {
    assert.deepEqual(buildTransportLadder('wss'), ['wss', 'telnets', 'telnet']);
    assert.deepEqual(buildTransportLadder('ws'), ['wss', 'telnets', 'telnet']);
  } finally {
    globalThis.location.protocol = 'http:';
  }
});
