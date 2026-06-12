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
  requestAnimationFrame(callback) { return setTimeout(callback, 0); },
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

const { panelManager } = await import('../public/js/panel-manager.js');

test('initial floating layout preserves map and room image placement metadata', () => {
  const envelope = panelManager._createPanelStorageEnvelope(null);
  const panels = envelope.profiles.floating.panels;

  assert.equal(panels.map.dock, 'float');
  assert.equal(panels.map.snapRight, true);
  assert.equal(panels.map.snapTop, true);

  assert.equal(panels.roomImage.dock, 'float');
  assert.equal(panels.roomImage.snapRight, true);
  assert.equal(panels.roomImage.snapTop, false);
  assert.equal(panels.roomImage.floatX, panels.map.floatX);
  assert.equal(panels.roomImage.floatY, panels.map.floatY + panels.map.floatH + 8);
});

test('pane snap detection records left and right anchor relationships', () => {
  panelManager.panels = {
    terminal: {
      el: {
        getBoundingClientRect() {
          return { left: 300, top: 70, right: 900, bottom: 670 };
        },
      },
    },
  };
  panelManager.state.panels = {
    terminal: { dock: 'float' },
    avatar: { dock: 'float' },
    sky: { dock: 'float' },
  };

  const leftSnap = panelManager._getPanelSnapPosition(14, 96, 280, 220, 'avatar');
  assert.equal(leftSnap.x, 14);
  assert.deepEqual(leftSnap.panelAnchor, {
    targetId: 'terminal',
    relation: 'leftOf',
    offsetY: 26,
    gap: 6,
  });

  const rightSnap = panelManager._getPanelSnapPosition(906, 102, 280, 220, 'sky');
  assert.equal(rightSnap.x, 906);
  assert.deepEqual(rightSnap.panelAnchor, {
    targetId: 'terminal',
    relation: 'rightOf',
    offsetY: 32,
    gap: 6,
  });
});

test('anchored pane positions resolve from target pane geometry', () => {
  const targetRect = { left: 300, top: 70, right: 900, bottom: 670 };

  assert.deepEqual(panelManager._getAnchoredPosition({
    floatW: 280,
    floatH: 220,
    panelAnchor: { targetId: 'terminal', relation: 'leftOf', offsetY: 26, gap: 6 },
  }, targetRect), { x: 14, y: 96 });

  assert.deepEqual(panelManager._getAnchoredPosition({
    floatW: 280,
    floatH: 220,
    panelAnchor: { targetId: 'terminal', relation: 'rightOf', offsetY: 32, gap: 6 },
  }, targetRect), { x: 906, y: 102 });

  assert.deepEqual(panelManager._getAnchoredPosition({
    floatW: 280,
    floatH: 180,
    panelAnchor: { targetId: 'terminal', relation: 'above', offsetX: 40, gap: 6 },
  }, targetRect), { x: 340, y: 0 });

  assert.deepEqual(panelManager._getAnchoredPosition({
    floatW: 280,
    floatH: 180,
    panelAnchor: { targetId: 'terminal', relation: 'below', offsetX: 48, gap: 6 },
  }, targetRect), { x: 348, y: 620 });
});
