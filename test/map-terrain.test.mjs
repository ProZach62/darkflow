// Painted terrain: which regions and roads get painted, and that the renderer
// only lays the terrain canvas under the rooms in painted mode.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planTerrain,
  terrainPlanKey,
  terrainTextureFor,
  TERRAIN_DRAW_ORDER,
  TERRAIN_TEXTURES,
} from '../public/js/map-terrain-core.js';
import { createMapRenderer } from '../public/js/map-renderer-core.js';
import { TERRAIN_PRIORITY } from '../public/js/terrain-semantics.mjs';

const cell = (col, row, terrain, extra = {}) => ({ col, row, terrain, ...extra });
const link = (a, b) => ({ from: { col: a[0], row: a[1] }, to: { col: b[0], row: b[1] } });
const regionOf = (plan, terrain) => plan.layers.find((layer) => layer.terrain === terrain);

test('every terrain the map knows has a draw order and a texture', () => {
  assert.deepEqual([...TERRAIN_DRAW_ORDER].sort(), [...TERRAIN_PRIORITY].sort());
  for (const terrain of TERRAIN_DRAW_ORDER) {
    assert.ok(TERRAIN_TEXTURES[terrain].src, terrain);
    assert.ok(TERRAIN_TEXTURES[terrain].span > 0, terrain);
  }
});

test('painted textures are used where the index lists them, and the old tiles elsewhere', () => {
  const index = { version: 1, span: 3, textures: ['forest', 'lake'] };
  assert.deepEqual(terrainTextureFor('forest', index), { src: '/assets/terrain/forest.webp', span: 3 });
  assert.deepEqual(terrainTextureFor('city', index), TERRAIN_TEXTURES.city, 'not built yet');
  assert.deepEqual(terrainTextureFor('forest', null), TERRAIN_TEXTURES.forest, 'no index at all');
  assert.equal(terrainTextureFor('forest', { textures: ['forest'], span: 'wide' }).span, 2.5, 'a bad span falls back');
  assert.deepEqual(terrainTextureFor('../x', { textures: ['../x'] }), TERRAIN_TEXTURES.outside, 'only plain names');
});

test('rooms join into one region per terrain, painted low ground first', () => {
  const plan = planTerrain([
    cell(0, 0, 'forest'), cell(1, 0, 'forest'), cell(2, 0, 'lake'),
    cell(0, 1, 'mountain'), cell(1, 1, 'plains'),
  ]);
  assert.deepEqual(plan.layers.map((layer) => layer.terrain), ['lake', 'plains', 'forest', 'mountain']);
  assert.deepEqual(regionOf(plan, 'forest').cells, [{ col: 0, row: 0 }, { col: 1, row: 0 }]);
  assert.equal(regionOf(plan, 'lake').shore, true, 'water gets a shore');
  assert.equal(regionOf(plan, 'forest').shore, false);
  assert.deepEqual(plan.roads, []);
});

test('a road stands on the land around it and runs along its exits', () => {
  const plan = planTerrain(
    [
      cell(0, 0, 'forest'), cell(0, 1, 'forest'), cell(2, 1, 'plains'),
      cell(1, 1, 'road'), cell(1, 0, 'path'), cell(2, 0, 'city'),
    ],
    [link([1, 1], [0, 1]), link([0, 1], [1, 1]), link([1, 1], [1, 0]), link([1, 0], [2, 0]), link([0, 0], [0, 1])],
  );
  // The road's neighbours: forest twice, plains, city (path is itself a road).
  assert.ok(regionOf(plan, 'forest').cells.some((c) => c.col === 1 && c.row === 1), 'the road is painted over forest');
  assert.ok(regionOf(plan, 'forest').cells.some((c) => c.col === 1 && c.row === 0), 'and so is the path beside it');
  assert.deepEqual(plan.roads, [
    { kind: 'road', from: { col: 1, row: 1 }, to: { col: 1, row: 0 } },
  ], 'road to road only, and a road meeting a path is a road; the forest and the town keep their connectors');

  const byWater = planTerrain([cell(0, 0, 'lake'), cell(1, 0, 'lake'), cell(0, 1, 'road'), cell(1, 1, 'farm')]);
  assert.ok(regionOf(byWater, 'farm').cells.some((c) => c.col === 0 && c.row === 1), 'a road beside a lake stands on land');
});

test('a lone road room is a patch of road; distant links and unseen rooms are not painted', () => {
  const plan = planTerrain(
    [cell(0, 0, 'road'), cell(3, 0, 'road'), cell(4, 0, 'forest', { unseen: true })],
    [link([0, 0], [3, 0]), link([3, 0], [4, 0])],
  );
  assert.deepEqual(plan.roads, [
    { kind: 'road', from: { col: 0, row: 0 }, to: { col: 0, row: 0 } },
    { kind: 'road', from: { col: 3, row: 0 }, to: { col: 3, row: 0 } },
  ]);
  assert.deepEqual(plan.layers.map((layer) => layer.terrain), ['plains'], 'the unseen forest is left for the fog');
  assert.deepEqual(planTerrain([cell(0, 0, 'volcano')]).layers[0].terrain, 'outside', 'unknown terrain is open ground');
  assert.deepEqual(planTerrain(null), { layers: [], roads: [] });
});

test('the plan key changes with the scene and not with the order it was given in', () => {
  const a = planTerrain([cell(0, 0, 'forest'), cell(1, 0, 'road')], [link([0, 0], [1, 0])]);
  const b = planTerrain([cell(1, 0, 'road'), cell(0, 0, 'forest')], [link([1, 0], [0, 0])]);
  assert.equal(terrainPlanKey(a), terrainPlanKey(b));
  const c = planTerrain([cell(0, 0, 'forest'), cell(1, 0, 'path')], [link([0, 0], [1, 0])]);
  assert.notEqual(terrainPlanKey(a), terrainPlanKey(c));
});

function source() {
  const rooms = new Map([
    ['A', { id: 'A', name: 'Glade', area: 'T', environment: 'forest', x: 0, y: 0, z: 0, exits: { east: 'B' } }],
    ['B', { id: 'B', name: 'Trail', area: 'T', environment: 'road', x: 1, y: 0, z: 0, exits: { west: 'A' } }],
  ]);
  return {
    DIR_OFFSETS: { east: { dx: 1, dy: 0, dz: 0 }, west: { dx: -1, dy: 0, dz: 0 } },
    getCurrentRoomId: () => 'A',
    getRoom: (id) => rooms.get(id) || null,
    getRoomsByArea: () => [...rooms.values()],
    getMapStatus: () => '',
    getAreaName: () => 'T',
    getAuthority: () => 'authoritative',
    clearMapDataForArea: () => {},
  };
}

function body(style) {
  let html = '';
  return {
    dataset: { mapZoom: '1', ...(style ? { mapStyle: style } : {}) },
    clientWidth: 300,
    clientHeight: 300,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; },
    querySelector: () => null,
  };
}

test('the renderer lays the terrain canvas under the rooms only in painted mode', () => {
  const renderer = createMapRenderer({ now: () => 0 });
  const painted = body('painted');
  renderer.render(painted, source());
  assert.match(painted.innerHTML, /<div class="map-grid" style="[^"]*" data-map-style="painted"><canvas class="map-terrain" aria-hidden="true" style="grid-column:1 \/ -1;grid-row:1 \/ -1;width:\d+px;height:\d+px"><\/canvas>/);

  for (const style of ['tiles', undefined]) {
    const plain = body(style);
    renderer.render(plain, source());
    assert.doesNotMatch(plain.innerHTML, /map-terrain|data-map-style/);
    assert.match(plain.innerHTML, /map-tile-forest/, 'the terrain class stays for the tile look');
  }
});
