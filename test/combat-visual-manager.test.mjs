import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

globalThis.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  body: {
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
  },
};

globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) { return callback(); },
  dispatchEvent() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

globalThis.CustomEvent = function CustomEvent() {};
globalThis.Image = function Image() {};
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  disconnect() {}
};

const { combatVisualManager } = await import('../public/js/combat-visual-manager.js');
const { panelManager } = await import('../public/js/panel-manager.js');
const { gmcp, normalizeSubscriptionPayload } = await import('../public/js/gmcp.js');
const { createCombatVisualState } = await import('../public/js/combat-visual-core.mjs');

test('every client subscription payload explicitly reports Combat pane readiness', () => {
  assert.equal(normalizeSubscriptionPayload().features.combatPane, false);
  assert.equal(normalizeSubscriptionPayload({
    features: { windows: false },
  }).features.combatPane, false);
  assert.equal(normalizeSubscriptionPayload({
    features: { combatPane: true },
  }).features.combatPane, true);
});

test('manager auto-opens, advertises strict readiness, falls back on close, and resyncs on reopen', () => {
  const original = {
    getPanelPresentationState: panelManager.getPanelPresentationState,
    prepareCombatVisualLayout: panelManager.prepareCombatVisualLayout,
    showEnemyPanelForCombat: panelManager.showEnemyPanelForCombat,
    hideEnemyPanelAfterCombat: panelManager.hideEnemyPanelAfterCombat,
    setPanelTitle: panelManager.setPanelTitle,
    setCombatVisualState: panelManager.setCombatVisualState,
    syncEnemyPanelVisibility: panelManager.syncEnemyPanelVisibility,
    sendSubscriptions: gmcp.sendSubscriptions,
    send: gmcp.send,
  };
  let presentation = { visible: false, ready: false };
  const titles = [];
  const subscriptions = [];
  const sends = [];
  let opens = 0;
  let hides = 0;
  let layoutPrepares = 0;

  try {
    panelManager.getPanelPresentationState = () => presentation;
    panelManager.prepareCombatVisualLayout = () => { layoutPrepares++; };
    panelManager.showEnemyPanelForCombat = () => {
      opens++;
      presentation = { visible: true, ready: true };
    };
    panelManager.hideEnemyPanelAfterCombat = () => {
      hides++;
      presentation = { visible: false, ready: false };
    };
    panelManager.setPanelTitle = (id, title) => titles.push([id, title]);
    panelManager.setCombatVisualState = () => true;
    panelManager.syncEnemyPanelVisibility = () => {};
    gmcp.sendSubscriptions = (payload) => {
      subscriptions.push(payload);
      return true;
    };
    gmcp.send = (name) => {
      sends.push(name);
      return true;
    };

    combatVisualManager._clearTimers();
    combatVisualManager.initialized = true;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    combatVisualManager.autoOpenedEncounter = '';
    combatVisualManager.manuallyClosedEncounter = '';

    combatVisualManager.handleState({
      epoch: 'epoch-1',
      encounter_id: 'encounter-1',
      seq: 1,
      visual_enabled: 1,
      effective: 0,
      active: 1,
      current_target_id: 'target-1',
      actors: [
        { id: 'self', name: 'Acer', role: 'self' },
        { id: 'target-1', name: 'an ash drake', role: 'target' },
      ],
      summary: 'Combat begins.',
      outcome: '',
    });

    assert.equal(opens, 1);
    assert.equal(layoutPrepares, 1);
    assert.deepEqual(titles.at(-1), ['enemy', 'Combat']);
    assert.equal(subscriptions.at(-1).features.combatPane, true);
    assert.equal(sends.at(-1), 'Darkwind.Combat.Resync');
    assert.equal(combatVisualManager.model.effective, false,
      'effective=false must not deadlock initial pane readiness');

    presentation = { visible: false, ready: false };
    combatVisualManager._handlePanelLifecycle({
      id: 'enemy',
      reason: 'close',
      ready: false,
    });
    assert.equal(combatVisualManager.manuallyClosedEncounter, 'encounter-1');
    assert.equal(subscriptions.at(-1).features.combatPane, false);

    combatVisualManager.handleState({
      epoch: 'epoch-1',
      encounter_id: 'encounter-1',
      seq: 2,
      visual_enabled: 1,
      effective: 0,
      active: 1,
      current_target_id: 'target-1',
      actors: [],
      summary: '',
      outcome: '',
    });
    assert.equal(opens, 1, 'manual close suppresses reopen for the current encounter');

    presentation = { visible: true, ready: true };
    combatVisualManager._handlePanelLifecycle({
      id: 'enemy',
      reason: 'open',
      ready: true,
    });
    assert.equal(combatVisualManager.manuallyClosedEncounter, '');
    assert.equal(subscriptions.at(-1).features.combatPane, true);
    assert.equal(sends.at(-1), 'Darkwind.Combat.Resync');

    presentation = { visible: true, ready: false };
    combatVisualManager._handlePanelLifecycle({
      id: 'enemy',
      reason: 'render-error',
      ready: false,
    });
    assert.equal(subscriptions.at(-1).features.combatPane, false,
      'a renderer failure immediately restores text fallback');

    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    combatVisualManager.autoOpenedEncounter = '';
    combatVisualManager.manuallyClosedEncounter = '';
    presentation = { visible: true, ready: true };
    combatVisualManager.handleState({
      epoch: 'epoch-2',
      encounter_id: 'encounter-2',
      seq: 1,
      visual_enabled: 1,
      effective: 0,
      active: 1,
      current_target_id: 'target-2',
      actors: [],
      summary: 'A new fight begins.',
      outcome: '',
    });
    assert.equal(opens, 2,
      'a visible Enemy pane is still taken over and centered for a new visual encounter');
    assert.equal(combatVisualManager.autoOpenedEncounter, 'encounter-2',
      'visual combat owns the pane so it can always remove it at encounter end');

    combatVisualManager.handleState({
      epoch: 'epoch-2',
      encounter_id: 'encounter-2',
      seq: 2,
      visual_enabled: 1,
      effective: 1,
      active: 0,
      current_target_id: '',
      actors: [],
      summary: 'Combat is over.',
      outcome: 'victory',
    });
    assert.equal(hides, 1, 'the Combat pane disappears immediately when combat ends');
    assert.deepEqual(titles.at(-1), ['enemy', 'Enemy']);
    assert.equal(combatVisualManager.autoOpenedEncounter, '');
    assert.equal(subscriptions.at(-1).features.combatPane, false);
  } finally {
    combatVisualManager._clearTimers();
    combatVisualManager.initialized = false;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    panelManager.getPanelPresentationState = original.getPanelPresentationState;
    panelManager.prepareCombatVisualLayout = original.prepareCombatVisualLayout;
    panelManager.showEnemyPanelForCombat = original.showEnemyPanelForCombat;
    panelManager.hideEnemyPanelAfterCombat = original.hideEnemyPanelAfterCombat;
    panelManager.setPanelTitle = original.setPanelTitle;
    panelManager.setCombatVisualState = original.setCombatVisualState;
    panelManager.syncEnemyPanelVisibility = original.syncEnemyPanelVisibility;
    gmcp.sendSubscriptions = original.sendSubscriptions;
    gmcp.send = original.send;
  }
});

test('a new mobile encounter opens the Combat sheet once and respects a same-encounter sheet close', () => {
  const original = {
    getPanelPresentationState: panelManager.getPanelPresentationState,
    prepareCombatVisualLayout: panelManager.prepareCombatVisualLayout,
    showEnemyPanelForCombat: panelManager.showEnemyPanelForCombat,
    setPanelTitle: panelManager.setPanelTitle,
    setCombatVisualState: panelManager.setCombatVisualState,
    sendSubscriptions: gmcp.sendSubscriptions,
    send: gmcp.send,
  };
  let presentation = {
    visible: true,
    ready: false,
    mobileMode: true,
    mobileSheetOpen: false,
    mobilePanelActive: false,
  };
  let opens = 0;
  const subscriptions = [];

  const statePayload = (encounterId, seq) => ({
    epoch: 'mobile-epoch',
    encounter_id: encounterId,
    seq,
    visual_enabled: 1,
    effective: 0,
    active: 1,
    current_target_id: 'target-1',
    actors: [
      { id: 'self', name: 'Acer', role: 'self' },
      { id: 'target-1', name: 'an ash drake', role: 'target' },
    ],
    summary: 'Combat continues.',
    outcome: '',
  });

  try {
    panelManager.getPanelPresentationState = () => presentation;
    panelManager.prepareCombatVisualLayout = () => {};
    panelManager.showEnemyPanelForCombat = () => {
      opens++;
      presentation = {
        visible: true,
        ready: true,
        mobileMode: true,
        mobileSheetOpen: true,
        mobilePanelActive: true,
      };
    };
    panelManager.setPanelTitle = () => {};
    panelManager.setCombatVisualState = () => true;
    gmcp.sendSubscriptions = (payload) => {
      subscriptions.push(payload);
      return true;
    };
    gmcp.send = () => true;

    combatVisualManager._clearTimers();
    combatVisualManager.initialized = true;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    combatVisualManager.autoOpenedEncounter = '';
    combatVisualManager.manuallyClosedEncounter = '';

    combatVisualManager.handleState(statePayload('mobile-1', 1));

    assert.equal(opens, 1,
      'a persisted visible desktop pane still activates the mobile Combat sheet');
    assert.equal(combatVisualManager.autoOpenedEncounter, 'mobile-1');

    presentation = {
      visible: true,
      ready: false,
      mobileMode: true,
      mobileSheetOpen: false,
      mobilePanelActive: true,
    };
    combatVisualManager._handlePanelLifecycle({
      id: 'enemy',
      reason: 'mobile-sheet-close',
      ...presentation,
    });

    assert.equal(combatVisualManager.manuallyClosedEncounter, 'mobile-1');
    assert.equal(subscriptions.at(-1).features.combatPane, false,
      'closing the mobile sheet immediately restores combat text');

    combatVisualManager.handleState(statePayload('mobile-1', 2));
    assert.equal(opens, 1,
      'later State frames do not reopen a sheet manually closed for this encounter');

    combatVisualManager.handleState(statePayload('mobile-2', 1));
    assert.equal(opens, 2,
      'the next encounter clears the close suppression and opens the sheet');
  } finally {
    combatVisualManager._clearTimers();
    combatVisualManager.initialized = false;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    combatVisualManager.autoOpenedEncounter = '';
    combatVisualManager.manuallyClosedEncounter = '';
    panelManager.getPanelPresentationState = original.getPanelPresentationState;
    panelManager.prepareCombatVisualLayout = original.prepareCombatVisualLayout;
    panelManager.showEnemyPanelForCombat = original.showEnemyPanelForCombat;
    panelManager.setPanelTitle = original.setPanelTitle;
    panelManager.setCombatVisualState = original.setCombatVisualState;
    gmcp.sendSubscriptions = original.sendSubscriptions;
    gmcp.send = original.send;
  }
});

test('an inbound GMCP State dispatch opens the centered Combat presentation', () => {
  const packages = [
    'Darkwind.Combat.State',
    'Darkwind.Combat.Events',
    'Darkwind.Combat.Event',
  ];
  const handlerSnapshots = Object.fromEntries(packages.map((name) => [
    name,
    gmcp.handlers[name] ? [...gmcp.handlers[name]] : null,
  ]));
  const original = {
    registerPanelLifecycleHandler: panelManager.registerPanelLifecycleHandler,
    getPanelPresentationState: panelManager.getPanelPresentationState,
    prepareCombatVisualLayout: panelManager.prepareCombatVisualLayout,
    showEnemyPanelForCombat: panelManager.showEnemyPanelForCombat,
    hideEnemyPanelAfterCombat: panelManager.hideEnemyPanelAfterCombat,
    setPanelTitle: panelManager.setPanelTitle,
    setCombatVisualState: panelManager.setCombatVisualState,
    syncEnemyPanelVisibility: panelManager.syncEnemyPanelVisibility,
    sendSubscriptions: gmcp.sendSubscriptions,
    send: gmcp.send,
  };
  let presentation = { visible: false, ready: false };
  let opens = 0;
  let layoutPrepares = 0;

  try {
    panelManager.registerPanelLifecycleHandler = () => {};
    panelManager.getPanelPresentationState = () => presentation;
    panelManager.prepareCombatVisualLayout = () => { layoutPrepares++; };
    panelManager.showEnemyPanelForCombat = () => {
      opens++;
      presentation = { visible: true, ready: true };
    };
    panelManager.hideEnemyPanelAfterCombat = () => {};
    panelManager.setPanelTitle = () => {};
    panelManager.setCombatVisualState = () => true;
    panelManager.syncEnemyPanelVisibility = () => {};
    gmcp.sendSubscriptions = () => true;
    gmcp.send = () => true;

    combatVisualManager.initialized = false;
    combatVisualManager.init();
    gmcp.dispatch('Darkwind.Combat.State', {
      epoch: 'dispatch-epoch',
      encounter_id: 'dispatch-encounter',
      seq: 0,
      visual_enabled: 1,
      effective: 0,
      active: 1,
      current_target_id: 'target-1',
      actors: [
        { id: 'self', name: 'Dagnon', role: 'self' },
        { id: 'target-1', name: 'a training target', role: 'target' },
      ],
      summary: 'Combat begins.',
      outcome: '',
    });

    assert.equal(opens, 1);
    assert.equal(layoutPrepares, 1);
    assert.equal(combatVisualManager.autoOpenedEncounter, 'dispatch-encounter');
    assert.equal(combatVisualManager.renderHealthy, true);
  } finally {
    combatVisualManager._clearTimers();
    combatVisualManager.initialized = false;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    combatVisualManager.autoOpenedEncounter = '';
    combatVisualManager.manuallyClosedEncounter = '';
    combatVisualManager._motionQuery = null;
    combatVisualManager._panelLifecycleHandler = null;
    for (const name of packages) {
      if (handlerSnapshots[name]) gmcp.handlers[name] = handlerSnapshots[name];
      else delete gmcp.handlers[name];
    }
    panelManager.registerPanelLifecycleHandler = original.registerPanelLifecycleHandler;
    panelManager.getPanelPresentationState = original.getPanelPresentationState;
    panelManager.prepareCombatVisualLayout = original.prepareCombatVisualLayout;
    panelManager.showEnemyPanelForCombat = original.showEnemyPanelForCombat;
    panelManager.hideEnemyPanelAfterCombat = original.hideEnemyPanelAfterCombat;
    panelManager.setPanelTitle = original.setPanelTitle;
    panelManager.setCombatVisualState = original.setCombatVisualState;
    panelManager.syncEnemyPanelVisibility = original.syncEnemyPanelVisibility;
    gmcp.sendSubscriptions = original.sendSubscriptions;
    gmcp.send = original.send;
  }
});

test('the animation queue presents an incoming beat immediately after an outgoing beat', () => {
  const original = {
    getPanelPresentationState: panelManager.getPanelPresentationState,
    setCombatVisualState: panelManager.setCombatVisualState,
    sendSubscriptions: gmcp.sendSubscriptions,
    send: gmcp.send,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timers = [];
  const timerDelays = [];
  const renderedPerspectives = [];

  try {
    globalThis.setTimeout = (callback, delay) => {
      timers.push(callback);
      timerDelays.push(delay);
      return timers.length;
    };
    globalThis.clearTimeout = () => {};
    panelManager.getPanelPresentationState = () => ({ visible: true, ready: true });
    panelManager.setCombatVisualState = (model) => {
      renderedPerspectives.push(model.currentEvent ? model.currentEvent.perspective : '');
      return true;
    };
    gmcp.sendSubscriptions = () => true;
    gmcp.send = () => true;

    combatVisualManager._clearTimers();
    combatVisualManager.initialized = true;
    combatVisualManager.renderHealthy = true;
    combatVisualManager.advertisedReady = true;
    combatVisualManager.model = {
      ...createCombatVisualState(),
      epoch: 'queue-epoch',
      encounterId: 'queue-encounter',
      visualEnabled: true,
      effective: true,
      active: true,
      currentTargetId: 'target-1',
      actors: [
        { id: 'self', name: 'Dagnon', role: 'self' },
        { id: 'target-1', name: 'an ash drake', role: 'target' },
      ],
    };

    combatVisualManager.handleEvents({
      epoch: 'queue-epoch',
      encounter_id: 'queue-encounter',
      events: [
        {
          seq: 1,
          kind: 'attack',
          perspective: 'outgoing',
          actor_id: 'self',
          target_id: 'target-1',
          result: 'hit',
          damage: 9,
          summary: 'You hit an ash drake.',
        },
        {
          seq: 2,
          kind: 'attack',
          perspective: 'incoming',
          actor_id: 'target-1',
          target_id: 'self',
          result: 'hit',
          damage: 7,
          summary: 'An ash drake hits you.',
        },
      ],
    });

    assert.equal(combatVisualManager.model.currentEvent.perspective, 'outgoing');
    assert.equal(combatVisualManager.model.pending.length, 1);
    assert.equal(timers.length, 1);
    assert.equal(timerDelays[0], 440);

    timers.shift()();

    assert.equal(combatVisualManager.model.currentEvent.perspective, 'incoming');
    assert.equal(combatVisualManager.model.pending.length, 0);
    assert.deepEqual(
      renderedPerspectives.filter(Boolean),
      ['outgoing', 'incoming'],
    );
  } finally {
    combatVisualManager._clearTimers();
    combatVisualManager.initialized = false;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    panelManager.getPanelPresentationState = original.getPanelPresentationState;
    panelManager.setCombatVisualState = original.setCombatVisualState;
    gmcp.sendSubscriptions = original.sendSubscriptions;
    gmcp.send = original.send;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
});

test('reduced motion keeps each static combat beat readable for 440ms', () => {
  const original = {
    getPanelPresentationState: panelManager.getPanelPresentationState,
    setCombatVisualState: panelManager.setCombatVisualState,
    sendSubscriptions: gmcp.sendSubscriptions,
    send: gmcp.send,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const delays = [];

  try {
    globalThis.setTimeout = (_callback, delay) => {
      delays.push(delay);
      return delays.length;
    };
    globalThis.clearTimeout = () => {};
    panelManager.getPanelPresentationState = () => ({ visible: true, ready: true });
    panelManager.setCombatVisualState = () => true;
    gmcp.sendSubscriptions = () => true;
    gmcp.send = () => true;

    combatVisualManager._clearTimers();
    combatVisualManager.initialized = true;
    combatVisualManager.renderHealthy = true;
    combatVisualManager.advertisedReady = true;
    combatVisualManager.model = {
      ...createCombatVisualState(),
      epoch: 'reduced-epoch',
      encounterId: 'reduced-encounter',
      visualEnabled: true,
      effective: true,
      active: true,
      reducedMotion: true,
      currentTargetId: 'target-1',
    };

    combatVisualManager.handleEvents({
      epoch: 'reduced-epoch',
      encounter_id: 'reduced-encounter',
      events: [{
        seq: 1,
        kind: 'attack',
        perspective: 'incoming',
        actor_id: 'target-1',
        target_id: 'self',
        result: 'hit',
        damage: 8,
      }],
    });

    assert.equal(delays[0], 440);
    assert.equal(combatVisualManager.model.currentEvent.damage, 8);
  } finally {
    combatVisualManager._clearTimers();
    combatVisualManager.initialized = false;
    combatVisualManager.model = createCombatVisualState();
    combatVisualManager.renderHealthy = false;
    combatVisualManager.advertisedReady = false;
    panelManager.getPanelPresentationState = original.getPanelPresentationState;
    panelManager.setCombatVisualState = original.setCombatVisualState;
    gmcp.sendSubscriptions = original.sendSubscriptions;
    gmcp.send = original.send;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
});
