// The map's game feel: the marker stepping and the camera gliding, fog at the
// edge of the explored map, rooms clearing out of the fog, the time-of-day
// tint, service icons, and route marks. Drives the renderer with a small
// in-memory source so each test controls exactly what is mapped.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceMapMotion,
  createMapRenderer,
  mapDetailIconSvg,
  MAP_DETAIL_ICON_KINDS,
  trackMapReveals,
} from '../public/js/map-renderer-core.js';
import { mapRouteMarks } from '../public/js/map-route-core.js';

const DIR_OFFSETS = {
  north: { dx: 0, dy: -1, dz: 0 }, south: { dx: 0, dy: 1, dz: 0 },
  east: { dx: 1, dy: 0, dz: 0 }, west: { dx: -1, dy: 0, dz: 0 },
  northeast: { dx: 1, dy: -1, dz: 0 }, northwest: { dx: -1, dy: -1, dz: 0 },
  southeast: { dx: 1, dy: 1, dz: 0 }, southwest: { dx: -1, dy: 1, dz: 0 },
  up: { dx: 0, dy: 0, dz: 1 }, down: { dx: 0, dy: 0, dz: -1 },
};

function makeSource(rooms, currentId) {
  const byId = new Map(rooms.map((room) => [room.id, { z: 0, exits: {}, ...room }]));
  const source = {
    DIR_OFFSETS,
    current: currentId,
    getCurrentRoomId: () => source.current,
    getRoom: (id) => byId.get(id) || null,
    getRoomsByArea: (area) => [...byId.values()].filter((room) => room.area === area),
    getMapStatus: () => '',
    getAreaName: () => 'Test Area',
    getAuthority: () => 'authoritative',
    clearMapDataForArea: () => {},
    add(room) { byId.set(room.id, { z: 0, exits: {}, ...room }); },
  };
  return source;
}

function makeBody(dataset = {}) {
  let html = '';
  return {
    dataset: { mapZoom: '1', ...dataset },
    clientWidth: 400,
    clientHeight: 400,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; },
    querySelector: () => null,
  };
}

// A road running east: W - A - E, each linked both ways.
function road() {
  return [
    { id: 'W', name: 'West End', area: 'T', environment: 'road', x: -1, y: 0, exits: { east: 'A' } },
    { id: 'A', name: 'Crossing', area: 'T', environment: 'road', x: 0, y: 0, exits: { west: 'W', east: 'E' } },
    { id: 'E', name: 'East End', area: 'T', environment: 'road', x: 1, y: 0, exits: { west: 'A' } },
  ];
}

function clockAt(start = 1000) {
  const clock = { t: start, now: () => clock.t };
  return clock;
}

const markerOf = (html) => (html.match(/<div class="map-player-marker[^>]*>/) || [''])[0];
const frameOf = (html) => (html.match(/<div class="map-grid-frame[^>]*>/) || [''])[0];

test('the marker is its own layer on the player cell, and a first render does not move', () => {
  const clock = clockAt();
  const renderer = createMapRenderer({ now: clock.now });
  const body = makeBody();
  renderer.render(body, makeSource(road(), 'A'));
  const marker = markerOf(body.innerHTML);
  assert.match(marker, /grid-column:\d+ \/ span 1;grid-row:\d+ \/ span 1;/, 'exactly one cell');
  assert.doesNotMatch(marker, /map-marker-step/);
  assert.doesNotMatch(frameOf(body.innerHTML), /map-camera-glide/);
  assert.match(body.innerHTML, /map-tile-player/, 'the player tile keeps its class');
});

test('stepping east slides the marker in from the west while the camera follows', () => {
  const clock = clockAt();
  const renderer = createMapRenderer({ now: clock.now });
  const body = makeBody();
  const source = makeSource(road(), 'A');
  renderer.render(body, source);
  source.current = 'E';
  clock.t += 10;
  renderer.render(body, source);
  const marker = markerOf(body.innerHTML);
  assert.match(marker, /map-marker-step/);
  assert.match(marker, /--map-marker-x:-40px;--map-marker-y:0px;animation-delay:-0ms;/, 'one cell back, before scaling');
  const frame = frameOf(body.innerHTML);
  assert.match(frame, /map-camera-glide/);
  assert.match(frame, /--map-cam-x:40px;--map-cam-y:0px;/, 'the view starts where it was');

  // A re-render mid-glide carries on from the time already spent.
  clock.t += 100;
  renderer.render(body, source);
  assert.match(markerOf(body.innerHTML), /animation-delay:-100ms;/);
  assert.match(frameOf(body.innerHTML), /animation-delay:-100ms;/);

  // Once both have finished, nothing is left animating.
  clock.t += 400;
  renderer.render(body, source);
  assert.doesNotMatch(markerOf(body.innerHTML), /map-marker-step/);
  assert.doesNotMatch(frameOf(body.innerHTML), /map-camera-glide/);
});

test('reduced motion, a long jump, and a new area all cut instead of gliding', () => {
  const clock = clockAt();
  const still = createMapRenderer({ now: clock.now });
  const body = makeBody({ mapMotion: 'reduce' });
  const source = makeSource(road(), 'A');
  still.render(body, source);
  source.current = 'E';
  still.render(body, source);
  assert.doesNotMatch(body.innerHTML, /map-marker-step|map-camera-glide/);

  const room = { area: 'T', z: 0, x: 0, y: 0 };
  const start = advanceMapMotion(null, room, 0, false);
  const far = advanceMapMotion(start, { ...room, x: 5 }, 10, false);
  assert.deepEqual([far.cam, far.marker], [{ x: 0, y: 0 }, { x: 0, y: 0 }], 'a teleport cuts');
  const elsewhere = advanceMapMotion(start, { ...room, area: 'U', x: 1 }, 10, false);
  assert.deepEqual(elsewhere.cam, { x: 0, y: 0 });
  assert.equal(advanceMapMotion(start, room, 50, false), start, 'standing still keeps the glide going');
  assert.equal(advanceMapMotion(start, null, 50, false), null);
});

test('a second step mid-glide starts from where the first had got to', () => {
  const room = { area: 'T', z: 0, x: 0, y: 0 };
  const first = advanceMapMotion(advanceMapMotion(null, room, 0, false), { ...room, x: 1 }, 0, false);
  assert.deepEqual(first.cam, { x: 1, y: 0 });
  const second = advanceMapMotion(first, { ...room, x: 2 }, 0, false);
  assert.deepEqual(second.cam, { x: 2, y: 0 }, 'no time has passed, so the view is still two back');
  const later = advanceMapMotion(first, { ...room, x: 2 }, 10_000, false);
  assert.deepEqual(later.cam, { x: 1, y: 0 }, 'long settled, only the new step remains');
});

test('empty cells beside explored rooms are fog, and an unexplored exit leads into brighter fog', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const body = makeBody();
  const rooms = road();
  rooms[1].exits.north = 'unknown-room';
  renderer.render(body, makeSource(rooms, 'A'));
  const html = body.innerHTML;
  assert.equal((html.match(/map-tile-fog-lead/g) || []).length, 1, 'just the cell north of the crossing');
  // Three rooms in a row: the eight cells around each, less the rooms themselves.
  assert.equal((html.match(/map-tile map-tile-fog/g) || []).length, 12);
  assert.ok(html.includes('<div class="map-tile"></div>'), 'cells far from anything are left dark');
});

test('rooms known but not yet visited are drawn as silhouettes', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const body = makeBody();
  const rooms = road();
  rooms[2].observed = false;
  renderer.render(body, makeSource(rooms, 'A'));
  const unseen = body.innerHTML.match(/<div class="map-tile map-tile-room[^"]*map-tile-unseen[^"]*"[^>]*data-room-id="([^"]+)"/g) || [];
  assert.equal(unseen.length, 1);
  assert.match(unseen[0], /data-room-id="E"/);
});

test('rooms found while exploring clear out of the fog; arriving and bulk loads do not', () => {
  const clock = clockAt();
  const renderer = createMapRenderer({ now: clock.now });
  const body = makeBody();
  const source = makeSource(road(), 'A');
  renderer.render(body, source);
  assert.doesNotMatch(body.innerHTML, /map-tile-revealed/, 'what was there on arrival is not new');

  source.add({ id: 'N', name: 'North Lane', area: 'T', environment: 'road', x: 0, y: -1, exits: { south: 'A' } });
  clock.t += 5;
  renderer.render(body, source);
  assert.match(body.innerHTML, /map-tile-revealed" style="animation-delay:-0ms"[^>]*data-room-id="N"/);
  clock.t += 300;
  renderer.render(body, source);
  assert.match(body.innerHTML, /map-tile-revealed" style="animation-delay:-300ms"[^>]*data-room-id="N"/);
  clock.t += 500;
  renderer.render(body, source);
  assert.doesNotMatch(body.innerHTML, /map-tile-revealed/, 'and then it is just a room');

  const bulk = trackMapReveals(trackMapReveals(null, 'T', [], 0, false), 'T',
    Array.from({ length: 41 }, (_, i) => ({ id: 'r' + i })), 1, false);
  assert.equal(bulk.at.size, 0, 'a load of 41 rooms is not exploring');
  const calm = trackMapReveals(trackMapReveals(null, 'T', [], 0, false), 'T', [{ id: 'x' }], 1, true);
  assert.equal(calm.at.size, 0, 'nor is anything with reduced motion');
});

test('the time of day tints the map from the marker, with a pool of light at night', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const body = makeBody();
  const source = makeSource(road(), 'A');
  renderer.render(body, source, { ambience: { color: '#22335f', alpha: 0.45, light: true } });
  const marker = markerOf(body.innerHTML);
  assert.match(marker, /map-tinted map-lit/);
  assert.match(marker, /--map-tint:#22335f;--map-tint-alpha:0.45;/);

  renderer.render(body, source, { ambience: { color: '#ffb27a', alpha: 0.2, light: false } });
  assert.match(markerOf(body.innerHTML), /map-tinted"/);

  renderer.render(body, source, { ambience: { color: 'red;background:url(x)', alpha: 1 } });
  assert.doesNotMatch(markerOf(body.innerHTML), /map-tinted|--map-tint/, 'only a plain hex colour is used');
  renderer.render(body, source);
  assert.doesNotMatch(markerOf(body.innerHTML), /map-tinted/);
});

test('services get drawn icons and anything else keeps its initial', () => {
  assert.deepEqual([...MAP_DETAIL_ICON_KINDS].sort(), ['bank', 'guild', 'post', 'pub', 'shop']);
  for (const kind of MAP_DETAIL_ICON_KINDS) assert.match(mapDetailIconSvg(kind), /^<svg viewBox="0 0 12 12"/);
  assert.equal(mapDetailIconSvg('stables'), '');

  const renderer = createMapRenderer({ now: () => 0 });
  const body = makeBody();
  const rooms = road();
  rooms[0].details = ['stables'];
  rooms[2].details = ['pub'];
  renderer.render(body, makeSource(rooms, 'A'));
  assert.match(body.innerHTML, /<span class="map-detail">S<\/span>/);
  assert.match(body.innerHTML, /<span class="map-detail map-detail-icon map-detail-pub"><svg/);
});

test('route marks list the rooms in order and both halves of each connector', () => {
  const marks = mapRouteMarks('A', [
    { dir: 'east', destId: 'E' },
    { dir: 'up', destId: 'Loft' },
    { dir: 'northwest', destId: 'Attic' },
  ]);
  assert.deepEqual(marks.rooms, [{ id: 'E', order: 1 }, { id: 'Loft', order: 2 }, { id: 'Attic', order: 3 }]);
  assert.deepEqual(marks.links, [
    { id: 'A', abbr: 'e' }, { id: 'E', abbr: 'w' },
    { id: 'Loft', abbr: 'nw' }, { id: 'Attic', abbr: 'se' },
  ], 'up and down have no connector to light');
  assert.equal(marks.targetId, 'Attic');
  assert.equal(marks.steps, 3);
  assert.equal(mapRouteMarks('A', []), null);
  assert.equal(mapRouteMarks(null, [{ dir: 'east', destId: 'E' }]), null);
});
