// The map's readability: the card over a hovered room, landmark labels on
// the zoomed-out map, and the marker's facing arrow.
import test from 'node:test';
import assert from 'node:assert/strict';

import { advanceMapMotion, createMapRenderer } from '../public/js/map-renderer-core.js';
import { mapRoomCard, mapServiceName } from '../public/js/map-card-core.js';
import { mapLabelText, pickMapLabels } from '../public/js/map-labels-core.js';

const DIR_OFFSETS = {
  north: { dx: 0, dy: -1, dz: 0 }, south: { dx: 0, dy: 1, dz: 0 },
  east: { dx: 1, dy: 0, dz: 0 }, west: { dx: -1, dy: 0, dz: 0 },
  up: { dx: 0, dy: 0, dz: 1 }, down: { dx: 0, dy: 0, dz: -1 },
};

function makeSource(rooms, currentId) {
  const byId = new Map(rooms.map((room) => [room.id, { z: 0, exits: {}, ...room }]));
  return {
    DIR_OFFSETS,
    getCurrentRoomId: () => currentId,
    getRoom: (id) => byId.get(id) || null,
    getRoomsByArea: (area) => [...byId.values()].filter((room) => room.area === area),
    getMapStatus: () => '',
    getAreaName: () => 'Test Area',
    getAuthority: () => 'authoritative',
    clearMapDataForArea: () => {},
  };
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

// A market square: the square, a shop to the east, a bank north, a gate
// west into another area, and a cellar mapped to the square's own cell.
function market() {
  return [
    { id: 'sq', name: 'Market Square', area: 'M', environment: 'outside, city, road', x: 0, y: 0,
      exits: { west: 'gate', east: 'shop', north: 'bank', down: 'cellar', southeast: 'ghost', enter: 'shop' } },
    { id: 'shop', name: 'Corner Shop', area: 'M', environment: 'inside', x: 1, y: 0, exits: { west: 'sq' }, details: ['shop'] },
    { id: 'bank', name: 'Gold Bank', area: 'M', environment: 'inside', x: 0, y: -1, exits: { south: 'sq' }, details: ['bank', 'post'] },
    { id: 'gate', name: 'West Gate', area: 'Fields', environment: 'outside, road', x: -1, y: 0, exits: { east: 'sq' } },
    { id: 'cellar', name: 'Cellar', area: 'M', environment: 'underground', x: 0, y: 0, exits: { up: 'sq' } },
  ];
}

test('a room card names the room, its terrain, services, exits, the rooms sharing its cell, and its pin', () => {
  const source = makeSource(market(), 'sq');
  const card = mapRoomCard(source.getRoom('sq'), source, { kind: 'quest', note: 'Meet Aldo here' });
  assert.equal(card.name, 'Market Square');
  assert.equal(card.terrain, 'City, road', 'the generic "outside" is left out when there is more');
  assert.deepEqual(card.services, []);
  assert.deepEqual(card.exits, [
    { dir: 'north', to: 'Gold Bank', area: null },
    { dir: 'east', to: 'Corner Shop', area: null },
    { dir: 'southeast', to: null, area: null },
    { dir: 'west', to: 'West Gate', area: 'Fields' },
    { dir: 'down', to: 'Cellar', area: null },
    { dir: 'enter', to: 'Corner Shop', area: null },
  ], 'compass order, then up and down, then anything else');
  assert.deepEqual(card.stack, ['Cellar']);
  assert.equal(card.moreStack, 0);
  assert.deepEqual(card.pin, { kind: 'quest', label: 'Quest', note: 'Meet Aldo here' });

  const bank = mapRoomCard(source.getRoom('bank'), source);
  assert.deepEqual(bank.services, ['Bank', 'Post office']);
  assert.equal(bank.terrain, 'Inside');
  assert.equal(bank.pin, null);
  assert.deepEqual(bank.stack, []);
  assert.equal(mapServiceName('stable'), 'Stable');
  assert.equal(mapRoomCard(null, source), null);
});

test('a card lists at most ten exits and six rooms sharing the cell, and counts the rest', () => {
  const exits = {};
  const rooms = [];
  for (let i = 0; i < 13; i++) {
    exits['portal' + String(i).padStart(2, '0')] = 'r' + i;
    rooms.push({ id: 'r' + i, name: 'Room ' + i, area: 'M', environment: 'inside', x: 0, y: 0 });
  }
  rooms.push({ id: 'hub', name: 'Hub', area: 'M', environment: 'inside', x: 0, y: 0, exits });
  const source = makeSource(rooms, 'hub');
  const card = mapRoomCard(source.getRoom('hub'), source);
  assert.equal(card.exits.length, 10);
  assert.equal(card.moreExits, 3);
  assert.equal(card.stack.length, 6);
  assert.equal(card.moreStack, 7);
});

test('labels are cut to fit, pins come first, and labels that would overlap are left out', () => {
  assert.equal(mapLabelText('  The   Old Mill  '), 'The Old Mill');
  assert.equal(mapLabelText('The Very Long Name Of A Shop'), 'The Very Long Name Of A…');
  assert.equal(mapLabelText(''), '');

  // At 10px a cell (25% zoom), "Bank" is 36px: under four cells wide.
  const picked = pickMapLabels([
    { id: 'a', x: 0, y: 0, text: 'Bank', pinned: false, inView: true },
    { id: 'b', x: 1, y: 0, text: 'Armoury', pinned: true, inView: true },
    { id: 'c', x: 10, y: 0, text: 'Pub', pinned: false, inView: true },
    { id: 'd', x: 0, y: 5, text: 'Far Shop', pinned: false, inView: false },
    { id: 'e', x: 20, y: 0, text: '   ', pinned: true, inView: true },
  ], 10);
  assert.deepEqual(picked.map((label) => label.id), ['b', 'c', 'd'],
    'the pin wins the crowded spot, rooms in view before the margin, blank text dropped');

  // Zoomed in further, the same two fit side by side.
  assert.deepEqual(pickMapLabels([
    { id: 'a', x: 0, y: 0, text: 'Bank', pinned: false, inView: true },
    { id: 'b', x: 2, y: 0, text: 'Armoury', pinned: true, inView: true },
  ], 40).map((label) => label.id), ['b', 'a']);

  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, x: i * 20, y: 0, text: 'R' + i, inView: true }));
  assert.equal(pickMapLabels(many, 10).length, 40, 'at most forty');
});

test('zoomed out, landmark rooms are labelled under the marker layer; zoomed in, they are not', () => {
  const rooms = market();
  // The shop moved off east, so its label has room beside the bank's.
  rooms[1].x = 8;
  const renderer = createMapRenderer({ now: () => 0 });
  const far = makeBody({ mapZoom: '0.3' });
  renderer.render(far, makeSource(rooms, 'sq'), { pins: { bank: { kind: 'home', note: 'Way home' } } });
  const labels = [...far.innerHTML.matchAll(/<div class="map-label( map-label-pinned)?"[^>]*><span>([^<]*)<\/span>/g)]
    .map((m) => [m[2], !!m[1]]);
  assert.ok(labels.some(([text, pinned]) => text === 'Way home' && pinned), 'a pin is labelled with its note');
  assert.ok(labels.some(([text, pinned]) => text === 'Corner Shop' && !pinned), 'a shop is labelled with its name');
  assert.ok(far.innerHTML.indexOf('map-label') < far.innerHTML.indexOf('map-player-marker'),
    'labels come before the marker, which draws over them');
  assert.match(far.innerHTML, /--map-zoom:0\.3/, 'the grid tells the labels its scale');

  const near = makeBody();
  renderer.render(near, makeSource(rooms, 'sq'), { pins: { bank: { kind: 'home', note: 'Way home' } } });
  assert.doesNotMatch(near.innerHTML, /map-label/);
});

test('the marker faces the way the player last stepped, and keeps it through jumps and stairs', () => {
  const at = (x, y, extra = {}) => ({ area: 'T', z: 0, x, y, ...extra });
  let motion = advanceMapMotion(null, at(0, 0), 0, false);
  assert.equal(motion.facing, null, 'no step yet, no facing');
  motion = advanceMapMotion(motion, at(1, 0), 100, false);
  assert.equal(motion.facing, 90, 'east');
  motion = advanceMapMotion(motion, at(1, 0), 200, false);
  assert.equal(motion.facing, 90, 'standing still keeps it');
  motion = advanceMapMotion(motion, at(0, 1), 300, true);
  assert.equal(motion.facing, 225, 'southwest, with reduced motion too');
  motion = advanceMapMotion(motion, at(0, 0), 400, false);
  assert.equal(motion.facing, 0, 'north');
  motion = advanceMapMotion(motion, at(9, 9), 500, false);
  assert.equal(motion.facing, 0, 'a jump keeps the facing');
  motion = advanceMapMotion(motion, at(9, 9, { z: 1 }), 600, false);
  assert.equal(motion.facing, 0, 'so do the stairs');

  const rooms = [
    { id: 'A', name: 'A', area: 'T', environment: 'road', x: 0, y: 0, exits: { north: 'B' } },
    { id: 'B', name: 'B', area: 'T', environment: 'road', x: 0, y: -1, exits: { south: 'A' } },
  ];
  let now = 0;
  const renderer = createMapRenderer({ now: () => now });
  const map = makeBody();
  renderer.render(map, makeSource(rooms, 'A'));
  assert.doesNotMatch(map.innerHTML, /map-player-facing/);
  now = 1000;
  renderer.render(map, makeSource(rooms, 'B'));
  assert.match(map.innerHTML, /<span class="map-player-facing" style="rotate:0deg"><\/span>/);
});
