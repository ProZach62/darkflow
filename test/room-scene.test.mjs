import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roomSceneBuildingPosition,
  roomSceneBuildingSprite,
  roomSceneDetails,
  roomSceneDoorSprite,
  roomSceneExitPosition,
  roomSceneOccupantPosition,
  roomSceneOccupantSprite,
  roomScenePropSprite,
  roomSceneTargetMatches,
  roomSceneTargetPosition,
  roomSceneTargets,
  roomSceneTerrain,
  roomSceneTexture,
} from '../public/js/room-scene-core.mjs';

test('room scenes choose a focused floor texture from compound terrain', () => {
  assert.equal(roomSceneTerrain('outside, road, city'), 'city');
  assert.equal(roomSceneTexture('outside, road, city'), 'city');
  assert.equal(roomSceneTexture('inside, city'), 'inside');
  assert.equal(roomSceneTexture('jungle'), 'forest');
  assert.equal(roomSceneTexture('sea'), 'lake');
  assert.equal(roomSceneTexture('unknown'), 'plains');
});

test('room scene details select available building art', () => {
  assert.deepEqual(roomSceneDetails(['shop', 'bank', 'shop']), ['shop', 'bank']);
  assert.deepEqual(roomSceneDetails({ pub: 1, fountain: true, hidden: 0 }), ['pub', 'fountain']);
  assert.equal(roomSceneBuildingSprite('post office'), 'post');
  assert.equal(roomSceneBuildingSprite('tower'), 'ruins');
  assert.equal(roomSceneBuildingSprite('fountain'), null);
});

test('room scene occupants select stable art and bounded positions', () => {
  assert.equal(roomSceneOccupantSprite({ race: 'elf', gender: 'female' }), 'elf-female');
  assert.equal(roomSceneOccupantSprite({ name: 'a frost giant' }), 'ice-ogre');
  assert.equal(roomSceneOccupantSprite({ race: 'unknown horror' }), 'humanoid');
  assert.deepEqual(roomSceneOccupantPosition(0), { x: 50, y: 62 });
  assert.deepEqual(roomSceneOccupantPosition(8), roomSceneOccupantPosition(0));
  assert.notDeepEqual(roomSceneBuildingPosition(0), roomSceneBuildingPosition(1));
});

test('room scene exits expose positions and door art without inventing directions', () => {
  assert.deepEqual(roomSceneExitPosition('north'), { x: 68, y: 29, label: 'N' });
  assert.equal(roomSceneExitPosition('portal'), null);
  assert.equal(roomSceneDoorSprite(3), 'door-locked');
  assert.equal(roomSceneDoorSprite('closed'), 'door-closed');
  assert.equal(roomSceneDoorSprite(null), null);
});

test('room scene catalogue prefers structured looks and maps familiar nouns to prop art', () => {
  const targets = roomSceneTargets(
    [{ id: 'fountain-1', name: 'a marble fountain', nouns: ['fountain', 'water'], sprite: 'fountain' }],
    ['shop'],
  );
  assert.deepEqual(targets, [
    {
      id: 'fountain-1',
      name: 'a marble fountain',
      nouns: ['fountain', 'water'],
      kind: '',
      sprite: 'fountain',
    },
  ]);
  assert.equal(roomScenePropSprite(targets[0]), 'fountain');
  assert.equal(roomSceneTargetMatches(targets[0], 'water'), true);
  assert.equal(roomSceneTargetMatches(targets[0], 'tree'), false);
  assert.deepEqual(roomSceneTargetPosition(8), roomSceneTargetPosition(0));
});

test('room scene catalogue falls back to legacy details', () => {
  assert.deepEqual(roomSceneTargets('', ['shop', 'old tree']), [
    { id: 'detail:shop', name: 'shop', nouns: ['shop'] },
    { id: 'detail:old-tree', name: 'old tree', nouns: ['old-tree'] },
  ]);
  assert.equal(roomScenePropSprite({ name: 'old oak tree', nouns: ['oak'] }), 'tree');
  assert.equal(roomScenePropSprite({ name: 'mysterious portal', nouns: ['portal'] }), null);
});
