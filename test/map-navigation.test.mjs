// Map navigation: zooming at a point, a drag's coast, other floors, pins, and
// search.
import test from 'node:test';
import assert from 'node:assert/strict';

import { anchoredZoomPan } from '../public/js/map-zoom.js';
import { releaseVelocity } from '../public/js/map-pan.js';
import { createMapRenderer, mapLevelOffset } from '../public/js/map-renderer-core.js';
import {
  MAP_PIN_KINDS,
  MAX_MAP_PINS,
  mapPinIconSvg,
  mapPinStorageKey,
  normalizeMapPins,
  removeMapPin,
  setMapPin,
} from '../public/js/map-pins-core.js';
import { pinnedRoomsInArea, searchMapRooms } from '../public/js/map-search-core.js';

test('zooming at a point keeps the world under it still', () => {
  // At 40px a cell, a point 80px right of the middle is two cells right of
  // the view's centre. Zoomed to 80px a cell it must still be two cells
  // right, so the view moves one cell toward it: the pan drops by one.
  assert.deepEqual(anchoredZoomPan({ x: 0, y: 0 }, { x: 80, y: -40 }, 40, 80), { x: -1, y: 0.5 });
  assert.deepEqual(anchoredZoomPan({ x: 2, y: 3 }, { x: 0, y: 0 }, 40, 80), { x: 2, y: 3 }, 'zooming at the middle keeps the pan');
  assert.deepEqual(anchoredZoomPan({ x: 1, y: 1 }, null, 40, 80), { x: 1, y: 1 });
  // Zooming back out at the same point undoes it.
  const there = anchoredZoomPan({ x: 0, y: 0 }, { x: 80, y: -40 }, 40, 80);
  assert.deepEqual(anchoredZoomPan(there, { x: 80, y: -40 }, 80, 40), { x: 0, y: 0 });
});

test('a drag coasts only when let go while still moving', () => {
  const fast = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 30, y: 0 }, { t: 80, x: 54, y: 9 }];
  const velocity = releaseVelocity(fast, 90);
  assert.ok(Math.abs(velocity.vx - 0.675) < 1e-9 && Math.abs(velocity.vy - 0.1125) < 1e-9);
  assert.equal(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 80, x: 8, y: 0 }], 90), null, 'too slow');
  assert.equal(releaseVelocity(fast, 400), null, 'held still before letting go');
  assert.equal(releaseVelocity([{ t: 10, x: 0, y: 0 }], 20), null);
  assert.equal(releaseVelocity([{ x: 0, y: 0 }, { x: 50, y: 0 }], NaN), null, 'no timing, no coast');
});

const DIR_OFFSETS = {
  north: { dx: 0, dy: -1, dz: 0 }, south: { dx: 0, dy: 1, dz: 0 },
  east: { dx: 1, dy: 0, dz: 0 }, west: { dx: -1, dy: 0, dz: 0 },
  up: { dx: 0, dy: 0, dz: 1 }, down: { dx: 0, dy: 0, dz: -1 },
};

// A tower: a hall with a stair up to a loft two rooms long, and a cellar.
function tower() {
  const rooms = new Map([
    ['hall', { id: 'hall', name: 'Great Hall', area: 'T', environment: 'inside', x: 0, y: 0, z: 0, exits: { up: 'loft', down: 'cellar', east: 'yard' } }],
    ['yard', { id: 'yard', name: 'Yard', area: 'T', environment: 'outside', x: 1, y: 0, z: 0, exits: { west: 'hall' }, details: ['shop'] }],
    ['loft', { id: 'loft', name: 'Loft', area: 'T', environment: 'inside', x: 0, y: 0, z: 1, exits: { down: 'hall', north: 'attic' } }],
    ['attic', { id: 'attic', name: 'Attic Store', area: 'T', environment: 'inside', x: 0, y: -1, z: 1, exits: { south: 'loft' } }],
    ['cellar', { id: 'cellar', name: 'Cellar', area: 'T', environment: 'inside', x: 0, y: 0, z: -1, exits: { up: 'hall' } }],
  ]);
  return {
    DIR_OFFSETS,
    getCurrentRoomId: () => 'hall',
    getRoom: (id) => rooms.get(id) || null,
    getRoomsByArea: () => [...rooms.values()],
    getMapStatus: () => '',
    getAreaName: () => 'Tower',
    getAuthority: () => 'authoritative',
    clearMapDataForArea: () => {},
  };
}

function body(dataset = {}) {
  let html = '';
  return {
    dataset: { mapZoom: '1', ...dataset },
    clientWidth: 360,
    clientHeight: 360,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; },
    querySelector: () => null,
  };
}

const roomIds = (html) => [...html.matchAll(/data-room-id="([^"]+)"/g)].map((m) => m[1]).sort();

test('the map shows another floor with the player ghosted where they stand', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const home = body();
  renderer.render(home, tower());
  assert.deepEqual(roomIds(home.innerHTML), ['hall', 'yard']);
  assert.deepEqual(renderer.getView().levels, [-1, 0, 1]);
  assert.equal(renderer.getView().viewZ, 0);
  assert.match(home.innerHTML, /map-player-marker/);
  assert.doesNotMatch(home.innerHTML, /map-player-ghost|map-tile-ghost/);

  const up = body({ mapLevel: '1' });
  renderer.render(up, tower());
  assert.deepEqual(roomIds(up.innerHTML), ['attic', 'loft']);
  assert.equal(renderer.getView().viewZ, 1);
  assert.equal(renderer.getView().homeZ, 0);
  assert.doesNotMatch(up.innerHTML, /map-player-marker/, 'the player is not on this floor');
  assert.match(up.innerHTML, /<div class="map-player-ghost" style="grid-column:\d+ \/ span 1;grid-row:\d+ \/ span 1" title="You are 1 level below">/);
  assert.equal((up.innerHTML.match(/map-tile map-tile-ghost/g) || []).length, 1, 'the yard shows faintly; the hall is under the loft');
  assert.match(up.innerHTML, /Z:1 <span class="map-zlevel-home">\(you: 0\)<\/span>/);

  const down = body({ mapLevel: '-1' });
  renderer.render(down, tower());
  assert.deepEqual(roomIds(down.innerHTML), ['cellar']);
  assert.match(down.innerHTML, /title="You are 1 level above"/);

  assert.equal(mapLevelOffset('2'), 2);
  assert.equal(mapLevelOffset('x'), 0);
  assert.equal(mapLevelOffset(-999), -50);
});

test('pins draw as a badge on the room, whose card (not a title) names them', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const map = body();
  renderer.render(map, tower(), { pins: { yard: { kind: 'danger', note: 'Wasps nest' } } });
  assert.match(map.innerHTML, /map-tile-pinned" data-room-id="yard"/);
  assert.doesNotMatch(map.innerHTML, /class="map-tile[^"]*" title=/, 'tiles carry no title');
  assert.match(map.innerHTML, /<span class="map-pin map-pin-danger"><svg/);
  renderer.render(map, tower());
  assert.doesNotMatch(map.innerHTML, /map-pin/);
});

test('zooming at a point eases in around it, with the camera glide when both run', () => {
  let now = 1000;
  const renderer = createMapRenderer({ now: () => now });
  const map = body();
  renderer.render(map, tower());
  map.dataset.mapZoom = '1.25';
  now += 5;
  renderer.render(map, tower(), { zoomAnchor: { x: 20, y: -10 } });
  const frame = map.innerHTML.match(/<div class="map-grid-frame[^>]*>/)[0];
  assert.match(frame, /map-grid-frame map-zoom-glide"/);
  assert.match(frame, /--map-zoom-from:0.8;transform-origin:\d+(\.\d+)?px \d+(\.\d+)?px;animation-name:map-zoom-glide;animation-delay:-0ms;/);
  now += 300;
  renderer.render(map, tower());
  assert.doesNotMatch(map.innerHTML, /map-zoom-glide/, 'over once it has run');
  map.dataset.mapZoom = '1';
  renderer.render(map, tower());
  assert.doesNotMatch(map.innerHTML, /map-zoom-glide/, 'a zoom with no anchor just changes');
});

test('pins are kept per character, cleaned, capped, and removable', () => {
  assert.equal(mapPinStorageKey('abc'), 'darkflow-map-pins:abc');
  assert.deepEqual(MAP_PIN_KINDS.map((entry) => entry.kind), ['note', 'quest', 'danger', 'loot', 'home']);
  assert.match(mapPinIconSvg('loot'), /^<svg viewBox="0 0 12 12"/);
  assert.equal(mapPinIconSvg('nonsense'), mapPinIconSvg('note'));

  let state = setMapPin(null, { id: 'yard', name: 'Yard', area: 'T', z: 0 }, 'quest', '  Talk to   the smith  ', 10);
  assert.deepEqual(state.pins.yard, { kind: 'quest', note: 'Talk to the smith', name: 'Yard', area: 'T', z: 0, at: 10 });
  state = setMapPin(state, { id: 'hall', name: 'Great Hall', area: 'T', z: 0 }, 'bogus', 'x'.repeat(300), 20);
  assert.equal(state.pins.hall.kind, 'note', 'an unknown kind is a note');
  assert.equal(state.pins.hall.note.length, 200);
  state = removeMapPin(state, 'yard');
  assert.deepEqual(Object.keys(state.pins), ['hall']);
  assert.deepEqual(normalizeMapPins('garbage'), { version: 1, pins: {} });
  assert.deepEqual(setMapPin(state, null, 'note', ''), state, 'no room, no change');

  const many = { pins: Object.fromEntries(Array.from({ length: MAX_MAP_PINS + 5 }, (_, i) => ['r' + i, { kind: 'note', at: i }])) };
  const capped = normalizeMapPins(many);
  assert.equal(Object.keys(capped.pins).length, MAX_MAP_PINS);
  assert.ok(!capped.pins.r0 && capped.pins['r' + (MAX_MAP_PINS + 4)], 'the oldest go first');
});

test('search finds rooms by name, service, and pin, best matches first', () => {
  const rooms = tower().getRoomsByArea();
  const pins = { cellar: { kind: 'loot', note: 'Hidden chest behind barrels', area: 'T', name: 'Cellar', at: 5 } };
  assert.deepEqual(searchMapRooms(rooms, 'hall', pins).map((r) => r.id), ['hall']);
  assert.deepEqual(searchMapRooms(rooms, 'a', pins).map((r) => r.id).slice(0, 2), ['attic', 'yard'],
    'names that start with the word come before ones that contain it, shortest first');
  assert.deepEqual(searchMapRooms(rooms, 'store', pins).map((r) => r.id), ['yard', 'attic'],
    'a shop is a store; a room called Store matches too');
  assert.deepEqual(searchMapRooms(rooms, 'chest', pins).map((r) => r.id), ['cellar'], 'pin notes are searched');
  assert.deepEqual(searchMapRooms(rooms, 'loot', pins).map((r) => r.id), ['cellar'], 'and pin kinds');
  assert.deepEqual(searchMapRooms(rooms, 'great hall', pins).map((r) => r.id), ['hall'], 'every word must match');
  assert.deepEqual(searchMapRooms(rooms, '   ', pins), []);
  assert.equal(searchMapRooms(rooms, 'cellar', pins)[0].pin.kind, 'loot');

  const pinned = pinnedRoomsInArea({ ...pins, far: { kind: 'note', area: 'Elsewhere', name: 'Far', at: 9 } }, 'T');
  assert.deepEqual(pinned.map((r) => r.id), ['cellar']);
});
