// Tests for map-renderer "never blank a known area" behavior (audit fix 1a).
// Drives the real MapData2 model + renderer with minimal DOM stubs.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser globals so the client modules import under Node ---------
const noop = () => {};
const stubEl = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop },
  appendChild: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], remove: noop,
});
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  addEventListener: noop, removeEventListener: noop,
  createElement: stubEl, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  body: stubEl(), documentElement: stubEl(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.WebSocket = class { addEventListener() {} send() {} close() {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.Audio = class { play() { return Promise.resolve(); } addEventListener() {} };

const { renderMap } = await import('../public/js/map-renderer.js');
const v2 = await import('../public/js/map-data-v2.js');

function makeBody() {
  let html = '';
  return {
    clientWidth: 320, clientHeight: 240,
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    querySelector: () => null,
  };
}

// A small positioned area: center room A with a neighbor B to its north.
function seedArea(area) {
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: area + ':A', name: 'Town Square', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { north: area + ':B' } },
      { id: area + ':B', name: 'North Road', area, env: 'road',
        positioned: true, x: 0, y: -1, z: 0, exits: { south: area + ':A' } },
    ],
  });
}

test('unpositioned current room does NOT blank a known area', () => {
  const area = 'Knownland';
  seedArea(area);
  // Player steps into a room the server has not laid out yet.
  v2.processCurrent({
    id: area + ':cellar', name: 'Dark Cellar', area,
    positioned: false, areaVersion: 1, exits: {},
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;

  assert.ok(!out.includes('map-empty'), 'must not show the empty placeholder');
  assert.ok(out.includes('map-grid'), 'must render the tile grid');
  assert.ok(out.includes('map-tile-'), 'must render terrain tiles for the area');
  assert.ok(out.includes('map-pending'), 'must show the "locating" indicator');
  assert.ok(out.includes('Dark Cellar'), 'must name the room the player is in');
  assert.ok(out.includes('map-tile-lastpos'), 'must mark the parked position');
  assert.ok(!out.includes('map-tile-player'), 'no player icon while unpositioned');

  const dbg = window.mapRenderDebug();
  assert.equal(dbg.pending, true);
  assert.equal(dbg.currentRoom.positioned, false);
});

test('positioned current room renders the player tile normally', () => {
  const area = 'Playerland';
  seedArea(area);
  v2.processCurrent({
    id: area + ':A', name: 'Town Square', area, env: 'city',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { north: area + ':B' },
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;

  assert.ok(out.includes('map-tile-player'), 'player tile present');
  assert.ok(out.includes('map-conn-n'), 'connector drawn to adjacent mapped room to the north');
  assert.ok(!out.includes('map-pending'), 'no pending indicator when positioned');
  assert.ok(!out.includes('map-empty'), 'not the empty placeholder');

  const dbg = window.mapRenderDebug();
  assert.equal(dbg.pending, false);
});

test('exits to unmapped rooms render as stubs', () => {
  const area = 'Stubland';
  // One positioned room with an east exit to a room we do not have/position.
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: area + ':A', name: 'Edge Room', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: area + ':unknown' } },
    ],
  });
  v2.processCurrent({
    id: area + ':A', name: 'Edge Room', area, env: 'city',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { east: area + ':unknown' },
  });

  const body = makeBody();
  renderMap(body);
  assert.ok(body.innerHTML.includes('map-stub-e'), 'unmapped east exit -> east stub');
});

test('exits to a different zone render as stubs, not connectors', () => {
  const area = 'ZoneA';
  // Current room is positioned; its east exit leads to a room positioned in a
  // DIFFERENT zone (ZoneB) -- must be a boundary stub, never a connector.
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: 'ZoneA:edge', name: 'Border Gate', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: 'ZoneB:gate' } },
      { id: 'ZoneB:gate', name: 'Other Gate', area: 'ZoneB', env: 'city',
        positioned: true, x: 1, y: 0, z: 0, exits: { west: 'ZoneA:edge' } },
    ],
  });
  v2.processCurrent({
    id: 'ZoneA:edge', name: 'Border Gate', area, env: 'city',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { east: 'ZoneB:gate' },
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;
  assert.ok(out.includes('map-stub-e'), 'cross-zone east exit -> stub');
  assert.ok(!out.includes('map-conn-e'), 'cross-zone exit must not be a connector');
});

test('browse mode renders a catalog area with no player marker', () => {
  // Live current room is elsewhere; the browse pane must be independent of it.
  seedArea('LiveLand');
  v2.processCurrent({
    id: 'LiveLand:A', name: 'Town Square', area: 'LiveLand',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: {},
  });

  v2.mergeBrowseArea({
    catalog: 'darkwind.maincity', name: 'Darkwind City', replace: true,
    center: 'mc:1', more: false, offset: 0,
    rooms: [
      { id: 'mc:1', name: 'Temple Yard', area: 'Darkwind', env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: 'mc:2' } },
      { id: 'mc:2', name: 'Market', area: 'Darkwind', env: 'city',
        positioned: true, x: 1, y: 0, z: 0, exits: { west: 'mc:1' } },
    ],
  });

  const body = makeBody();
  renderMap(body, v2.browseSource);
  const out = body.innerHTML;

  assert.ok(!out.includes('map-empty'), 'browse area renders, not blank');
  assert.ok(out.includes('map-grid'), 'renders the tile grid');
  assert.ok(out.includes('Darkwind City'), 'titled with the catalog area name');
  assert.ok(out.includes('map-conn-e'), 'connector between the two browse rooms');
  assert.ok(!out.includes('map-tile-player'), 'no player marker in browse mode');
  assert.ok(!out.includes('map-resync-btn'), 'no resync button in browse mode');

  v2.exitBrowse();
  // Live render is unaffected after browsing.
  const body2 = makeBody();
  renderMap(body2);
  assert.ok(body2.innerHTML.includes('map-tile-player'), 'live map still has the player');
});

test('genuinely empty area still shows the explore placeholder', () => {
  v2.processCurrent({
    id: 'Voidland:x', name: 'Featureless Void', area: 'Voidland',
    positioned: false, areaVersion: 0, exits: {},
  });

  const body = makeBody();
  renderMap(body);
  assert.ok(body.innerHTML.includes('map-empty'), 'no data for area -> placeholder');
});
