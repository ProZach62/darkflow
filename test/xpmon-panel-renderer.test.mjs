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

const { panelRenderers } = await import('../public/js/panel-renderers.js');

test('xpmon pane renders inactive state with on command', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.xpmon(bodyEl, { active: false });

  assert.match(bodyEl.innerHTML, /XP monitor is off/);
  assert.match(bodyEl.innerHTML, /data-command="xpmon on"/);
  assert.doesNotMatch(bodyEl.innerHTML, /xpmon reset/);
});

test('xpmon pane renders active totals, rates, and controls', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.xpmon(bodyEl, {
    active: true,
    xp: 12345,
    gold: 678,
    elapsed_seconds: 900,
    xp_per_hour: 49380,
    gold_per_hour: 2712,
  });

  assert.match(bodyEl.innerHTML, /12,345/);
  assert.match(bodyEl.innerHTML, /678/);
  assert.match(bodyEl.innerHTML, /15m 0s/);
  assert.match(bodyEl.innerHTML, /49,380/);
  assert.match(bodyEl.innerHTML, /2,712/);
  assert.match(bodyEl.innerHTML, /data-command="xpmon reset"/);
  assert.match(bodyEl.innerHTML, /data-command="xpmon off"/);
});
