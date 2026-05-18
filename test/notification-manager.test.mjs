import test from 'node:test';
import assert from 'node:assert/strict';

const { messageMentionsPlayer, normalizeMentionText } = await import('../public/js/notification-utils.js');

test('matches exact player mentions case-insensitively', () => {
  assert.equal(messageMentionsPlayer('Hello @Acer', 'acer'), true);
  assert.equal(messageMentionsPlayer('Hello @acer', 'Acer'), true);
  assert.equal(messageMentionsPlayer('[Druid] Cawr: @ACER come here', 'acer'), true);
});

test('does not match partial player mentions', () => {
  assert.equal(messageMentionsPlayer('Hello @acerb', 'acer'), false);
  assert.equal(messageMentionsPlayer('Hello @acer_thing', 'acer'), false);
  assert.equal(messageMentionsPlayer('Hello acer', 'acer'), false);
});

test('allows punctuation after a mention', () => {
  assert.equal(messageMentionsPlayer('@acer, can you help?', 'acer'), true);
  assert.equal(messageMentionsPlayer('(@acer)', 'acer'), true);
});

test('normalizes text for mention line binding', () => {
  assert.equal(normalizeMentionText(' [Druid]   Cawr:  hi   @Acer '), '[druid] cawr: hi @acer');
});
