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
import { resolveFigure } from '../public/js/combat-rig-core.mjs';
import { spriteKeysFor } from '../public/js/combat-sprites.mjs';

function activeState(overrides = {}) {
  return {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    seq: 10,
    visual_enabled: true,
    effective: false,
    active: true,
    current_actor_id: 'self',
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
  assert.equal(model.currentActorId, 'self');
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
      enemy_hp_string: 'None',
      enemy_is_npc: 1,
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
  assert.equal(view.target.isNpc, true);
  assert.deepEqual(view.threats.map((threat) => threat.name), ['a cinder whelp']);
});

test('explicit observed-combat identity puts the actual attacker on the left', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'fighter-1',
    current_target_id: 'enemy-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'fighter-1', name: 'Dagnon', role: 'combatant' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11, {
      perspective: 'observed',
      actor_id: 'fighter-1',
      target_id: 'enemy-1',
      summary: 'Dagnon hits an ash drake for 12 damage.',
    })],
  });
  model = takeNextCombatEvent(model).state;

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    // Stale private snapshots must not leak into a passive observer view.
    enemy: {
      enemy_name: 'a stale target',
      enemy_curhp: 328,
      enemy_maxhp: 800,
      enemy_hp_string: 'badly wounded',
      enemy_image: '/enemies/stale.png',
    },
  });

  assert.equal(view.player.id, 'fighter-1');
  assert.equal(view.player.name, 'Dagnon');
  assert.equal(view.player.image, '');
  assert.deepEqual(view.player.health, {
    known: false,
    current: 0,
    max: 0,
    percent: 0,
    status: 'unavailable',
  });
  assert.equal(view.target.id, 'enemy-1');
  assert.equal(view.target.name, 'an ash drake');
  assert.equal(view.target.image, '');
  assert.equal(view.target.condition, '');
  assert.equal(view.target.health.status, 'unavailable');
  assert.deepEqual(view.threats, []);
});

test('explicit observed orientation stays stable when the target counterattacks', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'fighter-1',
    current_target_id: 'enemy-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'fighter-1', name: 'Dagnon', role: 'combatant' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11, {
      perspective: 'observed',
      actor_id: 'enemy-1',
      target_id: 'fighter-1',
      summary: 'An ash drake hits Dagnon for 12 damage.',
    })],
  });
  model = takeNextCombatEvent(model).state;

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: { enemy_name: 'None' },
  });

  assert.equal(view.player.id, 'fighter-1');
  assert.equal(view.player.name, 'Dagnon');
  assert.equal(view.target.id, 'enemy-1');
  assert.equal(view.target.name, 'an ash drake');
  assert.equal(view.event.actorId, 'enemy-1');
  assert.equal(view.event.targetId, 'fighter-1');
});

test('group combat can rotate the observed fighter without resetting the encounter', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'fighter-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'fighter-1', name: 'Dagnon', role: 'combatant' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11, {
      perspective: 'observed',
      actor_id: 'fighter-1',
      target_id: 'enemy-1',
    })],
  });

  model = reduceCombatState(model, activeState({
    seq: 11,
    current_actor_id: 'fighter-2',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'fighter-1', name: 'Dagnon', role: 'threat' },
      { id: 'fighter-2', name: 'Nyx', role: 'combatant' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: { enemy_name: 'None' },
  });

  assert.equal(model.encounterId, 'encounter-a');
  assert.equal(model.history.length, 1);
  assert.equal(view.player.id, 'fighter-2');
  assert.equal(view.player.name, 'Nyx');
  assert.equal(view.target.id, 'enemy-1');
  assert.deepEqual(view.threats.map((threat) => threat.name), ['Dagnon']);
});

test('an overflowed observed fighter never falls back to the viewer', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'threat-other',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
      {
        id: 'threat-other',
        name: 'Other combatants',
        role: 'threat',
      },
    ],
  }));

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: { enemy_name: 'None' },
  });

  assert.equal(view.player.id, 'threat-other');
  assert.equal(view.player.name, 'Other combatants');
  assert.equal(view.player.image, '');
  assert.equal(view.player.health.status, 'unavailable');
  assert.equal(view.target.id, 'enemy-1');
  assert.equal(view.target.name, 'an ash drake');
  assert.deepEqual(view.threats, []);
});

test('own combat remains self-left while unrelated observed events arrive', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'self',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
      { id: 'fighter-1', name: 'Dagnon', role: 'threat' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11, {
      perspective: 'observed',
      actor_id: 'fighter-1',
      target_id: 'enemy-1',
      summary: 'Dagnon hits an ash drake for 12 damage.',
    })],
  });
  model = takeNextCombatEvent(model).state;

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: {
      enemy_name: 'an ash drake',
      enemy_curhp: 328,
      enemy_maxhp: 800,
      enemy_image: '/enemies/ash-drake.png',
    },
  });

  assert.equal(view.player.id, 'self');
  assert.equal(view.player.name, 'Acer');
  assert.equal(view.player.image, '/avatars/acer.png');
  assert.equal(view.player.health.known, true);
  assert.equal(view.player.health.current, 624);
  assert.equal(view.target.id, 'enemy-1');
  assert.equal(view.target.name, 'an ash drake');
});

test('older State infers the observed attacker from the latest event', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: undefined,
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
      { id: 'fighter-1', name: 'Dagnon', role: 'threat' },
    ],
  }));
  model = reduceCombatEvents(model, {
    epoch: 'connection-a',
    encounter_id: 'encounter-a',
    events: [event(11, {
      perspective: 'observed',
      actor_id: 'fighter-1',
      target_id: 'enemy-1',
      summary: 'Dagnon hits an ash drake for 12 damage.',
    })],
  });
  model = takeNextCombatEvent(model).state;

  const view = buildCombatView(model, {
    vitals: { hp: 624, maxhp: 800 },
    avatar: { name: 'Acer', url: '/avatars/acer.png' },
    enemy: {
      enemy_name: 'a stale private target',
      enemy_curhp: 99,
      enemy_maxhp: 100,
      enemy_image: '/enemies/stale.png',
    },
  });

  assert.equal(view.player.id, 'fighter-1');
  assert.equal(view.player.name, 'Dagnon');
  assert.equal(view.player.image, '');
  assert.equal(view.player.health.status, 'unavailable');
  assert.equal(view.target.id, 'enemy-1');
  assert.equal(view.target.name, 'an ash drake');
  assert.equal(view.target.image, '');
  assert.equal(view.target.health.status, 'unavailable');
  assert.deepEqual(view.threats, []);
});

test('reduced-motion preference safely follows matchMedia', () => {
  assert.equal(prefersReducedCombatMotion(() => ({ matches: true })), true);
  assert.equal(prefersReducedCombatMotion(() => ({ matches: false })), false);
  assert.equal(prefersReducedCombatMotion(() => { throw new Error('unavailable'); }), false);
  assert.equal(prefersReducedCombatMotion(null), false);
});

test('player token carries Char.Status descriptors and a bundled portrait fallback', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState());
  const view = buildCombatView(model, {
    vitals: { hp: 50, maxhp: 100 },
    avatar: { url: '', name: 'Acer' },
    status: { race: 'High Elf', class: 'Mage', gender: 'Female' },
  });
  assert.equal(view.player.race, 'High Elf');
  assert.equal(view.player.guild, 'Mage');
  assert.equal(view.player.gender, 'Female');
  assert.equal(view.player.descriptor, 'Female High Elf \u00b7 Mage');
  assert.equal(view.player.fallbackImage, '/assets/avatars/female-high-elf.png');
  assert.equal(view.player.image, '', 'no avatar URL means the bundled portrait is only a fallback');

  const partial = buildCombatView(model, { status: { race: 'Dragon' } });
  assert.equal(partial.player.descriptor, 'Dragon');
  assert.equal(partial.player.fallbackImage, '', 'a race without a gender has no bundled file');

  const unknown = buildCombatView(model, { status: { race: 'Thing\u0007', gender: 'male', guild: 'Fighter' } });
  assert.equal(unknown.player.descriptor, 'male Thing \u00b7 Fighter', 'control characters are stripped');
  assert.equal(unknown.player.fallbackImage, '');

  const none = buildCombatView(model, {});
  assert.equal(none.player.descriptor, '');
  assert.equal(none.player.fallbackImage, '');
});

test('observed combat never borrows the recipient status for the staged fighter', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'ally-1',
    current_target_id: 'enemy-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'ally-1', name: 'Bryn', role: 'ally' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));
  const view = buildCombatView(model, {
    status: { race: 'High Elf', class: 'Mage', gender: 'Female' },
  });
  assert.equal(view.player.name, 'Bryn');
  assert.equal(view.player.descriptor, '');
  assert.equal(view.player.fallbackImage, '');
});

test('inventory shapes the player equipment and observers never inherit it', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState());
  const items = [
    { id: 's', name: 'a steel sword (main weapon)', attrib: 'l' },
    { id: 'b', name: 'a buckler (used as shield)', attrib: 'w' },
  ];
  const view = buildCombatView(model, { inventory: items });
  assert.equal(view.player.equipment.mainHand.kind, 'blade');
  assert.equal(view.player.equipment.shield, true);
  assert.equal(view.target.equipment, undefined);

  const none = buildCombatView(model, {});
  assert.equal(none.player.equipment, null, 'no inventory received yet');

  const observed = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'ally-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'ally-1', name: 'Bryn', role: 'ally' },
      { id: 'enemy-1', name: 'an ash drake', role: 'target' },
    ],
  }));
  assert.equal(buildCombatView(observed, { inventory: items }).player.equipment, null);
});

test('public actor snapshots replace private guesses and reach both figure paths', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({
    actors: [
      {
        id: 'self', name: 'Roster Acer', role: 'self',
        appearance: { race: 'Pixie', size: 'huge', form: 'humanoid' },
        equipment: { main_hand: 'coarse edge', off_hand: 'narrow point', weapon_type: 'cleaving', off_hand_type: 'piercing', weapon_style: 'slash', off_hand_style: 'thrust' },
      },
      { id: 'enemy-1', name: 'Roster Serpent', role: 'target', appearance: { form: 'serpent', size: 'small' }, equipment: {} },
    ],
  }));
  const view = buildCombatView(model, {
    avatar: { name: 'Stale Acer', url: 'private.png' },
    status: { race: 'Dragon', class: 'Mage', gender: 'Female' },
    enemy: { enemy_name: 'stale enemy', enemy_image: 'private.png', enemy_type: 'npc' },
    inventory: [{ name: 'a staff (main weapon)', attrib: 'l' }],
  });
  assert.equal(view.player.name, 'Roster Acer');
  assert.equal(view.target.name, 'Roster Serpent');
  assert.equal(view.player.image, '');
  assert.equal(view.player.race, 'Pixie');
  assert.equal(view.player.guild, '', 'public appearance does not borrow private guild text');
  assert.equal(view.target.image, '');
  const playerFigure = resolveFigure(view.player, 'player');
  assert.equal(playerFigure.weapon, 'axe');
  assert.equal(playerFigure.offKind, 'rapier');
  assert.equal(playerFigure.scale, 1.3, 'authoritative size outranks race scale');
  const targetFigure = resolveFigure(view.target, 'target');
  assert.equal(targetFigure.kind, 'beast');
  assert.equal(targetFigure.scale, 0.86);
  assert.equal(targetFigure.weapon, 'claws', 'explicit empty equipment does not reconstruct a weapon');
});

test('snapshot replacement clears rich hints while omission uses only current legacy fallbacks', () => {
  let model = reduceCombatState(createCombatVisualState(), activeState({
    actors: [{ id: 'self', name: 'Acer', role: 'self', appearance: { race: 'Scro' }, equipment: { main_hand: 'edge', weapon_type: 'slashing' } }],
  }));
  assert.equal(buildCombatView(model, { status: { race: 'Dragon' } }).player.race, 'Scro');
  model = reduceCombatState(model, activeState({ seq: 11, actors: [{ id: 'self', name: 'Acer', role: 'self', appearance: {}, equipment: {} }] }));
  let view = buildCombatView(model, { status: { race: 'Dragon', class: 'Mage' }, inventory: [{ name: 'a staff (main weapon)', attrib: 'l' }] });
  assert.equal(view.player.race, '');
  assert.equal(view.player.descriptor, '');
  assert.equal(resolveFigure(view.player, 'player').weapon, 'claws');
  model = reduceCombatState(model, activeState({ seq: 12, actors: [{ id: 'self', name: 'Acer', role: 'self' }] }));
  view = buildCombatView(model, { status: { race: 'Dragon', class: 'Mage' }, inventory: [{ name: 'a staff (main weapon)', attrib: 'l' }] });
  assert.equal(view.player.race, 'Dragon');
  assert.equal(resolveFigure(view.player, 'player').weapon, 'staff');
});

test('authoritative clearing blocks name-based art without erasing NPC classification', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({ actors: [
    { id: 'self', name: 'Elyndar', role: 'self', appearance: {}, equipment: {} },
    { id: 'enemy-1', name: 'an ash drake', role: 'target', appearance: {}, equipment: {} },
  ] }));
  const view = buildCombatView(model, { enemy: { enemy_name: 'an ash drake', enemy_is_npc: 1 } });
  assert.equal(view.target.isNpc, true);
  const target = resolveFigure(view.target, 'target');
  assert.equal(target.kind, 'humanoid');
  assert.deepEqual(spriteKeysFor(view.target, target, 'target'), ['humanoid']);
  assert.deepEqual(spriteKeysFor(view.player, resolveFigure(view.player), 'player'), ['humanoid']);
});

test('passive combat uses each roster actor snapshot without recipient-private hints', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'ally-1',
    actors: [
      { id: 'self', name: 'Recipient', role: 'self' },
      { id: 'ally-1', name: 'Ally', role: 'ally', appearance: { form: 'humanoid', size: 'tiny' }, equipment: { main_hand: 'focus', weapon_type: 'focus' } },
      { id: 'enemy-1', name: 'Enemy', role: 'target', appearance: { form: 'quadruped', size: 'large' }, equipment: {} },
    ],
  }));
  const view = buildCombatView(model, {
    status: { race: 'Dragon', class: 'Ranger' }, avatar: { url: 'private.png' },
    inventory: [{ name: 'a bow (main weapon)', attrib: 'l' }],
    enemy: { enemy_name: 'private enemy', enemy_image: 'private-enemy.png', enemy_curhp: 1, enemy_maxhp: 2 },
  });
  assert.equal(view.player.image, '');
  assert.equal(view.player.guild, '');
  assert.equal(view.player.health.known, false);
  assert.equal(resolveFigure(view.player, 'player').weapon, 'staff');
  assert.equal(resolveFigure(view.target, 'target').kind, 'beast');
  assert.equal(view.target.health.known, false);
});

test('public condition and tactical state survive normalization without private actor fields', () => {
  const model = reduceCombatState(createCombatVisualState(), activeState({
    current_actor_id: 'watch-1', current_target_id: 'watch-2',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'watch-1', name: 'a guard', role: 'participant', occupant_id: 'room-9',
        public_state: { condition: 'slightly wounded', effects: ['bleeding'], hp: 19, buffs: ['secret'] } },
      { id: 'watch-2', name: 'a guard', role: 'target', occupant_id: 'room-10',
        public_state: { condition: 'badly wounded', elite: 1, boss: 0 } },
    ],
    position: 'ranged', preferred_position: 'melee',
    movement: { action: 'fallback', target: 'a guard', progress: 2, required: 5, secret: 'ignored' },
  }));
  const view = buildCombatView(model, { vitals: { hp: 999, maxhp: 1000 } });
  assert.equal(view.player.occupantId, 'room-9');
  assert.equal(view.target.occupantId, 'room-10');
  assert.equal(view.target.condition, 'badly wounded');
  assert.equal(view.target.publicState.elite, true);
  assert.equal(view.player.health.known, false);
  assert.deepEqual(view.player.publicState, { condition: 'slightly wounded', effects: ['bleeding'] });
  assert.equal(view.position, 'ranged');
  assert.equal(view.preferredPosition, 'melee');
  assert.deepEqual(view.movement, { action: 'fallback', target: 'a guard', progress: 2, required: 5 });
});
