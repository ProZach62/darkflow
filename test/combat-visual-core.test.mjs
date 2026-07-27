import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCombatView,
  createCombatVisualState,
  prefersReducedCombatMotion,
  reduceCombatEvents,
  reduceCombatState,
  takeNextCombatEvent,
} from '../public/js/combat-visual-core.mjs';

function activeState(overrides = {}) {
  return {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    seq: 10,
    visual_enabled: true,
    effective: false,
    active: true,
    current_target_id: 'enemy-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
    outcome: '',
    summary: 'Combat begins against an ash drake.',
    ...overrides,
  };
}

function event(seq, overrides = {}) {
  return {
    seq,
    kind: 'attack',
    perspective: 'outgoing',
    actor_id: 'self',
    target_id: 'enemy-1',
    result: 'hit',
    damage: 12,
    absorbed: 0,
    summary: 'You hit an ash drake for 12 damage.',
    ...overrides,
  };
}

test('State accepts LPC-style numeric and string protocol booleans', () => {
  let model = createCombatVisualState();
  model = reduceCombatState(model, activeState({
    visual_enabled: 1,
    effective: '1',
    active: 'true',
  }));

  assert.equal(model.visualEnabled, true);
  assert.equal(model.effective, true);
  assert.equal(model.active, true);
});

test('a new connection epoch or encounter clears transient combat history', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState());
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11)],
  }, 1000);
  assert.equal(model.history.length, 1);

  model = reduceCombatState(model, activeState({
    epoch: 'connection-b',
    encounter_id: 'encounter-b',
    seq: 1,
  }), 1100);

  assert.equal(model.epoch, 'connection-b');
  assert.equal(model.encounterId, 'encounter-b');
  assert.deepEqual(model.history, []);
  assert.deepEqual(model.pending, []);
  assert.equal(model.lastSeq, 1);
});

test('Events are ordered, deduplicated, encounter-scoped, and bounded', () => {
  let model = reduceCombatState(createCombatVisualState({
    historyLimit: 3,
    queueLimit: 2,
  }), activeState());

  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(13), event(11), event(12), event(12)],
  }, 1000);

  assert.deepEqual(model.history.map((item) => item.seq), [11, 12, 13]);
  assert.deepEqual(model.pending.map((item) => item.seq), [12, 13]);
  assert.equal(model.overflow.omitted, 1);
  assert.equal(model.lastSeq, 13);

  const unchanged = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'different-encounter',
    events: [event(14)],
  }, 1100);
  assert.equal(unchanged, model);
});

test('stale cosmetic events are dropped instead of replayed late', () => {
  let model = reduceCombatState(createCombatVisualState({ staleMs: 500 }), activeState());
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11), event(12)],
  }, 1000);

  const taken = takeNextCombatEvent(model, 1601);

  assert.equal(taken.event, null);
  assert.deepEqual(taken.state.pending, []);
  assert.equal(taken.state.overflow.omitted, 2);
});

test('Char.Vitals and Char.Enemy remain authoritative for combatant health and art', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
      { id: 'enemy-2', name: 'a cinder whelp', role: 'threat' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11)],
  });
  model = takeNextCombatEvent(model).state;

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: {
      enemy_name: 'an ash drake',
      enemy_curhp: 328,
      enemy_maxhp: 800,
      enemy_hp_string: 'badly wounded',
      enemy_image: '/enemies/ash-drake.png',
    },
  });

  assert.deepEqual(view.player.health, {
    known: true,
    current: 624,
    max: 800,
    percent: 78,
  });
  assert.deepEqual(view.target.health, {
    known: true,
    current: 328,
    max: 800,
    percent: 41,
  });
  assert.equal(view.player.image, '/avatars/acer.png');
  assert.equal(view.target.image, '/enemies/ash-drake.png');
  assert.deepEqual(view.threats.map((threat) => threat.name), ['a cinder whelp']);
});

test('reduced-motion preference safely follows matchMedia', () => {
  assert.equal(prefersReducedCombatMotion(() => ({ matches: true })), true);
  assert.equal(prefersReducedCombatMotion(() => ({ matches: false })), false);
  assert.equal(prefersReducedCombatMotion(() => { throw new Error('unavailable'); }), false);
  assert.equal(prefersReducedCombatMotion(null), false);
});
