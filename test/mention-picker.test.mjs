import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectChannelCommand,
  findMentionToken,
  getMentionContext,
  getMentionSuggestions,
} from '../public/js/mention-utils.js';

test('finds the active mention token at the cursor', () => {
  assert.deepEqual(findMentionToken('gossip hello @ac', 16), {
    start: 13,
    end: 16,
    query: 'ac',
  });
  assert.deepEqual(findMentionToken('gossip hello @', 14), {
    start: 13,
    end: 14,
    query: '',
  });
  assert.equal(findMentionToken('gossip hello@ac', 16), null);
});

test('detects channel commands from known channel names', () => {
  const channels = new Set(['gossip', 'druid', 'say']);

  assert.equal(detectChannelCommand('gossip hello @ac', 13, channels), 'gossip');
  assert.equal(detectChannelCommand('egossip waves @ac', 14, channels), 'gossip');
  assert.equal(detectChannelCommand('say hello @ac', 10, channels), '');
});

test('only returns mention context inside a known channel command', () => {
  const channels = new Set(['gossip']);

  assert.deepEqual(getMentionContext('gossip hello @ac', 16, channels), {
    token: { start: 13, end: 16, query: 'ac' },
    channel: 'gossip',
  });
  assert.equal(getMentionContext('tell acer @ac', 13, channels), null);
});

test('filters suggestions by shared channel and partial name', () => {
  const roster = [
    { name: 'acer', displayName: 'Acer', channels: ['gossip', 'druid'] },
    { name: 'siona', displayName: 'Siona', channels: ['druid'] },
    { name: 'acolyte', displayName: 'Acolyte', channels: ['gossip'] },
    { name: 'speaker', displayName: 'Speaker', channels: ['say'] },
  ];
  const suggestions = getMentionSuggestions(roster, 'gossip', 'ac');

  assert.deepEqual(suggestions.map(entry => entry.name), ['acer', 'acolyte']);
  assert.equal(getMentionSuggestions(roster, 'gossip', 'si').length, 0);
  assert.equal(getMentionSuggestions(roster, 'say', 'sp').length, 0);
});
