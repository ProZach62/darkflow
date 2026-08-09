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
const { createFightSim } = await import('../public/js/fishing-core.mjs');

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
  fishingManager._reset('idle');
  frames.length = 0;
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
