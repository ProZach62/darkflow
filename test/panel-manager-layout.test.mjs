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
  getComputedStyle(el) {
    return {
      width: el && el._computedWidth ? el._computedWidth : '',
      height: el && el._computedHeight ? el._computedHeight : '',
    };
  },
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

test('focused panes cannot jump above a higher saved layer', () => {
  panelManager._mobile.enabled = false;
  panelManager.state.panels = {
    terminal: { dock: 'float', zLayer: 0 },
    map: { dock: 'float', zLayer: 1 },
  };
  panelManager.panels = {
    terminal: { el: { style: { zIndex: '1000' } } },
    map: { el: { style: { zIndex: '1010' } } },
  };

  panelManager._bringPanelToFront('terminal');

  assert.equal(panelManager.panels.terminal.el.style.zIndex, '1009');
  assert.equal(panelManager.panels.map.el.style.zIndex, '1010');
  assert.ok(Number(panelManager.panels.map.el.style.zIndex) > Number(panelManager.panels.terminal.el.style.zIndex));
});

test('enemy pane defaults to layer one', () => {
  assert.equal(panelManager._defaultPaneLayer('enemy'), 1);
  assert.equal(panelManager._getEffectivePaneZIndex('enemy', { zLayer: undefined }), 1010);
});

test('enemy pane opens for combat and closes when combat clears', () => {
  const originalCreatePanel = panelManager.createPanel;
  const originalBringPanelToFront = panelManager._bringPanelToFront;
  const originalKeepEnemyPanelAbove = panelManager._keepEnemyPanelAbove;
  const originalSaveState = panelManager.saveState;
  const originalRenderMobileSheet = panelManager._renderMobileSheet;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      enemy: {
        dock: 'float',
        visible: false,
        zLayer: 1,
        floatX: 40,
        floatY: 50,
        floatW: 380,
        floatH: 131,
        snapLeft: false,
        snapTop: false,
        snapRight: false,
        snapBottom: false,
      },
    };
    panelManager.panels = {};
    panelManager.gmcpData.enemy = {
      enemy_name: 'a target',
      enemy_curhp: 10,
      enemy_maxhp: 10,
    };

    let created = 0;
    let raised = 0;
    let saved = 0;
    panelManager.createPanel = (id) => {
      created++;
      panelManager.panels[id] = {
        el: {
          style: { display: 'none', zIndex: '' },
          getBoundingClientRect() {
            return { left: 123, top: 234, width: 456, height: 167 };
          },
        },
      };
    };
    panelManager._bringPanelToFront = (id) => {
      raised++;
      panelManager.panels[id].el.style.zIndex = '1019';
    };
    panelManager._keepEnemyPanelAbove = () => {};
    panelManager.saveState = () => { saved++; };
    panelManager._renderMobileSheet = () => {};

    panelManager._syncEnemyPanelVisibility();

    assert.equal(created, 1);
    assert.equal(raised, 1);
    assert.equal(panelManager.state.panels.enemy.visible, true);
    assert.equal(panelManager.panels.enemy.el.style.display, '');

    panelManager.gmcpData.enemy = { enemy_name: 'None' };
    panelManager._syncEnemyPanelVisibility();

    assert.equal(panelManager.state.panels.enemy.visible, false);
    assert.equal(panelManager.panels.enemy.el.style.display, 'none');
    assert.equal(panelManager.state.panels.enemy.floatX, 123);
    assert.equal(panelManager.state.panels.enemy.floatY, 234);
    assert.equal(panelManager.state.panels.enemy.floatW, 456);
    assert.equal(panelManager.state.panels.enemy.floatH, 167);
    assert.equal(saved, 2);
  } finally {
    panelManager.createPanel = originalCreatePanel;
    panelManager._bringPanelToFront = originalBringPanelToFront;
    panelManager._keepEnemyPanelAbove = originalKeepEnemyPanelAbove;
    panelManager.saveState = originalSaveState;
    panelManager._renderMobileSheet = originalRenderMobileSheet;
  }
});

test('generic opponent payloads normalize to enemy panel data', () => {
  assert.deepEqual(panelManager._normalizeEnemyData({
    name: 'the owlbear',
    hp: 71,
    mhp: 100,
    mn: 5000,
    mmn: 5000,
    level: 10,
  }), {
    enemy_name: 'the owlbear',
    enemy_curhp: 71,
    enemy_maxhp: 100,
    enemy_cursp: 5000,
    enemy_maxsp: 5000,
    enemy_level: 10,
    enemy_image: '',
    enemy_hp_string: '',
  });
});

test('hidden enemy pane does not overwrite saved resized dimensions', () => {
  panelManager.state.panels = {
    enemy: {
      dock: 'float',
      visible: false,
      floatW: 456,
      floatH: 167,
    },
  };
  panelManager.panels = {
    enemy: {
      el: {
        style: { display: 'none' },
        offsetWidth: 0,
        offsetHeight: 0,
        clientWidth: 0,
        clientHeight: 0,
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 0, height: 0 };
        },
      },
    },
  };

  panelManager._captureFloatPanelGeometry('enemy');

  assert.equal(panelManager.state.panels.enemy.floatW, 456);
  assert.equal(panelManager.state.panels.enemy.floatH, 167);
});
