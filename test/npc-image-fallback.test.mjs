import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NPC_FALLBACK_IMAGE,
  PLAYER_FALLBACK_IMAGE,
  applyNpcImageFallback,
  isNpcEnemy,
  npcImageSource,
} from '../public/js/image-fallbacks.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('NPC fallback resolves to the bundled generic monster asset', async () => {
  assert.equal(NPC_FALLBACK_IMAGE, '/assets/generic-monster.png');
  assert.equal(PLAYER_FALLBACK_IMAGE, '/assets/avatar-ghost.svg');
  assert.equal(npcImageSource(''), NPC_FALLBACK_IMAGE);
  assert.equal(npcImageSource('/generated/dragon.png'), '/generated/dragon.png');
  await access(resolve(root, 'public/assets/generic-monster.png'));
});

test('Darkwind enemy health descriptions identify NPC targets', () => {
  assert.equal(isNpcEnemy({ enemy_hp_string: 'is badly wounded' }), true);
  assert.equal(isNpcEnemy({ enemy_hp_string: 'None' }), false);
  assert.equal(isNpcEnemy({ enemy_is_npc: 1, enemy_hp_string: 'None' }), true);
  assert.equal(isNpcEnemy({ enemy_is_npc: '1', enemy_hp_string: 'None' }), true);
  assert.equal(isNpcEnemy({ enemy_is_npc: 0, enemy_hp_string: 'is healthy' }), false);
});

test('failed generated NPC art falls back only once', () => {
  const img = {
    src: '/generated/missing.png',
    getAttribute(name) {
      return name === 'src' ? this.src : null;
    },
  };

  assert.equal(applyNpcImageFallback(img), true);
  assert.equal(img.src, NPC_FALLBACK_IMAGE);
  assert.equal(applyNpcImageFallback(img), false);
});
