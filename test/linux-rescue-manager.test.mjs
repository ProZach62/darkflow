import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLinuxRescuePrompt,
  runLinuxRescueCommand,
  shouldRequestLinuxRescueFullscreen,
} from '../public/js/linux-rescue-core.mjs';

test('linux rescue exposes a shell-like prompt', () => {
  const state = { cwd: '/home/jason/project', user: 'jason', host: 'workstation', history: [] };
  assert.equal(getLinuxRescuePrompt(state), 'jason@workstation:~/project$');
});

test('linux rescue supports local navigation only', () => {
  const state = { cwd: '/home/jason/project', user: 'jason', host: 'workstation', history: [] };

  assert.deepEqual(runLinuxRescueCommand(state, 'pwd').output, ['/home/jason/project']);
  assert.deepEqual(runLinuxRescueCommand(state, 'cd src').output, []);
  assert.equal(state.cwd, '/home/jason/project/src');
  assert.deepEqual(runLinuxRescueCommand(state, 'cd /root').output, [
    'cd: /root: No such file or directory',
  ]);
  assert.equal(state.cwd, '/home/jason/project/src');
});

test('linux rescue returns deterministic fake command output', () => {
  const state = { cwd: '/home/jason/project', user: 'jason', host: 'workstation', history: [] };

  assert.ok(runLinuxRescueCommand(state, 'help').output[0].includes('Available commands'));
  assert.ok(runLinuxRescueCommand(state, 'ls').output.includes('README.md'));
  assert.ok(runLinuxRescueCommand(state, 'git status').output.includes('nothing to commit, working tree clean'));
  assert.deepEqual(runLinuxRescueCommand(state, 'unknown').output, ['unknown: command not found']);
});

test('linux rescue supports clear and exit controls', () => {
  const state = { cwd: '/home/jason/project', user: 'jason', host: 'workstation', history: [] };

  assert.equal(runLinuxRescueCommand(state, 'clear').clear, true);
  assert.equal(runLinuxRescueCommand(state, 'exit').exit, true);
  assert.equal(runLinuxRescueCommand(state, 'logout').exit, true);
});

test('linux rescue can skip browser fullscreen requests', () => {
  assert.equal(shouldRequestLinuxRescueFullscreen({}), true);
  assert.equal(shouldRequestLinuxRescueFullscreen({ fullscreen: true }), true);
  assert.equal(shouldRequestLinuxRescueFullscreen({ fullscreen: 1 }), true);
  assert.equal(shouldRequestLinuxRescueFullscreen({ fullscreen: false }), false);
  assert.equal(shouldRequestLinuxRescueFullscreen({ fullscreen: 0 }), false);
});
