import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUpdateMessage } from '../public/js/desktop-integration.js';

test('desktop update states produce concise banner content', () => {
  assert.deepEqual(formatUpdateMessage({ state: 'checking' }), {
    message: 'Checking for Darkwind updates...',
  });
  assert.deepEqual(formatUpdateMessage({ state: 'downloading', percent: 42 }), {
    message: 'Downloading Darkwind update: 42%',
  });
  assert.deepEqual(formatUpdateMessage({ state: 'downloaded', version: '1.5.0' }), {
    message: 'Darkwind 1.5.0 is ready to install.',
    action: 'Restart and update',
  });
  assert.equal(formatUpdateMessage({ state: 'disabled' }), null);
});
