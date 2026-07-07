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
const { gmcp } = await import('../public/js/gmcp.js');
// The model now sends sync requests on its own (login/baseline reconciliation);
// stub the transport so tests never touch the real socket plumbing.
gmcp.send = () => {};

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
    id: area + ':A', name: 'Town Square', area, env: 'city', areaName: 'Player Land',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { north: area + ':B' },
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;

  assert.ok(out.includes('map-tile-player'), 'player tile present');
  // Closing-quote discriminator: 'map-conn-n' alone would also match the
  // diagonal classes map-conn-ne / map-conn-nw.
  assert.ok(out.includes('map-conn-n"'), 'connector drawn to adjacent mapped room to the north');
  assert.ok(out.includes('map-areaname'), 'area name label present');
  assert.ok(out.includes('Player Land'), 'shows the human area name from the payload');
  assert.ok(out.includes('Town Square'), 'still shows the current room name');
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
  assert.ok(body.innerHTML.includes('map-stub-e"'), 'unmapped east exit -> east stub');
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
  assert.ok(out.includes('map-stub-e"'), 'cross-zone east exit -> stub');
  assert.ok(!out.includes('map-conn-e"'), 'cross-zone exit must not be a connector');
});

// ── Diagonal exits + per-tile indicators ─────────────────────────────────────

// Render `room` (with optional neighbours) as the positioned current room at
// the origin of a fresh area and return the produced HTML.
function renderWithRooms(area, rooms, currentOverrides = {}) {
  v2.mergeServerAreaData({ area, version: 1, replace: true, rooms });
  v2.processCurrent(Object.assign({}, rooms[0], { areaVersion: 1 }, currentOverrides));
  const body = makeBody();
  renderMap(body);
  return body.innerHTML;
}

test('reciprocal diagonal exits render corner connectors both ways', () => {
  const area = 'DiagLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Crossroads', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Hilltop', area, env: 'hills',
      positioned: true, x: 1, y: -1, z: 0, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(out.includes('map-conn-ne"'), 'A draws its northeast connector');
  assert.ok(out.includes('map-conn-sw"'), 'B draws its southwest connector');
  assert.ok(!out.includes('map-stub-ne"'), 'mapped adjacent diagonal is not a stub');
});

test('one-way diagonal exit draws only the owning side', () => {
  const area = 'OneWayDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Ledge', area, env: 'mountain',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Slope', area, env: 'mountain',
      positioned: true, x: 1, y: -1, z: 0, exits: {} },
  ]);
  assert.ok(out.includes('map-conn-ne"'), 'exit owner draws the full connector');
  assert.ok(!out.includes('map-conn-sw"'), 'no return exit -> no southwest span');
});

test('diagonal exit to an unmapped room renders a diagonal stub', () => {
  const area = 'DiagStub';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Fork', area, env: 'forest',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':unknown' } },
  ]);
  assert.ok(out.includes('map-stub-ne"'), 'unmapped diagonal -> corner stub');
  assert.ok(!out.includes('map-conn-ne"'), 'and no connector');
});

test('cross-zone diagonal exit renders a stub, not a connector', () => {
  const area = 'DiagZoneA';
  const out = renderWithRooms(area, [
    { id: area + ':edge', name: 'Border Rock', area, env: 'hills',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: 'DiagZoneB:gate' } },
    { id: 'DiagZoneB:gate', name: 'Far Gate', area: 'DiagZoneB', env: 'city',
      positioned: true, x: 1, y: -1, z: 0, exits: { southwest: area + ':edge' } },
  ]);
  assert.ok(out.includes('map-stub-ne"'), 'cross-zone diagonal -> stub');
  assert.ok(!out.includes('map-conn-ne"'), 'never a connector across zones');
});

test('mapped but non-adjacent diagonal renders neither connector nor stub', () => {
  const area = 'FarDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Start', area, env: 'plains',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Distant', area, env: 'plains',
      positioned: true, x: 3, y: -3, z: 0, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(!out.includes('map-conn-ne"'), 'non-adjacent room -> no drawable line');
  assert.ok(!out.includes('map-stub-ne"'), 'positioned same-zone dest -> no stub either');
});

test('diagonal to a different z-level renders nothing (pins existing skip)', () => {
  const area = 'ZDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Base', area, env: 'underground',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Upper', area, env: 'underground',
      positioned: true, x: 1, y: -1, z: 1, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(!out.includes('map-conn-ne"'), 'z-mismatched dest -> no connector');
  assert.ok(!out.includes('map-stub-ne"'), 'z-mismatched dest -> no stub');
});

test('all four diagonal rotations render from one center room', () => {
  const area = 'FourDiag';
  const mk = (suffix, x, y, back) => ({
    id: area + ':' + suffix, name: suffix, area, env: 'city',
    positioned: true, x, y, z: 0, exits: { [back]: area + ':C' },
  });
  const out = renderWithRooms(area, [
    { id: area + ':C', name: 'Center', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: {
        northeast: area + ':NE', northwest: area + ':NW',
        southeast: area + ':SE', southwest: area + ':SW',
      } },
    mk('NE', 1, -1, 'southwest'), mk('NW', -1, -1, 'southeast'),
    mk('SE', 1, 1, 'northwest'), mk('SW', -1, 1, 'northeast'),
  ]);
  for (const abbr of ['ne', 'nw', 'se', 'sw']) {
    assert.ok(out.includes('map-conn-' + abbr + '"'), 'connector ' + abbr + ' present');
  }
});

test('rooms with up/down exits get per-tile vertical glyphs', () => {
  const area = 'VertLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Stairwell', area, env: 'inside',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { up: area + ':up1', down: area + ':down1', east: area + ':B' } },
    { id: area + ':B', name: 'Flat Room', area, env: 'inside',
      positioned: true, x: 1, y: 0, z: 0, exits: { west: area + ':A' } },
  ]);
  assert.ok(out.includes('map-vert-up'), 'up exit -> up glyph on the tile');
  assert.ok(out.includes('map-vert-down'), 'down exit -> down glyph on the tile');
  // Exactly one tile has them (the neighbour has no vertical exits).
  assert.equal(out.split('map-vert-up').length - 1, 1, 'only the stairwell shows up glyph');
});

test('special (non-compass) exits get the special-exit dot', () => {
  const area = 'SpecialLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Shopfront', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { enter: area + ':shop', east: area + ':B' },
      exitKinds: { enter: 'special', east: 'spatial' } },
    { id: area + ':B', name: 'Street', area, env: 'city',
      positioned: true, x: 1, y: 0, z: 0, exits: { west: area + ':A' },
      exitKinds: { west: 'spatial' } },
  ]);
  assert.ok(out.includes('map-exit-special'), 'enter exit -> special dot');
  assert.equal(out.split('map-exit-special').length - 1, 1,
    'spatial/vertical-only rooms get no dot');
});

test('overlapping rooms get the conflict class and stack-count badge', () => {
  const area = 'OverlapLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Front Room', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: {} },
    { id: area + ':B', name: 'Squatter', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: {} },
  ]);
  assert.ok(out.includes('map-tile-conflict'), 'shared cell -> conflict class');
  assert.ok(out.includes('data-stack="2"'), 'badge carries the stack count');
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
  assert.ok(out.includes('map-conn-e"'), 'connector between the two browse rooms');
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

// ── Sync protocol semantics (chunk continuation + baseline reconciliation) ───

function withGmcpSpy(fn) {
  const sent = [];
  const orig = gmcp.send;
  gmcp.send = (pkg, data) => { sent.push({ pkg, data }); };
  try { fn(sent); } finally { gmcp.send = orig; }
}

test('chunked area sync continues with the server cursor, not a version mark', () => {
  v2.clearMapData();
  withGmcpSpy((sent) => {
    v2.mergeServerUpdate({
      area: 'ChunkLand', version: 90, since: 0, offset: 50, more: 1, replace: 1,
      rooms: [{ id: 'c1', name: 'C1', positioned: 1, x: 0, y: 0, z: 0, version: 90, exits: {} }],
    });
    assert.equal(sent.length, 1, 'continuation Sync sent while more=1');
    assert.equal(sent[0].pkg, 'Darkwind.MapData2.Sync');
    assert.equal(sent[0].data.version, 0, 'continuation re-sends the ORIGINAL since');
    assert.equal(sent[0].data.offset, 50, 'continuation carries the cursor');
  });

  // Baseline is not established until the final chunk arrives.
  withGmcpSpy(() => {
    v2.processCurrent({
      id: 'c1', name: 'C1', area: 'ChunkLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 90, exits: {},
    });
  });

  withGmcpSpy((sent) => {
    v2.mergeServerUpdate({
      area: 'ChunkLand', version: 90, since: 0, offset: 70, more: 0,
      rooms: [{ id: 'c2', name: 'C2', positioned: 1, x: 1, y: 0, z: 0, version: 88, exits: {} }],
    });
    assert.equal(sent.length, 0, 'no continuation after the final chunk');
  });

  // Now the baseline is 90: a Current at the same version requests nothing.
  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'c2', name: 'C2', area: 'ChunkLand', positioned: 1,
      x: 1, y: 0, z: 0, areaVersion: 90, exits: {},
    });
    assert.equal(sent.length, 0, 'baseline up to date -> no sync request');
  });
});

test('server version regression triggers a full resync (frame reset)', () => {
  v2.clearMapData();
  // Complete a sync at version 200.
  v2.mergeServerAreaData({
    area: 'ResetLand', version: 200, more: 0, replace: 1,
    rooms: [{ id: 'r1', name: 'R1', positioned: 1, x: 0, y: 0, z: 0, version: 200, exits: {} }],
  });

  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'r1', name: 'R1', area: 'ResetLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 5, exits: {},
    });
    assert.equal(sent.length, 1, 'regressed server version -> resync requested');
    assert.equal(sent[0].data.version, 0, 'and it is a FULL sync');
  });
});

test('first Current for an unsynced area requests a full sync (login path)', () => {
  v2.clearMapData();
  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'f1', name: 'F1', area: 'FreshLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 42, exits: {},
    });
    assert.equal(sent.length, 1, 'no baseline -> full sync requested');
    assert.equal(sent[0].data.area, 'FreshLand');
    assert.equal(sent[0].data.version, 0);
  });
});
