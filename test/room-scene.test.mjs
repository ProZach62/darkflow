import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roomSceneAtmosphere,
  roomSceneBuildingPosition,
  roomSceneBuildingSprite,
  roomSceneDetails,
  roomSceneDoorSprite,
  roomSceneExitKind,
  roomSceneExitPosition,
  roomSceneOccupantPosition,
  roomSceneOccupantSprite,
  roomScenePropSprite,
  roomSceneTargetMatches,
  roomSceneTargetCommand,
  roomSceneTargetPosition,
  roomSceneTargets,
  roomSceneTerrain,
  roomSceneTexture,
  roomSceneWeaponSprite,
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
  assert.deepEqual(roomSceneExitPosition('north'), { x: 63, y: 29, label: 'North' });
  assert.equal(roomSceneExitPosition('portal'), null);
  assert.equal(roomSceneDoorSprite(3), 'door-locked');
  assert.equal(roomSceneDoorSprite('closed'), 'door-closed');
  assert.equal(roomSceneDoorSprite(null), null);
});

test('room scene catalogue prefers structured looks and maps familiar nouns to prop art', () => {
  const targets = roomSceneTargets(
    [
      {
        id: 'fountain-1',
        name: 'a marble fountain',
        nouns: ['fountain', 'water'],
        sprite: 'fountain',
        state: 'dry',
        category: 'scenery',
        cue: 'quest',
        verbs: ['look', 'drink', 'say hello'],
        position: { x: 30, y: 70 },
      },
    ],
    ['shop'],
  );
  assert.deepEqual(targets, [
    {
      id: 'fountain-1',
      name: 'a marble fountain',
      nouns: ['fountain', 'water'],
      kind: '',
      sprite: 'fountain',
      state: 'dry',
      category: 'scenery',
      cue: 'quest',
      verbs: ['look', 'drink'],
      position: { x: 30, y: 70 },
    },
  ]);
  assert.equal(roomScenePropSprite(targets[0]), 'fountain');
  assert.equal(roomSceneTargetMatches(targets[0], 'water'), true);
  assert.equal(roomSceneTargetMatches(targets[0], 'tree'), false);
  assert.deepEqual(roomSceneTargetPosition(8), roomSceneTargetPosition(0));
  assert.deepEqual(roomSceneTargetPosition(8, targets[0]), { x: 30, y: 70 });
  assert.equal(roomSceneTargetCommand(targets[0], 'drink'), 'drink fountain');
  assert.equal(roomSceneTargetCommand(targets[0], 'say hello'), 'look fountain');
});

test('room scene catalogue falls back to legacy details', () => {
  assert.deepEqual(roomSceneTargets(undefined, ['shop', 'old tree']), [
    { id: 'detail:shop', name: 'shop', nouns: ['shop'] },
    { id: 'detail:old-tree', name: 'old tree', nouns: ['old-tree'] },
  ]);
  assert.equal(roomScenePropSprite({ name: 'old oak tree', nouns: ['oak'] }), 'tree');
  assert.equal(roomScenePropSprite({ name: 'mysterious portal', nouns: ['portal'] }), null);
  assert.deepEqual(roomSceneTargets([], ['shop']), []);
  assert.deepEqual(roomSceneTargets('', ['shop']), []);
});

test('room scene commands preserve parser nouns and reject command chaining', () => {
  const [target] = roomSceneTargets([
    { id: 'etched-door', name: 'an etched door', nouns: ['etched door #2'] },
  ]);
  assert.equal(roomSceneTargetCommand(target, 'look'), 'look etched door #2');
  assert.deepEqual(roomSceneTargets([
    { id: 'bad', name: 'bad', nouns: ['door;quit', 'door\nkill guard'] },
  ]), []);
});

test('scenery IDs and anchors keep distinct authored punctuation', () => {
  const targets = roomSceneTargets([
    { id: 'survey.stake', name: 'Survey stake', nouns: ['survey stake'], position: { x: 20, y: 60 } },
    { id: 'survey-stake', name: 'Red stake', nouns: ['red stake'], position: { x: 75, y: 50 } },
  ]).map((target, index) => ({ ...target, ...roomSceneTargetPosition(index, target) }));
  assert.deepEqual(targets.map((target) => target.id), ['survey.stake', 'survey-stake']);
  assert.equal(roomSceneTargetCommand(targets[0]), 'look survey stake');
  assert.equal(roomSceneTargetMatches(targets[0], 'survey.stake'), true);
  assert.equal(roomSceneTargetMatches(targets[0], 'survey-stake'), false);
  assert.equal(roomSceneTargetMatches(targets[0], '  SURVEY STAKE  '), true);
  assert.equal(roomSceneTargetMatches(targets[1], 'survey-stake'), true);
  assert.deepEqual(roomSceneOccupantPosition(2, { kind: 'npc', anchor_id: 'survey.stake' }, targets),
    { x: 27, y: 63 });
  assert.deepEqual(roomSceneOccupantPosition(2, { kind: 'npc', anchor_id: 'survey-stake' }, targets),
    { x: 68, y: 53 });
  assert.deepEqual(roomSceneOccupantPosition(2, { kind: 'npc', anchor_id: 'survey:stake' }, targets),
    { x: 61, y: 58 }, 'an unannounced anchor must not alias a different target');
});

test('expanded props, equipment, exits, ambience, anchors, and combat are normalized', () => {
  assert.equal(roomScenePropSprite({ name: 'a dropped satchel', nouns: ['loot'] }), 'loot');
  assert.equal(roomScenePropSprite({ name: 'fungus', nouns: ['mushroom'] }), 'mushrooms');
  assert.equal(roomSceneWeaponSprite('a tempered great sword'), 'great-sword');
  assert.equal(roomSceneWeaponSprite('oak bow'), null);
  assert.equal(roomSceneExitKind('up'), 'stairs');
  assert.equal(roomSceneExitKind('east', { kind: 'portal' }), 'portal');
  assert.equal(roomSceneExitKind('west', { kind: 'spaceship' }), 'path');
  assert.equal(roomSceneAtmosphere({ time: 'twilight' }).time, 'dusk');
  assert.equal(roomSceneAtmosphere({ lighting: 'dark' }).lighting, 'dark');
  assert.deepEqual(roomSceneAtmosphere({ time: 'night', weather: 'rain', lighting: 'magic' }), {
    time: 'night',
    weather: 'rain',
    lighting: 'magic',
  });
  assert.deepEqual(roomSceneAtmosphere({ time: 'noon', weather: 'hail', lighting: 'x' }), {
    time: 'day',
    weather: 'clear',
    lighting: 'normal',
  });
  const targets = [{ id: 'forge', x: 70, y: 50 }];
  assert.deepEqual(roomSceneOccupantPosition(2, { kind: 'npc', anchor_id: 'forge' }, targets), {
    x: 63,
    y: 53,
  });
  assert.deepEqual(roomSceneOccupantPosition(1, { kind: 'npc', fighting: true, hostile: true }), {
    x: 60,
    y: 67,
  });
});
