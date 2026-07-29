import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

globalThis.document = {
  activeElement: null,
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
  requestAnimationFrame(callback) { callback(); return 1; },
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

const { gmcp, normalizeSubscriptionPayload } = await import('../public/js/gmcp.js');
const {
  TUTORIAL_ACTION_TIMEOUT_MS,
  TUTORIAL_RENDER_RECOVERY_DELAYS_MS,
  tutorialManager,
} = await import('../public/js/tutorial-manager.js');
const { dom, state: appState } = await import('../public/js/state.js');
const {
  createTutorialState,
  reduceTutorialState,
} = await import('../public/js/tutorial-core.mjs');

function activePayload(overrides = {}) {
  return {
    epoch: 'manager-epoch',
    seq: 7,
    tutorial_version: 2,
    status: 'active',
    awaiting_continue: 1,
    chapter: { id: 'orientation', index: 1, total: 5, title: 'Orientation' },
    step: {
      id: 'look',
      index: 1,
      total: 21,
      title: 'Look',
      task: 'Look around.',
      hint: 'Type look.',
      help: 'help look',
      example_command: 'look',
      target: 'command-input',
    },
    route: null,
    actions: ['continue', 'hint', 'directions', 'skip'],
    reason: 'progress',
    ...overrides,
  };
}

function resetManager() {
  tutorialManager._clearPendingTimer();
  tutorialManager._clearRenderRecovery();
  tutorialManager.model = createTutorialState();
  tutorialManager.initialized = true;
  tutorialManager.renderHealthy = true;
  tutorialManager.advertisedReady = false;
  tutorialManager.presentationAllowed = true;
  tutorialManager.collapsed = false;
  tutorialManager.hintVisible = false;
  tutorialManager.routeVisible = false;
  tutorialManager.skipConfirming = false;
  tutorialManager.pendingAction = '';
  tutorialManager.lastAnnouncedKey = '';
  tutorialManager.els.card = { isConnected: true };
  tutorialManager.els.live = { textContent: '' };
  appState.zorkOnlyMode = false;
}

test('subscription readiness is explicit capability, independent of active state', () => {
  resetManager();
  assert.equal(normalizeSubscriptionPayload().features.tutorialPane, false);
  assert.equal(normalizeSubscriptionPayload({
    features: { tutorialPane: true },
  }).features.tutorialPane, true);
  assert.equal(tutorialManager.isReadyForSubscription(), true);

  tutorialManager.collapsed = true;
  tutorialManager.model = {
    ...tutorialManager.model,
    status: 'finished',
  };
  assert.equal(tutorialManager.isReadyForSubscription(), true);

  appState.zorkOnlyMode = true;
  assert.equal(tutorialManager.isReadyForSubscription(), false);
});

test('state handling auto-renders active state, rejects stale state, and preserves route reveal', () => {
  resetManager();
  const original = {
    renderSafely: tutorialManager._renderSafely,
    announce: tutorialManager._announce,
    hide: tutorialManager.hide,
  };
  let renders = 0;
  let announcements = 0;
  let hides = 0;
  try {
    tutorialManager._renderSafely = () => { renders++; };
    tutorialManager._announce = () => { announcements++; };
    tutorialManager.hide = () => { hides++; };

    assert.equal(tutorialManager.handleState(activePayload()), true);
    assert.equal(renders, 1);
    assert.equal(announcements, 1);

    tutorialManager.routeVisible = true;
    assert.equal(tutorialManager.handleState(activePayload({
      seq: 8,
      route: {
        place: 'Erga',
        directions: ['north'],
        text: 'Keep going.',
      },
      reason: 'route',
    })), true);
    assert.equal(tutorialManager.routeVisible, true);

    assert.equal(tutorialManager.handleState(activePayload({
      seq: 8,
      reason: 'duplicate',
    })), false);
    assert.equal(renders, 2);

    tutorialManager.handleState(activePayload({
      seq: 9,
      step: {
        ...activePayload().step,
        id: 'inspect',
        index: 2,
      },
      route: null,
    }));
    assert.equal(tutorialManager.routeVisible, false);

    tutorialManager.handleState(activePayload({
      seq: 10,
      status: 'finished',
      awaiting_continue: 0,
      actions: ['restart'],
    }));
    assert.equal(hides, 1);
  } finally {
    tutorialManager._renderSafely = original.renderSafely;
    tutorialManager._announce = original.announce;
    tutorialManager.hide = original.hide;
  }
});

test('presentation control hides stale hover and a newer State restores it', () => {
  resetManager();
  const original = {
    renderSafely: tutorialManager._renderSafely,
    hide: tutorialManager.hide,
  };
  let renders = 0;
  let hides = 0;
  try {
    tutorialManager.model = reduceTutorialState(
      createTutorialState(),
      activePayload(),
    );
    tutorialManager._renderSafely = () => { renders++; };
    tutorialManager.hide = () => { hides++; };

    assert.equal(tutorialManager.handleControl(null), false);
    assert.equal(tutorialManager.handleControl({ visible: 'false' }), false);
    assert.equal(tutorialManager.handleControl({
      visible: 0,
      reason: 'screenreader',
    }), true);
    assert.equal(tutorialManager.presentationAllowed, false);
    assert.equal(hides, 1);

    assert.equal(tutorialManager.handleState(activePayload({
      seq: 8,
      reason: 'presentation',
    })), true);
    assert.equal(tutorialManager.presentationAllowed, true);
    assert.equal(renders, 1);
  } finally {
    tutorialManager._renderSafely = original.renderSafely;
    tutorialManager.hide = original.hide;
  }
});

test('render failure advertises fallback and performs bounded recovery', () => {
  resetManager();
  const original = {
    render: tutorialManager.render,
    hide: tutorialManager.hide,
    syncReadiness: tutorialManager._syncReadiness,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    consoleError: console.error,
  };
  const timers = [];
  const readinessReasons = [];
  let shouldThrow = true;
  let hides = 0;
  try {
    tutorialManager.model = reduceTutorialState(
      createTutorialState(),
      activePayload(),
    );
    tutorialManager.render = () => {
      if (shouldThrow) throw new Error('synthetic render failure');
    };
    tutorialManager.hide = () => { hides++; };
    tutorialManager._syncReadiness = (reason) => {
      readinessReasons.push(reason);
    };
    globalThis.setTimeout = (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    };
    globalThis.clearTimeout = () => {};
    console.error = () => {};

    tutorialManager._renderSafely();
    assert.equal(tutorialManager.renderHealthy, false);
    assert.equal(hides, 1);
    assert.deepEqual(readinessReasons, ['tutorial-render-error']);
    assert.equal(timers[0].delay, TUTORIAL_RENDER_RECOVERY_DELAYS_MS[0]);

    shouldThrow = false;
    timers[0].callback();
    assert.equal(tutorialManager.renderHealthy, true);
    assert.equal(tutorialManager._renderRecoveryAttempt, 0);
    assert.deepEqual(readinessReasons, [
      'tutorial-render-error',
      'tutorial-render-recovered',
    ]);
  } finally {
    tutorialManager._clearRenderRecovery();
    tutorialManager.render = original.render;
    tutorialManager.hide = original.hide;
    tutorialManager._syncReadiness = original.syncReadiness;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
    console.error = original.consoleError;
  }
});

test('local interaction render failures use the same fallback and recovery path', () => {
  resetManager();
  const original = {
    render: tutorialManager.render,
    hide: tutorialManager.hide,
    syncReadiness: tutorialManager._syncReadiness,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    consoleError: console.error,
  };
  const timers = [];
  const readinessReasons = [];
  try {
    tutorialManager.model = reduceTutorialState(
      createTutorialState(),
      activePayload(),
    );
    tutorialManager.render = () => {
      throw new Error('synthetic local render failure');
    };
    tutorialManager.hide = () => {};
    tutorialManager._syncReadiness = (reason) => {
      readinessReasons.push(reason);
    };
    globalThis.setTimeout = (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    };
    globalThis.clearTimeout = () => {};
    console.error = () => {};

    assert.equal(tutorialManager.sendAction('skip'), true);
    assert.equal(tutorialManager.renderHealthy, false);
    assert.deepEqual(readinessReasons, ['tutorial-render-error']);
    assert.equal(timers[0].delay, TUTORIAL_RENDER_RECOVERY_DELAYS_MS[0]);
  } finally {
    tutorialManager._clearRenderRecovery();
    tutorialManager.render = original.render;
    tutorialManager.hide = original.hide;
    tutorialManager._syncReadiness = original.syncReadiness;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
    console.error = original.consoleError;
  }
});

test('reconnect schedules remount when a stale card is detached', () => {
  resetManager();
  const original = {
    scheduleRecovery: tutorialManager._scheduleRenderRecovery,
    send: gmcp.send,
  };
  let recoveries = 0;
  let sends = 0;
  try {
    tutorialManager.els.card = { isConnected: false };
    tutorialManager.renderHealthy = true;
    tutorialManager._scheduleRenderRecovery = () => { recoveries++; };
    gmcp.send = () => { sends++; return true; };

    tutorialManager.handleConnected('reconnect');
    assert.equal(tutorialManager.renderHealthy, false);
    assert.equal(tutorialManager.advertisedReady, false);
    assert.equal(recoveries, 1);
    assert.equal(sends, 0, 'detached renderer must not request State before remount');
  } finally {
    tutorialManager._scheduleRenderRecovery = original.scheduleRecovery;
    gmcp.send = original.send;
  }
});

test('actions carry epoch/seq/step, skip requires confirmation, and timeout resyncs', () => {
  resetManager();
  const original = {
    send: gmcp.send,
    render: tutorialManager.render,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const sends = [];
  const timers = [];
  try {
    tutorialManager.model = reduceTutorialState(
      createTutorialState(),
      activePayload(),
    );
    tutorialManager.render = () => {};
    gmcp.send = (name, payload) => {
      sends.push([name, payload]);
      return true;
    };
    globalThis.setTimeout = (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    };
    globalThis.clearTimeout = () => {};

    assert.equal(tutorialManager.sendAction('skip'), true);
    assert.equal(sends.length, 0, 'first Skip click opens confirmation only');
    assert.equal(tutorialManager.skipConfirming, true);

    tutorialManager.skipConfirming = false;
    assert.equal(tutorialManager.sendAction('continue'), true);
    assert.deepEqual(sends[0], [
      'Darkwind.Tutorial.Action',
      {
        action: 'continue',
        epoch: 'manager-epoch',
        seq: 7,
        step_id: 'look',
      },
    ]);
    assert.equal(timers[0].delay, TUTORIAL_ACTION_TIMEOUT_MS);
    assert.equal(tutorialManager.sendAction('hint'), false, 'pending action blocks repeats');

    timers[0].callback();
    assert.equal(tutorialManager.pendingAction, '');
    assert.equal(sends[1][0], 'Darkwind.Tutorial.Resync');
    assert.equal(sends[1][1].reason, 'action-timeout');
  } finally {
    tutorialManager._clearPendingTimer();
    tutorialManager.render = original.render;
    gmcp.send = original.send;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
});

test('example command fills and focuses input without sending it', () => {
  resetManager();
  const originalInput = dom.commandInput;
  const originalSend = gmcp.send;
  let focused = 0;
  let selection = null;
  let sends = 0;
  try {
    dom.commandInput = {
      value: '',
      dispatchEvent() {},
      focus() { focused++; },
      setSelectionRange(start, end) { selection = [start, end]; },
    };
    gmcp.send = () => { sends++; return true; };

    assert.equal(tutorialManager.fillCommandInput('  look  '), true);
    assert.equal(dom.commandInput.value, 'look');
    assert.equal(focused, 1);
    assert.deepEqual(selection, [4, 4]);
    assert.equal(sends, 0);
  } finally {
    dom.commandInput = originalInput;
    gmcp.send = originalSend;
  }
});

test('finished announcement remains in the separate live node when hover hides', () => {
  resetManager();
  const separateLive = tutorialManager.els.live;
  tutorialManager._announce({
    ...tutorialManager.model,
    epoch: 'done',
    seq: 1,
    status: 'finished',
  });
  assert.equal(separateLive.textContent, 'Tutorial complete.');
});
