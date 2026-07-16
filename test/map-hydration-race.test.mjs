import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
globalThis.localStorage = {
  _data: new Map(),
  get length() { return this._data.size; },
  key(index) { return Array.from(this._data.keys())[index] || null; },
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, String(value)); },
  removeItem(key) { this._data.delete(key); },
  clear() { this._data.clear(); },
};
globalThis.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener: noop,
  removeEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {},
    classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop,
    addEventListener: noop,
    setAttribute: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: noop,
  }),
  body: {},
  documentElement: {},
};
globalThis.window = globalThis;
globalThis.WebSocket = class WebSocket { addEventListener() {} send() {} close() {} };
globalThis.Audio = class Audio { play() { return Promise.resolve(); } addEventListener() {} };

const storage = await import('../public/js/map-storage.js');
const v2 = await import('../public/js/map-data-v2.js');
const { gmcp } = await import('../public/js/gmcp.js');
gmcp.send = () => true;

test('late cache hydration cannot resurrect rooms after a live snapshot commits', async () => {
  localStorage.clear();
  await v2.configureWorld({ host: 'hydration.test', port: '4242' });
  v2.clearMapData();
  await storage.clearMapSource('mapdata2', 'hydration.test@4242');

  // Saving is scope-queued, so load() blocks behind it. Commit the newer live
  // snapshot while hydration is waiting, reproducing the browser race.
  const cachedSave = storage.saveMapArea('mapdata2', 'hydration.test@4242', 'Race Area', {
    schemaVersion: 5,
    mapEpoch: 'race-epoch',
    generation: 1,
    version: 1,
    rooms: [{
      id: 'stale-room', name: 'Removed Room', area: 'Race Area',
      positioned: true, x: 9, y: 9, z: 0, exits: {},
    }],
  });
  const hydration = v2.load();
  v2.mergeServerAreaData({
    protocol: 2,
    mapEpoch: 'race-epoch',
    area: 'Race Area',
    areaGeneration: 2,
    version: 2,
    replace: true,
    rooms: [{
      id: 'live-room', name: 'Live Room', area: 'Race Area',
      positioned: true, x: 0, y: 0, z: 0, exits: {},
    }],
  });

  await cachedSave;
  await hydration;
  assert.equal(v2.getRoom('stale-room'), undefined);
  assert.equal(v2.getRoom('live-room').name, 'Live Room');
});

test('browse state is cleared when the map world changes', async () => {
  v2.mergeBrowseArea({
    catalog: 'old-world-area',
    name: 'Old World Area',
    replace: 1,
    center: 'browse-room',
    rooms: [{
      id: 'browse-room', name: 'Browse Room', area: 'old-world-area',
      positioned: true, x: 0, y: 0, z: 0, exits: {},
    }],
  });
  assert.equal(v2.browseSource.getRoomsByArea().length, 1);

  await v2.configureWorld({ host: 'other-world.test', port: '4242' });
  assert.equal(v2.browseSource.getRoomsByArea().length, 0);
  assert.equal(v2.getBrowseName(), '');
});
