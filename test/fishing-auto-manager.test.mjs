// Integration tests for the Auto-Angler's hook into fishing-manager.js.
//
// fishing-auto-sim.test.mjs proves the controller can play. This file proves
// the wiring is correct - and, above all, that with the Auto-Angler disabled
// the manager behaves exactly as it did before the addon existed (PRD metric
// M8). That property is what justifies shipping this as a client change at all.
//
// The DOM stubs below follow the pattern in combat-visual-manager.test.mjs.

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
  createElement() {
    return { className: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, addEventListener() {}, querySelector() { return null; } };
  },
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
};

// Controllable animation clock: the manager drives its fight loop from
// requestAnimationFrame, so the tests need to step it deliberately rather than
// let it free-run.
const frames = [];
globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(cb) { frames.push(cb); return frames.length; },
  cancelAnimationFrame() {},
  setInterval() { return 0; },
  clearInterval() {},
  dispatchEvent() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;

let clock = 0;
globalThis.performance = { now: () => clock };

globalThis.CustomEvent = function CustomEvent() {};
globalThis.Image = function Image() {};
globalThis.ResizeObserver = class ResizeObserver { observe() {} disconnect() {} };

const { fishingManager } = await import('../public/js/fishing-manager.js');
const { fishingAuto } = await import('../public/js/fishing-auto.js');
const { createFightSim, castPowerAt } = await import('../public/js/fishing-core.mjs');
const { TUNING } = await import('../public/js/fishing-auto-core.mjs');

// Rendering and sound are not what these tests are about, and they need a
// fully built panel to work against.
fishingManager._paintFight = () => {};
fishingManager._render = () => {};
fishingManager._burst = () => {};

const STEP_MS = 16.67;

const PARAMS = {
  strength: 7, erratic: 6, stamina: 110, barSize: 20,
  progressRate: 9, drainRate: 11, tensionRise: 17, tensionDecay: 12,
  minFightMs: 6000,
};

// Drive a fight through the real manager, feeding it a scripted sequence of
// manual `held` values, and return the simulation state it ends on.
function runThroughManager(seed, heldAt, maxSteps = 4000) {
  frames.length = 0;
  clock = 0;

  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed, params: PARAMS });

  let steps = 0;
  while (frames.length && steps < maxSteps) {
    fishingManager.held = heldAt(steps);
    const tick = frames.shift();
    clock += STEP_MS;
    tick(clock);
    steps += 1;
  }

  const state = fishingManager.sim ? fishingManager.sim.getState() : null;
  return { state, phase: fishingManager.phase, steps };
}

// The same fight run against a bare simulation, with no manager involved.
//
// The clock arithmetic mirrors _startLoop exactly - accumulate a timestamp,
// then take dt as the difference from the last one. Passing a constant STEP_MS
// instead leaves a float-accumulation gap of ~1e-12 against the manager's
// derived dt, which is enough to fail an exact comparison. The equality here
// is meant to be that strict: it should catch any real divergence outright.
function runBareSim(seed, heldAt, maxSteps = 4000) {
  const sim = createFightSim(PARAMS, seed);
  let outcome = null;
  let steps = 0;
  let clk = 0;
  let last = 0;
  while (!outcome && steps < maxSteps) {
    clk += STEP_MS;
    const dt = Math.min(100, clk - last);
    last = clk;
    outcome = sim.step(dt, heldAt(steps));
    steps += 1;
  }
  return { state: sim.getState(), outcome, steps };
}

function reset() {
  fishingAuto.disable();
  fishingAuto.enabled = false;
  fishingAuto.controller = null;
  fishingAuto.cancelTimers();
  fishingManager._reset('idle');
  frames.length = 0;
  sent.length = 0;
  scheduled.length = 0;
  clock = 0;
}

// ---- Outbound capture ------------------------------------------------------
// The manager sends through gmcp.send; capturing at _sendCast / _sendHook
// keeps the assertions on what the Auto-Angler decided rather than on wire
// formatting, which fishing-manager already owns.

const sent = [];
const realSendCast = fishingManager._sendCast;
const realSendHook = fishingManager._sendHook;

fishingManager._sendCast = function captureCast(power) {
  sent.push({ kind: 'cast', power });
  this.phase = 'waiting';
  if (this.session) this.session.baited = false;
};
fishingManager._sendHook = function captureHook() {
  if (this.phase !== 'bite') return;
  sent.push({ kind: 'hook' });
  this.phase = 'hooking';
};

// ---- Controllable timers ---------------------------------------------------
// Replacing _after rather than waiting on real timers keeps the tests fast and
// exact, and makes the scheduled delay itself assertable - which is most of
// what there is to check about cast release and hook reaction.

const scheduled = [];
fishingAuto._after = function captureAfter(delayMs, fn) {
  const entry = { delayMs, fn, cancelled: false, fired: false };
  scheduled.push(entry);
  return entry;
};
fishingAuto.cancelTimers = function cancelCaptured() {
  for (const entry of scheduled) entry.cancelled = true;
};

// Fire the most recently scheduled callback, honouring cancellation.
function fireLast() {
  const entry = scheduled[scheduled.length - 1];
  if (!entry || entry.cancelled || entry.fired) return false;
  entry.fired = true;
  entry.fn();
  return true;
}

function lastDelay() {
  return scheduled.length ? scheduled[scheduled.length - 1].delayMs : null;
}

// Open a baited session, which is what triggers an automated cast.
function openSession() {
  fishingManager._onOpen({ session: 's1', terrain: 'lake', skill: 100, baited: true });
}

// ---- M8: zero footprint when disabled --------------------------------------

// Scripted input patterns, chosen to exercise the loop rather than to play
// well: a held bar, a released bar, and alternating input.
const PATTERNS = {
  alwaysHeld: () => true,
  neverHeld: () => false,
  alternating: (i) => Math.floor(i / 12) % 2 === 0,
  erratic: (i) => (i * 7919) % 23 < 11,
};

test('with the Auto-Angler off, a fight resolves exactly as a bare simulation', () => {
  reset();
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    for (const seed of [1, 2, 3, 17, 99]) {
      const viaManager = runThroughManager(seed, pattern);
      const bare = runBareSim(seed, pattern);

      assert.ok(viaManager.state, name + ' seed ' + seed + ' lost its simulation');
      assert.equal(viaManager.state.outcome, bare.state.outcome,
        name + ' seed ' + seed + ' diverged on outcome');
      assert.equal(viaManager.state.elapsedMs, bare.state.elapsedMs,
        name + ' seed ' + seed + ' diverged on duration');
      assert.equal(viaManager.state.overlapMs, bare.state.overlapMs,
        name + ' seed ' + seed + ' diverged on overlap');
      assert.equal(viaManager.state.progress, bare.state.progress,
        name + ' seed ' + seed + ' diverged on progress');
      assert.equal(viaManager.state.tensionPeak, bare.state.tensionPeak,
        name + ' seed ' + seed + ' diverged on tension');
    }
  }
});

// The delegation point is guarded by isActive() specifically so a disabled
// addon never calls getState(), which allocates a fresh object every frame.
// A player who never turns this on should pay nothing for it.
test('a disabled Auto-Angler never reads the simulation state', () => {
  reset();
  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed: 5, params: PARAMS });

  let reads = 0;
  const real = fishingManager.sim.getState;
  fishingManager.sim.getState = function counted() { reads += 1; return real.call(this); };

  frames.length = 0;
  clock = 0;
  fishingManager._startLoop();
  for (let i = 0; i < 120 && frames.length; i++) {
    fishingManager.held = i % 2 === 0;
    const tick = frames.shift();
    clock += STEP_MS;
    tick(clock);
  }

  assert.equal(reads, 0, 'disabled Auto-Angler read the simulation ' + reads + ' times');
});

test('a disabled Auto-Angler builds no controller when a fight starts', () => {
  reset();
  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed: 5, params: PARAMS });
  assert.equal(fishingAuto.controller, null);
});

// ---- Enabled: the addon actually takes the fight over -----------------------

test('an enabled Auto-Angler overrides the manual input', () => {
  reset();
  fishingAuto.enable();

  // Manual input pinned to false throughout. A bare simulation played that way
  // loses; if the Auto-Angler is driving, it should not.
  const bare = runBareSim(7, PATTERNS.neverHeld);
  const viaManager = runThroughManager(7, PATTERNS.neverHeld);

  assert.equal(bare.state.outcome, 'slack', 'the never-held baseline should lose');
  assert.equal(viaManager.state.outcome, 'caught',
    'the Auto-Angler should have landed it regardless of manual input');
  fishingAuto.disable();
});

test('the controller is dropped when the fight resolves', () => {
  reset();
  fishingAuto.enable();
  runThroughManager(7, PATTERNS.neverHeld);
  assert.equal(fishingAuto.controller, null);
  fishingAuto.disable();
});

test('manual input during an automated fight hands control straight back', () => {
  reset();
  fishingAuto.enable();

  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed: 7, params: PARAMS });
  assert.ok(fishingAuto.controller, 'expected the Auto-Angler to be driving');

  fishingAuto.notifyManualInput();

  assert.equal(fishingAuto.enabled, false);
  assert.equal(fishingAuto.controller, null);

  // And from here the manual value is what reaches the simulation again.
  assert.equal(fishingAuto.resolveHeld(true, fishingManager.sim.getState(), STEP_MS), true);
  assert.equal(fishingAuto.resolveHeld(false, fishingManager.sim.getState(), STEP_MS), false);
});

test('a disconnect drops the controller mid-fight', () => {
  reset();
  fishingAuto.enable();
  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed: 7, params: PARAMS });
  assert.ok(fishingAuto.controller);

  fishingManager.handleDisconnect();
  assert.equal(fishingAuto.controller, null);
  fishingAuto.disable();
});

test('a server verdict drops the controller even mid-fight', () => {
  reset();
  fishingAuto.enable();
  fishingManager.session = { id: 's1', terrain: 'lake', skill: 0, baited: true };
  fishingManager._onFight({ session: 's1', seed: 7, params: PARAMS });
  assert.ok(fishingAuto.controller);

  // The server can end an attempt before our simulation reaches an outcome.
  fishingManager._onEscaped({ session: 's1', reason: 'timeout' });
  assert.equal(fishingAuto.controller, null);
  fishingAuto.disable();
});

// ---- Cast, hook, and the loop ---------------------------------------------
// The loop reaches the socket and the settings store only through the runtime
// app.js injects, so both are captured here. _onOpen also touches the panel
// manager and the bite path plays sounds; neither matters to these tests.

const { HALT_REASONS } = await import('../public/js/fishing-auto.js');
const { castReleaseMs } = await import('../public/js/fishing-auto-core.mjs');
const { panelManager } = await import('../public/js/panel-manager.js');
const { soundManager } = await import('../public/js/sound-manager.js');
panelManager.openPanel = () => {};
panelManager._renderPanel = () => {};
soundManager.play = () => {};
soundManager.loop = () => {};
soundManager.stopById = () => {};

// fishingManager.init() is never called here (it registers GMCP handlers), so
// the hand-over it performs is done by hand.
fishingAuto.attach(fishingManager);

const commands = [];
const saved = new Map();
let connected = true;
fishingAuto.configureRuntime({
  sendCommand: (text) => { commands.push(text); return true; },
  isConnected: () => connected,
  loadSetting: (key) => saved.get(key),
  saveSetting: (key, value) => { saved.set(key, value); },
});

function resetLoop() {
  reset();
  commands.length = 0;
  saved.clear();
  connected = true;
  fishingAuto.castPower = TUNING.castPowerStart;
  fishingAuto.powerOverride = null;
  fishingAuto._baitAttempted = false;
  fishingAuto.haltReason = '';
}

// Enable on an idle panel, open a baited session, and release the cast.
function castAway(seed) {
  fishingAuto.enable({ seed });
  openSession();
  clock += lastDelay();
  fireLast();
}

test('a baited session opening casts at the adaptive power, released on the oscillator', () => {
  resetLoop();
  fishingAuto.enable({ seed: 11 });
  openSession();
  assert.equal(fishingManager.phase, 'casting');

  const delay = lastDelay();
  const j = TUNING.castPowerJitter;
  assert.ok(delay >= castReleaseMs(TUNING.castPowerStart - j) && delay <= castReleaseMs(TUNING.castPowerStart + j),
    'release timed for the target power, got ' + delay);

  clock += delay;
  assert.ok(fireLast());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'cast');
  assert.ok(Math.abs(sent[0].power - TUNING.castPowerStart) <= j + 1, 'power ' + sent[0].power);
  assert.equal(sent[0].power, castPowerAt(delay), 'the power is whatever the oscillator read at release');
});

test('a release that fires past a full oscillator period abandons the cast', () => {
  resetLoop();
  fishingAuto.enable({ seed: 11 });
  openSession();
  clock += 1300;
  fireLast();
  assert.equal(sent.length, 0);
  assert.equal(fishingManager.phase, 'ready');
  assert.equal(fishingAuto.enabled, true, 'an abandoned cast is not a halt');
});

test('a bite is hooked after a human-plausible delay inside the window', () => {
  resetLoop();
  castAway(3);
  assert.equal(fishingManager.phase, 'waiting');

  fishingManager._onBite({ session: 's1', windowMs: 2500 });
  const delay = lastDelay();
  assert.ok(delay >= TUNING.hookDelayFloorMs, 'never faster than a person: ' + delay);
  assert.ok(delay <= 2500 * TUNING.hookWindowSafety, 'never spends the window: ' + delay);

  assert.ok(fireLast());
  assert.deepEqual(sent[sent.length - 1], { kind: 'hook' });
  assert.equal(fishingManager.phase, 'hooking');
});

test('a short bite window caps the hook delay below the plausibility floor', () => {
  resetLoop();
  castAway(3);
  fishingManager._onBite({ session: 's1', windowMs: 200 });
  assert.ok(lastDelay() <= 200 * TUNING.hookWindowSafety, 'got ' + lastDelay());
});

test('a pending hook is cancelled when the session resets', () => {
  resetLoop();
  castAway(3);
  fishingManager._onBite({ session: 's1', windowMs: 2500 });
  const hook = scheduled[scheduled.length - 1];
  openSession();
  assert.equal(hook.cancelled, true);
  assert.equal(hook.fired, false);
});

test('a confirmed catch tallies the run, raises cast power, and re-baits after a pause', () => {
  resetLoop();
  castAway(5);
  fishingManager._onBite({ session: 's1', windowMs: 2500 });
  fireLast();
  fishingManager._onFight({ session: 's1', seed: 7, params: PARAMS });
  assert.ok(fishingAuto.controller, 'the fight is being driven');

  fishingManager._onCaught({ session: 's1', fish: { id: 'x', name: 'x' }, rewards: {} });
  assert.equal(fishingAuto.controller, null);
  assert.equal(fishingAuto.stats.landed, 1);
  assert.equal(fishingAuto.stats.cycles, 1);
  assert.equal(fishingAuto.castPower, TUNING.castPowerStart + TUNING.castPowerOnCatch);
  assert.equal(saved.get('autofishCastPower'), fishingAuto.castPower, 'the new power is persisted');

  const pause = lastDelay();
  assert.ok(pause >= TUNING.cycleDelayMinMs && pause <= TUNING.cycleDelayMaxMs, 'cycle pause ' + pause);
  commands.length = 0;
  assert.ok(fireLast());
  assert.deepEqual(commands, ['bait hook']);

  const baitPause = lastDelay();
  assert.ok(baitPause >= TUNING.baitDelayMinMs && baitPause <= TUNING.baitDelayMaxMs, 'bait pause ' + baitPause);
  assert.ok(fireLast());
  assert.deepEqual(commands, ['bait hook', 'fish']);

  // The next Open is baited: the run continues with a fresh cast.
  openSession();
  assert.equal(fishingAuto.enabled, true);
  assert.equal(fishingManager.phase, 'casting');
});

test('an escape counts by cause and lowers cast power; a timeout leaves it alone', () => {
  resetLoop();
  castAway(5);
  fishingManager._onEscaped({ session: 's1', reason: 'snap' });
  assert.equal(fishingAuto.stats.lost.snap, 1);
  assert.equal(fishingAuto.castPower, TUNING.castPowerStart + TUNING.castPowerOnEscape);

  const after = fishingAuto.castPower;
  fishingManager._onEscaped({ session: 's1', reason: 'timeout' });
  assert.equal(fishingAuto.stats.lost.timeout, 1);
  assert.equal(fishingAuto.castPower, after, 'a missed bite says nothing about the fish');
  assert.equal(fishingAuto.status().lost, 2);
  assert.equal(fishingAuto.status().cycles, 2);
});

test('out of bait halts after exactly one failed bait cycle', () => {
  resetLoop();
  // The player switched the addon on with a session that had opened unbaited.
  fishingManager._onOpen({ session: 's1', terrain: 'lake', skill: 100, baited: false });
  fishingAuto.enable({ seed: 9 });
  assert.deepEqual(commands, ['bait hook']);
  assert.ok(fireLast());
  assert.deepEqual(commands, ['bait hook', 'fish']);

  fishingManager._onOpen({ session: 's2', terrain: 'lake', skill: 100, baited: false });
  assert.equal(fishingAuto.enabled, false);
  assert.equal(fishingAuto.haltReason, HALT_REASONS.NO_BAIT);
  assert.deepEqual(commands, ['bait hook', 'fish'], 'no second bait attempt');
  assert.equal(saved.get('autofishEnabled'), false);
});

test('enabling with no session opens one, but not while disconnected', () => {
  resetLoop();
  fishingAuto.enable({ seed: 1 });
  assert.deepEqual(commands, ['fish']);
  assert.equal(saved.get('autofishEnabled'), true);

  resetLoop();
  connected = false;
  fishingAuto.enable({ seed: 1 });
  assert.deepEqual(commands, []);
});

test('the session ending and a disconnect each halt the run with their reason', () => {
  resetLoop();
  castAway(1);
  fishingManager._onEnd({ session: 's1' });
  assert.equal(fishingAuto.enabled, false);
  assert.equal(fishingAuto.haltReason, HALT_REASONS.SESSION_END);

  resetLoop();
  castAway(1);
  fishingManager.handleDisconnect();
  assert.equal(fishingAuto.enabled, false);
  assert.equal(fishingAuto.haltReason, HALT_REASONS.DISCONNECTED);
});

test('a pinned cast power is used as-is and never adapted', () => {
  resetLoop();
  fishingAuto.enable({ seed: 2 });
  fishingAuto.handleCommand(['power', '80']);
  assert.equal(fishingAuto.powerOverride, 80);
  assert.equal(saved.get('autofishPowerOverride'), 80);

  openSession();
  assert.ok(Math.abs(lastDelay() - castReleaseMs(80)) <= castReleaseMs(TUNING.castPowerJitter),
    'release aimed at 80, got ' + lastDelay());

  fishingManager._onCaught({ session: 's1', fish: {}, rewards: {} });
  assert.equal(fishingAuto.castPower, TUNING.castPowerStart, 'adaptive power untouched while pinned');
  assert.equal(fishingAuto.status().power, 80);

  fishingAuto.handleCommand(['power', 'auto']);
  assert.equal(fishingAuto.powerOverride, null);
  assert.equal(saved.get('autofishPowerOverride'), null);
});

test('/autofish on and off switch the addon and record why it stopped', () => {
  resetLoop();
  fishingAuto.handleCommand(['on']);
  assert.equal(fishingAuto.enabled, true);
  fishingAuto.handleCommand(['off']);
  assert.equal(fishingAuto.enabled, false);
  assert.equal(fishingAuto.haltReason, HALT_REASONS.SWITCHED_OFF);
  assert.equal(fishingAuto.status().phase, 'idle');
  assert.equal(fishingAuto.panelState().haltReason, HALT_REASONS.SWITCHED_OFF);
});

test('init restores the persisted power, override, and armed state without sending anything', () => {
  resetLoop();
  saved.set('autofishCastPower', 70);
  saved.set('autofishPowerOverride', 30);
  saved.set('autofishEnabled', true);
  fishingAuto.init();
  assert.equal(fishingAuto.castPower, 70);
  assert.equal(fishingAuto.powerOverride, 30);
  assert.equal(fishingAuto.enabled, true);
  assert.deepEqual(commands, [], 'a restored run waits for a session to open');

  openSession();
  assert.equal(fishingManager.phase, 'casting', 'and takes over when one does');
  fishingAuto.disable();
});
