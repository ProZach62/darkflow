import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isoAdjacentMove,
  isoBuildingSprite,
  isoDepthKey,
  isoMovementProgress,
  isoOccupantSprite,
  isoRoomVariant,
  isoTerrainOrientation,
  isoTerrainMotion,
  isoTerrainColor,
  isoTerrainSprite,
  isoTerrainSpriteForExits,
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

test('road-like terrain follows the axis represented by mapped exits', () => {
  assert.equal(isoTerrainOrientation({ north: 1, south: 2 }), 'north-south');
  assert.equal(isoTerrainOrientation({ east: 1, west: 2 }), 'east-west');
  assert.equal(isoTerrainOrientation({ north: 1, east: 2 }), 'junction');
  assert.equal(isoTerrainOrientation({}), 'junction');
  assert.equal(isoTerrainSpriteForExits('road', { east: 1, west: 2 }), 'road');
  assert.equal(isoTerrainSpriteForExits('road', { west: 2 }), 'outside');
  assert.equal(isoTerrainSpriteForExits('path', { north: 1, east: 2 }), 'outside');
  assert.equal(isoTerrainSpriteForExits('forest', { east: 1, west: 2 }), 'forest');
});

test('isometric culling retains overscan but rejects distant rooms', () => {
  assert.equal(isoVisible({ x: -100, y: 50 }, { width: 320, height: 240 }), true);
  assert.equal(isoVisible({ x: 900, y: 50 }, { width: 320, height: 240 }), false);
});

test('isometric movement distinguishes adjacent rooms from teleports and eases the figure ahead', () => {
  const room = { area: 'city', x: 4, y: 7, z: 0 };
  assert.equal(isoAdjacentMove(room, { area: 'city', x: 5, y: 7, z: 0 }), true);
  assert.equal(isoAdjacentMove(room, { area: 'city', x: 6, y: 7, z: 0 }), false);
  assert.equal(isoAdjacentMove(room, { area: 'wilds', x: 5, y: 7, z: 0 }), false);

  assert.deepEqual(isoMovementProgress(0, 800), { camera: 0, figure: 0, done: false });
  const halfway = isoMovementProgress(400, 800);
  assert.ok(halfway.camera > 0.1 && halfway.camera < 0.25);
  assert.ok(halfway.figure > 0.99);
  assert.deepEqual(isoMovementProgress(900, 800), { camera: 1, figure: 1, done: true });
});

test('living isometric terrain gives water and swamp distinct bounded motion', () => {
  const river = isoTerrainMotion('river', 1.25, 1);
  const lake = isoTerrainMotion('lake', 1.25, 1);
  const swamp = isoTerrainMotion('swamp', 1.25, 1);
  assert.notDeepEqual(river, lake);
  assert.notDeepEqual(swamp, lake);
  assert.ok(Math.abs(river.x) <= 5);
  assert.ok(swamp.alpha > 0 && swamp.alpha < 0.2);
  assert.deepEqual(isoTerrainMotion('city', 4, 2), { x: 0, y: 0, alpha: 0 });
});
