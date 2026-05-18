import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findEmojiToken,
  getEmojiSuggestions,
  replaceEmojiAliases,
  replaceEmojiToken,
} from '../public/js/emoji-manager.js';

test('replaces known colon emoji aliases', () => {
  assert.equal(replaceEmojiAliases('say hello :smile:'), 'say hello 😄');
  assert.equal(replaceEmojiAliases('tell acer :thumbsup: :fire:'), 'tell acer 👍 🔥');
  assert.equal(replaceEmojiAliases('say :unknown:'), 'say :unknown:');
});

test('finds the active emoji token at the cursor', () => {
  assert.deepEqual(findEmojiToken('say hello :smi', 14), {
    start: 10,
    end: 14,
    query: 'smi',
  });
  assert.equal(findEmojiToken('say hello', 9), null);
  assert.equal(findEmojiToken('say hello :smile: now', 21), null);
});

test('orders suggestions by exact and prefix matches', () => {
  const suggestions = getEmojiSuggestions('smile', 4);
  assert.equal(suggestions[0].alias, 'smile');
  assert.equal(suggestions[0].emoji, '😄');
  assert.ok(suggestions.some((entry) => entry.alias === 'smiley'));
});

test('replaces the active token with an emoji', () => {
  const token = findEmojiToken('say :fir', 8);
  assert.equal(replaceEmojiToken('say :fir', token, '🔥', true), 'say 🔥 ');
});
