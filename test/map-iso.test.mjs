import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isoBuildingSprite,
  isoDepthKey,
  isoOccupantSprite,
  isoRoomVariant,
  isoTerrainColor,
  isoTerrainSprite,
  isoVisible,
  projectIso,
  unprojectIso,
} from '../public/js/map-iso-core.js';

test('isometric projection gives Darkwind its classic north-up-right orientation', () => {
  assert.deepEqual(projectIso(1, 0), { x: 64, y: 32 });
  assert.deepEqual(projectIso(0, -1), { x: 64, y: -32 });
  assert.deepEqual(projectIso(0, 0, 1), { x: 0, y: -48 });
});

test('isometric projection round-trips asymmetric map coordinates', () => {
  const projected = projectIso(17, -4, 0, { centerX: 10, centerY: -2 });
  assert.deepEqual(unprojectIso(projected.x, projected.y, { centerX: 10, centerY: -2 }), {
    x: 17,
    y: -4,
  });
});

test('isometric presentation choices are stable and depth ordered', () => {
  assert.equal(isoRoomVariant('/domains/city/market', 3), isoRoomVariant('/domains/city/market', 3));
  assert.notEqual(isoTerrainColor('forest'), isoTerrainColor('sea'));
  assert.ok(isoDepthKey({ x: 3, y: 2, z: 0 }, 1) < isoDepthKey({ x: 3, y: 3, z: 0 }, 0));
});

test('isometric art selection maps services and occupant appearance hints', () => {
  assert.equal(isoBuildingSprite('post office'), 'post');
  assert.equal(isoBuildingSprite('guild'), 'guild');
  assert.equal(isoBuildingSprite('fountain'), null);

  assert.equal(isoOccupantSprite({ race: 'elf', gender: 'female' }), 'elf-female');
  assert.equal(isoOccupantSprite({ family: 'rift duergar', gender: 'male' }), 'dwarf-male');
  assert.equal(isoOccupantSprite({ name: 'a frost giant' }), 'ice-ogre');
  assert.equal(isoOccupantSprite({ race: 'unknown horror' }), 'humanoid');

  assert.equal(isoTerrainSprite('UNDERWATER'), 'underwater');
  assert.equal(isoTerrainSprite('../../unknown'), 'outside');
});

test('isometric culling retains overscan but rejects distant rooms', () => {
  assert.equal(isoVisible({ x: -100, y: 50 }, { width: 320, height: 240 }), true);
  assert.equal(isoVisible({ x: 900, y: 50 }, { width: 320, height: 240 }), false);
});
