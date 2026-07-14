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

test('cyberware pane shows waiting state before data arrives', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.cyberware(bodyEl, null);

  assert.match(bodyEl.innerHTML, /Waiting for data/);
});

test('cyberware pane renders strain summary and installed implants', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.cyberware(bodyEl, {
    installed: [
      {
        id: 'brain',
        name: 'Cortex OS',
        family: 'cyberware',
        grade: 'street',
        locations: ['brain'],
        strain: 3,
        visible: 0,
        durability: 97,
      },
      {
        id: 'left_eye+right_eye',
        name: 'Targeting Suite',
        family: 'cyberware',
        grade: 'military',
        locations: ['left_eye', 'right_eye'],
        strain: 2,
        visible: 1,
        durability: 80,
      },
    ],
    strain: { used: 5, total: 12 },
  });

  assert.match(bodyEl.innerHTML, /Cortex OS/);
  assert.match(bodyEl.innerHTML, /Targeting Suite/);
  assert.match(bodyEl.innerHTML, /5 \/ 12/);
  assert.match(bodyEl.innerHTML, /7 free/);
  assert.match(bodyEl.innerHTML, /left eye, right eye/);
  assert.match(bodyEl.innerHTML, /data-cyber-index="0"/);
  assert.match(bodyEl.innerHTML, /data-cyber-index="1"/);
});

test('cyberware pane escapes markup in implant names', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.cyberware(bodyEl, {
    installed: [{
      id: 'jaw',
      name: '<script>alert(1)</script>',
      locations: ['jaw'],
      strain: 1,
    }],
    strain: { used: 1, total: 4 },
  });

  assert.doesNotMatch(bodyEl.innerHTML, /<script>/);
  assert.match(bodyEl.innerHTML, /&lt;script&gt;/);
});

test('cyberware pane shows empty state with zero implants installed', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.cyberware(bodyEl, { installed: [], strain: { used: 0, total: 8 } });

  assert.match(bodyEl.innerHTML, /No cyberware installed/);
  assert.match(bodyEl.innerHTML, /0 \/ 8/);
});
