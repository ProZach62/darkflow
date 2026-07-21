import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
    };
  },
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

const { skyRecomputeMoon } = await import('../public/js/panel-renderers.js');

test('hour-based moons advance at real-hour phase boundaries', () => {
  const moon = { id: 'markas', phase_hours: 2.5, cycle_days: 2.5 };

  assert.equal(skyRecomputeMoon(moon, {
    gameNow: 0,
    daySinceBeginning: 1,
  }).phase, 1);
  assert.equal(skyRecomputeMoon(moon, {
    gameNow: 8999,
    daySinceBeginning: 1,
  }).phase, 1);
  assert.equal(skyRecomputeMoon(moon, {
    gameNow: 9000,
    daySinceBeginning: 1,
  }).phase, 2);
  assert.equal(skyRecomputeMoon(moon, {
    gameNow: 72000,
    daySinceBeginning: 4,
  }).phase, 1);
});

test('legacy day-based moon payloads remain supported', () => {
  const moon = { id: 'markas', cycle_days: 2.5 };
  const result = skyRecomputeMoon(moon, {
    gameNow: 0,
    daySinceBeginning: 5,
  });

  assert.equal(result.phase, 3);
  assert.equal(result.phase_name, 'half');
});
