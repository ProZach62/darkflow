import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TUTORIAL_TARGETS,
  buildTutorialAction,
  createTutorialState,
  normalizeTutorialState,
  reduceTutorialState,
  tutorialAnnouncement,
  tutorialProgress,
} from '../public/js/tutorial-core.mjs';

function statePayload(overrides = {}) {
  return {
    epoch: 'tutorial-epoch-1',
    seq: 4,
    tutorial_version: 2,
    status: 'active',
    awaiting_continue: 1,
    chapter: {
      id: 'orientation',
      index: 1,
      total: 5,
      title: 'Find your bearings',
    },
    step: {
      id: 'look',
      index: 1,
      total: 21,
      title: 'Look around',
      task: 'Read the room description.',
      hint: 'Type look.',
      help: 'help look',
      example_command: 'look',
      target: 'command-input',
    },
    route: null,
    actions: ['continue', 'hint', 'skip'],
    reason: 'progress',
    ...overrides,
  };
}

test('normalizes the v2 tutorial state and semantic target allowlist', () => {
  const normalized = normalizeTutorialState(statePayload({
    actions: ['continue', 'continue', 'made-up', { id: 'hint' }],
    route: {
      place: 'Erga',
      directions: ['north', 'east'],
      text: 'Follow the road.',
    },
  }));

  assert.equal(normalized.tutorialVersion, 2);
  assert.equal(normalized.awaitingContinue, true);
  assert.equal(normalized.step.exampleCommand, 'look');
  assert.equal(normalized.step.target, 'command-input');
  assert.deepEqual(normalized.actions, ['continue', 'hint']);
  assert.deepEqual(normalized.route, {
    place: 'Erga',
    directions: ['north', 'east'],
    text: 'Follow the road.',
  });
  assert.deepEqual(TUTORIAL_TARGETS, [
    'terminal',
    'command-input',
    'panels-menu',
    'inventory-panel',
    'vitals-panel',
    'enemy-panel',
  ]);

  const unsafe = normalizeTutorialState(statePayload({
    step: {
      ...statePayload().step,
      target: '#command-input, body',
    },
  }));
  assert.equal(unsafe.step.target, '', 'arbitrary selectors are never accepted');
});
test('rejects malformed, incompatible, and active states without a step', () => {
  assert.equal(normalizeTutorialState(null), null);
  assert.equal(normalizeTutorialState(statePayload({ epoch: '' })), null);
  assert.equal(normalizeTutorialState(statePayload({ tutorial_version: 3 })), null);
  assert.equal(normalizeTutorialState(statePayload({ status: 'unknown' })), null);
  assert.equal(normalizeTutorialState(statePayload({ step: {} })), null);
});

test('reducer requires increasing sequence numbers within an epoch', () => {
  const initial = createTutorialState();
  const accepted = reduceTutorialState(initial, statePayload(), 100);
  assert.equal(accepted.seq, 4);
  assert.equal(accepted.receivedAt, 100);

  assert.equal(
    reduceTutorialState(accepted, statePayload({ seq: 4, reason: 'duplicate' }), 200),
    accepted,
  );
  assert.equal(
    reduceTutorialState(accepted, statePayload({ seq: 3 }), 200),
    accepted,
  );

  const newer = reduceTutorialState(accepted, statePayload({ seq: 5 }), 300);
  assert.equal(newer.seq, 5);
  const newEpoch = reduceTutorialState(newer, statePayload({
    epoch: 'tutorial-epoch-2',
    seq: 1,
  }), 400);
  assert.equal(newEpoch.epoch, 'tutorial-epoch-2');
  assert.equal(newEpoch.seq, 1);
});

test('builds stale-safe payloads only for server-authorized actions', () => {
  const state = reduceTutorialState(createTutorialState(), statePayload());
  assert.deepEqual(buildTutorialAction(state, 'continue'), {
    action: 'continue',
    epoch: 'tutorial-epoch-1',
    seq: 4,
    step_id: 'look',
  });
  assert.equal(buildTutorialAction(state, 'restart'), null);
  assert.equal(buildTutorialAction(state, 'totally-unsafe'), null);
});

test('progress and live announcement use server state without advancing locally', () => {
  const state = reduceTutorialState(createTutorialState(), statePayload());
  assert.deepEqual(tutorialProgress(state), {
    value: 1,
    total: 21,
    percent: 5,
  });
  assert.match(tutorialAnnouncement(state), /Tutorial step 1 of 21/);
  assert.match(tutorialAnnouncement(state), /Choose Continue/);

  assert.equal(tutorialAnnouncement({
    ...state,
    status: 'finished',
  }), 'Tutorial complete.');
});
