import test from 'node:test';
import assert from 'node:assert/strict';

global.localStorage = {
  _data: new Map(),
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, String(value)); },
  removeItem(key) { this._data.delete(key); },
  clear() { this._data.clear(); },
};

global.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      addEventListener() {},
      setAttribute() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      remove() {},
    };
  },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  body: { appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } },
};
global.window = global;
global.WebSocket = class { addEventListener() {} send() {} close() {} };
global.Audio = class { play() { return Promise.resolve(); } addEventListener() {} };
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const genericMap = await import('../public/js/map-data-gmcp.js');
const darkwindMap = await import('../public/js/map-data-v2.js');
const live = await import('../public/js/live-map-source.js');

test('live map source requires a valid Current and keeps Room.Info fallback warm', () => {
  localStorage.clear();
  genericMap.configureWorld({ name: 'external', host: 'mud.test', port: '4242' });
  genericMap.clearMapData();
  darkwindMap.clearMapData();
  live.resetLiveMapModeForConnection();

  live.processGenericRoomInfo({ num: 100, name: 'Start', area: 'Elsewhere', exits: {} });
  assert.equal(live.getLiveMapSource(), genericMap);
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), '100');

  live.markMapData2Active();
  assert.equal(live.getLiveMapSource(), genericMap,
    'an unrelated MapData2 packet cannot strand the map on an empty source');

  darkwindMap.processCurrent({
    id: 'dw1',
    name: 'Darkwind Room',
    area: 'Darkwind',
    positioned: 1,
    x: 0,
    y: 0,
    z: 0,
    exits: {},
  });
  live.markMapData2Active();
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), 'dw1');

  live.processGenericRoomInfo({ num: 101, name: 'Fallback', area: 'Elsewhere', exits: {} });
  assert.equal(live.getLiveMapSource(), darkwindMap, 'valid MapData2 remains authoritative');

  const reflow = {
    protocol: 2,
    code: 'current_unavailable',
    reason: 'grid_reflow',
    area: 'Darkwind',
    retryAfterMs: 100,
  };
  darkwindMap.processSyncError(reflow);
  assert.equal(live.markMapData2Unavailable(reflow), false);
  assert.equal(darkwindMap.hasLiveCurrent(), false,
    'transient reflow makes movement context stale');
  assert.equal(live.getLiveMapSource(), darkwindMap,
    'transient reflow keeps the last authoritative snapshot visible');
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), 'dw1');

  const unavailable = {
    protocol: 2,
    code: 'current_unavailable',
    reason: 'unmappable_room',
    area: 'Darkwind',
  };
  darkwindMap.processSyncError(unavailable);
  assert.equal(live.markMapData2Unavailable(unavailable), true);
  assert.equal(live.getLiveMapSource(), genericMap);
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), '101',
    'fallback was kept current while authoritative mapping was active');
});

test('same-endpoint reconnect preserves last-good map then falls back after silence', () => {
  darkwindMap.processCurrent({
    id: 'dw2', name: 'Last Good', area: 'Darkwind', positioned: 1,
    x: 1, y: 0, z: 0, exits: {},
  });
  live.markMapData2Active();

  const realSetTimeout = globalThis.setTimeout;
  const fallbackCallbacks = [];
  globalThis.setTimeout = (callback) => {
    fallbackCallbacks.push(callback);
    return { unref() {} };
  };
  try {
    live.resetLiveMapModeForConnection();
    live.resetLiveMapModeForConnection();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  assert.equal(live.getLiveMapSource(), darkwindMap);
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), 'dw2');
  live.processGenericRoomInfo({ num: 102, name: 'Reconnect', area: 'Elsewhere', exits: {} });
  assert.equal(fallbackCallbacks.length, 2);
  fallbackCallbacks[0]();
  assert.equal(live.getLiveMapSource(), darkwindMap,
    'a stale watchdog cannot cancel the newer reconnect generation');
  fallbackCallbacks[1]();
  assert.equal(live.getLiveMapSource(), genericMap);
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), '102');
});
