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

test('live map source uses generic Room.Info until MapData2 activates', () => {
  localStorage.clear();
  genericMap.configureWorld({ name: 'external', host: 'mud.test', port: '4242' });
  genericMap.clearMapData();
  darkwindMap.clearMapData();
  live.resetLiveMapModeForConnection();

  live.processGenericRoomInfo({ num: 100, name: 'Start', area: 'Elsewhere', exits: {} });
  assert.equal(live.getLiveMapSource(), genericMap);
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), '100');

  live.markMapData2Active();
  assert.equal(live.getLiveMapSource(), darkwindMap);

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
  assert.equal(live.getLiveMapSource().getCurrentRoomId(), 'dw1');
});
