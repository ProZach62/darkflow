import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEAPON_SPRITES,
  placeShieldSprite,
  placeWeaponSprite,
  weaponSpriteFor,
} from '../public/js/combat-weapon-sprites.mjs';

test('weapon art resolves explicit silhouettes before animation-family defaults', () => {
  assert.equal(weaponSpriteFor('blade', 'great-sword'), WEAPON_SPRITES['great-sword']);
  assert.equal(weaponSpriteFor('axe', 'great-axe'), WEAPON_SPRITES['great-axe']);
  assert.equal(weaponSpriteFor('blunt', 'maul'), WEAPON_SPRITES.maul);
  assert.equal(weaponSpriteFor('polearm'), WEAPON_SPRITES.spear);
  assert.equal(weaponSpriteFor('staff'), null);
});

test('weapon placement keeps the painted grip on the hand and points at the pose vector', () => {
  const sprite = WEAPON_SPRITES.sword;
  const placed = placeWeaponSprite(sprite, { x: 120, y: 80 }, 0, 1, 40);
  assert.equal(placed.x, 120);
  assert.equal(placed.y, 80);
  assert.equal(placed.angle, Math.PI / 2);
  assert.ok(Math.abs(placed.offsetX + sprite.pivot.x * placed.width / sprite.width) < 1e-9);
  assert.ok(Math.abs(placed.offsetY + sprite.pivot.y * placed.height / sprite.height) < 1e-9);
  assert.ok(Math.abs((sprite.width - sprite.pivot.x) * placed.width / sprite.width - 48) < 1e-9,
    'the sword reaches 1.2 body units beyond the hand');
});

test('shield placement centers its forearm pivot and preserves the generated proportions', () => {
  const placed = placeShieldSprite({ x: 40, y: 60 }, 50);
  assert.equal(placed.x, 40);
  assert.equal(placed.y, 60);
  assert.ok(Math.abs(placed.height - 57.5) < 1e-9);
  assert.ok(Math.abs(placed.width / placed.height - 221 / 365) < 1e-9);
  assert.ok(Math.abs(placed.offsetX + placed.width / 2) < 0.2);
  assert.ok(Math.abs(placed.offsetY + placed.height / 2) < 0.2);
});
