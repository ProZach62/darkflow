import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const stubEl = () => ({
  style: {},
  classList: { add: noop, remove: noop, toggle: noop },
  appendChild: noop,
  addEventListener: noop,
  removeEventListener: noop,
  setAttribute: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  remove: noop,
});

globalThis.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
};
globalThis.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener: noop,
  removeEventListener: noop,
  createElement: stubEl,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: stubEl(),
  documentElement: stubEl(),
};
globalThis.window = globalThis;
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.getComputedStyle = () => ({ width: '', height: '' });
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.dispatchEvent = noop;
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.CustomEvent = class CustomEvent {};
globalThis.Image = class Image {};
globalThis.ResizeObserver = class ResizeObserver { observe() {} disconnect() {} };
globalThis.WebSocket = class WebSocket { addEventListener() {} send() {} close() {} };
globalThis.Audio = class Audio { play() { return Promise.resolve(); } addEventListener() {} };

const v2 = await import('../public/js/map-data-v2.js');
const { gmcp } = await import('../public/js/gmcp.js');
const { panelManager } = await import('../public/js/panel-manager.js');

const sent = [];
gmcp.send = (name, data) => sent.push({ name, data });
panelManager._queuePanelRender = noop;
panelManager.registerGmcpHandlers();

function seedArea(area) {
  v2.mergeServerAreaData({
    area,
    version: 1,
    replace: true,
    rooms: [{
      id: area + ':center',
      name: area + ' Center',
      area,
      positioned: true,
      x: 0,
      y: 0,
      z: 0,
      exits: {},
    }],
  });
}

test('area-scoped MapData2 reset preserves last-good context and requests one full sync', () => {
  v2.clearMapData();
  seedArea('Area A');
  seedArea('Area B');
  v2.processCurrent({
    id: 'Area A:center',
    name: 'Area A Center',
    area: 'Area A',
    positioned: true,
    x: 0,
    y: 0,
    z: 0,
    exits: {},
  });
  sent.length = 0;

  gmcp.dispatch('Darkwind.MapData2.Reset', {
    protocol: 2,
    mapEpoch: 'epoch-1',
    scope: 'area',
    area: 'Area A',
    areaGeneration: 7,
  });

  assert.equal(v2.getRoomsByArea('Area A').length, 1);
  assert.equal(v2.getRoomsByArea('Area B').length, 1);
  assert.equal(v2.getCurrentRoomId(), 'Area A:center');
  const syncs = sent.filter(({ name, data }) =>
    name === 'Darkwind.MapData2.Sync' && data.area === 'Area A');
  assert.equal(syncs.length, 1);
  assert.equal(syncs[0].data.protocol, 2);
  assert.equal(syncs[0].data.mapEpoch, 'epoch-1');
  assert.equal(syncs[0].data.generation, 7);
  assert.equal(syncs[0].data.since, 0);
  assert.equal(syncs[0].data.cursor, 0);
  assert.ok(syncs[0].data.syncId);
});

test('unscoped MapData2 reset preserves presentation while recovering Current', () => {
  v2.clearMapData();
  seedArea('Area A');
  seedArea('Area B');
  sent.length = 0;

  gmcp.dispatch('Darkwind.MapData2.Reset', { protocol: 2, mapEpoch: 'epoch-2' });

  assert.equal(v2.getRoomsByArea('Area A').length, 1);
  assert.equal(v2.getRoomsByArea('Area B').length, 1);
  assert.deepEqual(sent, [{
    name: 'Darkwind.MapData2.Sync',
    data: { protocol: 2, current: 1, mapEpoch: 'epoch-2' },
  }]);
});
