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
const { PANEL_DEFS } = await import('../public/js/panel-defs.js');

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

test('map zoom updates pane state, controls, and render scale', () => {
  const originalPanels = panelManager.panels;
  const originalState = panelManager.state;
  const originalRenderPanel = panelManager._renderPanel;
  const originalSaveState = panelManager.saveState;
  let renders = 0;
  let saves = 0;

  try {
    const controls = {
      level: { textContent: '' },
      outBtn: { disabled: false },
      inBtn: { disabled: false },
    };
    panelManager.state = { docks: {}, panels: { map: { mapZoom: 1 } } };
    panelManager.panels = {
      map: { bodyEl: { dataset: {} }, mapZoomControls: controls },
    };
    panelManager._renderPanel = () => { renders++; };
    panelManager.saveState = () => { saves++; };

    panelManager.setMapZoom('map', 0.7);

    assert.equal(panelManager.state.panels.map.mapZoom, 0.7);
    assert.equal(panelManager.panels.map.bodyEl.dataset.mapZoom, '0.7');
    assert.equal(controls.level.textContent, '70%');
    assert.equal(controls.outBtn.disabled, false);
    assert.equal(controls.inBtn.disabled, false);
    assert.equal(renders, 1);
    assert.equal(saves, 1);
  } finally {
    panelManager.panels = originalPanels;
    panelManager.state = originalState;
    panelManager._renderPanel = originalRenderPanel;
    panelManager.saveState = originalSaveState;
  }
});

test('map recenter clears both pan axes without changing zoom', () => {
  const originalPanels = panelManager.panels;
  const originalRenderPanel = panelManager._renderPanel;
  let renders = 0;

  try {
    panelManager.panels = {
      map: {
        bodyEl: {
          dataset: { mapZoom: '0.5', mapPanX: '6', mapPanY: '-3.5' },
        },
      },
    };
    panelManager._renderPanel = () => { renders++; };

    panelManager.recenterMap('map');

    assert.deepEqual(panelManager.panels.map.bodyEl.dataset, {
      mapZoom: '0.5',
      mapPanX: '0',
      mapPanY: '0',
    });
    assert.equal(renders, 1);
  } finally {
    panelManager.panels = originalPanels;
    panelManager._renderPanel = originalRenderPanel;
  }
});

test('jukebox state updates do not automatically open its pane', () => {
  const originalGmcpData = panelManager.gmcpData;
  const originalRenderPanel = panelManager._renderPanel;
  const originalOpenPanel = panelManager.openPanel;
  let renders = 0;
  let opens = 0;

  try {
    panelManager.gmcpData = {};
    panelManager._renderPanel = (id) => {
      if (id === 'roomPlaylist') renders++;
    };
    panelManager.openPanel = () => { opens++; };

    panelManager.handleRoomPlaylistState({
      enabled: true,
      room_id: '/domains/darkwind/room/tavern',
    });

    assert.equal(panelManager.gmcpData.roomPlaylist.enabled, true);
    assert.equal(panelManager.gmcpData.roomPlaylist.room_id, '/domains/darkwind/room/tavern');
    assert.equal(renders, 1);
    assert.equal(opens, 0);
  } finally {
    panelManager.gmcpData = originalGmcpData;
    panelManager._renderPanel = originalRenderPanel;
    panelManager.openPanel = originalOpenPanel;
  }
});

test('docking a map queues a render for the new sidebar dimensions', () => {
  const originalPanels = panelManager.panels;
  const originalState = panelManager.state;
  const originalQueuePanelRender = panelManager._queuePanelRender;
  const originalApplyDockStateToDom = panelManager._applyDockStateToDom;
  const originalInsertIntoDock = panelManager._insertIntoDock;
  const originalSaveState = panelManager.saveState;
  const originalDocument = globalThis.document;
  const queued = [];

  try {
    const floatBtn = { title: '', innerHTML: '' };
    const panelEl = { querySelector: () => floatBtn };
    panelManager.state = {
      docks: { left: true, right: true },
      panels: { map: { dock: 'float', order: 0 } },
    };
    panelManager.panels = { map: { el: panelEl } };
    panelManager._queuePanelRender = (id) => queued.push(id);
    panelManager._applyDockStateToDom = () => {};
    panelManager._insertIntoDock = () => {};
    panelManager.saveState = () => {};
    globalThis.document = {
      getElementById: () => ({
        querySelectorAll: () => [],
      }),
    };

    panelManager.dockPanel('map', 'left', 0);

    assert.deepEqual(queued, ['map']);
    assert.equal(panelManager.state.panels.map.dock, 'left');
  } finally {
    panelManager.panels = originalPanels;
    panelManager.state = originalState;
    panelManager._queuePanelRender = originalQueuePanelRender;
    panelManager._applyDockStateToDom = originalApplyDockStateToDom;
    panelManager._insertIntoDock = originalInsertIntoDock;
    panelManager.saveState = originalSaveState;
    globalThis.document = originalDocument;
  }
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

test('ide pane defaults to a hidden large floating panel', () => {
  assert.equal(PANEL_DEFS.ide.title, 'IDE');
  assert.equal(PANEL_DEFS.ide.defaultDock, 'float');
  assert.equal(PANEL_DEFS.ide.defaultVisible, false);
  assert.equal(PANEL_DEFS.ide.defaultFloatW, 900);
  assert.equal(PANEL_DEFS.ide.defaultFloatH, 620);
  assert.equal(panelManager._defaultPaneLayer('ide'), 5);
  assert.equal(panelManager._getEffectivePaneZIndex('ide', { zLayer: undefined }), 1050);
});

test('xp monitor pane defaults to a visible left dock panel', () => {
  assert.equal(PANEL_DEFS.xpmon.title, 'XP Monitor');
  assert.equal(PANEL_DEFS.xpmon.defaultDock, 'left');
  assert.equal(PANEL_DEFS.xpmon.defaultOrder, 8);
});

test('desktop mode removes mobile-only visibility classes from recreated panes', () => {
  const classes = new Set(['gmcp-panel-widget', 'mobile-panel-active', 'mobile-panel-hidden']);
  const originalPanels = panelManager.panels;
  const originalContent = panelManager._mobile.contentEl;
  const originalEnabled = panelManager._mobile.enabled;
  try {
    panelManager._mobile.contentEl = {};
    panelManager._mobile.enabled = false;
    panelManager.panels = {
      map: {
        el: {
          classList: {
            remove(...names) { for (const name of names) classes.delete(name); },
          },
        },
      },
    };

    panelManager._syncMobilePanelVisibility();
    assert.equal(classes.has('mobile-panel-hidden'), false);
    assert.equal(classes.has('mobile-panel-active'), false);
    assert.equal(classes.has('gmcp-panel-widget'), true);
  } finally {
    panelManager.panels = originalPanels;
    panelManager._mobile.contentEl = originalContent;
    panelManager._mobile.enabled = originalEnabled;
  }
});

test('panel close handlers can block pane removal for dirty editors', () => {
  let removed = 0;
  let saved = 0;
  const originalRenderMobileSheet = panelManager._renderMobileSheet;
  const originalSaveState = panelManager.saveState;
  const originalSyncGmcpSubscriptions = panelManager.syncGmcpSubscriptions;

  try {
    panelManager._mobile.activePanelId = null;
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      ide: { dock: 'float', visible: true },
    };
    panelManager.panels = {
      ide: { el: { remove() { removed++; } } },
    };
    panelManager._renderMobileSheet = () => {};
    panelManager.saveState = () => { saved++; };
    panelManager.syncGmcpSubscriptions = () => {};

    panelManager.registerPanelCloseHandler('ide', () => false);
    panelManager.closePanel('ide');
    assert.equal(panelManager.state.panels.ide.visible, true);
    assert.equal(removed, 0);

    panelManager.unregisterPanelCloseHandler('ide');
    panelManager.closePanel('ide');
    assert.equal(panelManager.state.panels.ide.visible, false);
    assert.equal(removed, 1);
    assert.equal(saved, 1);
  } finally {
    panelManager.unregisterPanelCloseHandler('ide');
    panelManager._renderMobileSheet = originalRenderMobileSheet;
    panelManager.saveState = originalSaveState;
    panelManager.syncGmcpSubscriptions = originalSyncGmcpSubscriptions;
  }
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

test('visual layout migration sets the requested 580 by 465 Combat frame at layer 10', () => {
  const originalSaveState = panelManager.saveState;
  const originalApplyFloatPosition = panelManager._applyFloatPosition;
  let saves = 0;
  let applies = 0;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      enemy: {
        dock: 'float',
        visible: true,
        floatW: PANEL_DEFS.enemy.defaultFloatW,
        floatH: PANEL_DEFS.enemy.defaultFloatH,
        combatVisualExpanded: false,
      },
    };
    panelManager.panels = { enemy: { el: {} } };
    panelManager.saveState = () => { saves++; };
    panelManager._applyFloatPosition = () => { applies++; };

    assert.equal(panelManager.prepareCombatVisualLayout(), true);
    assert.equal(panelManager.state.panels.enemy.floatW, 580);
    assert.equal(panelManager.state.panels.enemy.floatH, 465);
    assert.equal(panelManager.state.panels.enemy.zLayer, 10);
    assert.equal(panelManager.state.panels.enemy.floatZ, 1100);
    assert.equal(panelManager.state.panels.enemy.combatVisualExpanded, true);
    assert.equal(panelManager.state.panels.enemy.combatVisualLayoutVersion, 3);
    assert.equal(saves, 1);
    assert.equal(applies, 1);

    assert.equal(panelManager.prepareCombatVisualLayout(), false);
    assert.equal(saves, 1, 'the visual expansion marker prevents repeated layout writes');
  } finally {
    panelManager.saveState = originalSaveState;
    panelManager._applyFloatPosition = originalApplyFloatPosition;
  }
});

test('first visual activation normalizes a player-resized Enemy pane to the Combat frame', () => {
  const originalSaveState = panelManager.saveState;
  panelManager._mobile.enabled = false;
  panelManager.state.panels = {
    enemy: {
      dock: 'float',
      visible: true,
      floatW: 512,
      floatH: 280,
      combatVisualExpanded: false,
    },
  };
  panelManager.panels = {};
  panelManager.saveState = () => {};

  try {
    assert.equal(panelManager.prepareCombatVisualLayout(), true);
    assert.equal(panelManager.state.panels.enemy.floatW, 580);
    assert.equal(panelManager.state.panels.enemy.floatH, 465);
    assert.equal(panelManager.state.panels.enemy.zLayer, 10);
    assert.equal(panelManager.state.panels.enemy.combatVisualExpanded, true);
    assert.equal(panelManager.state.panels.enemy.combatVisualLayoutVersion, 3);
  } finally {
    panelManager.saveState = originalSaveState;
  }
});

test('visual layout migration upgrades the prior automatic 620 by 420 size', () => {
  const originalSaveState = panelManager.saveState;
  const originalApplyFloatPosition = panelManager._applyFloatPosition;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      enemy: {
        dock: 'float',
        visible: true,
        floatX: 290,
        floatY: 180,
        floatW: 620,
        floatH: 420,
        combatVisualExpanded: true,
      },
    };
    panelManager.panels = { enemy: { el: {} } };
    panelManager.saveState = () => {};
    panelManager._applyFloatPosition = () => {};

    assert.equal(panelManager.prepareCombatVisualLayout(), true);
    assert.equal(panelManager.state.panels.enemy.floatW, 580);
    assert.equal(panelManager.state.panels.enemy.floatH, 465);
    assert.equal(panelManager.state.panels.enemy.zLayer, 10);
    assert.equal(panelManager.state.panels.enemy.combatVisualLayoutVersion, 3);
  } finally {
    panelManager.saveState = originalSaveState;
    panelManager._applyFloatPosition = originalApplyFloatPosition;
  }
});

test('visual layout migration replaces a custom prior size with the requested Combat frame', () => {
  const originalSaveState = panelManager.saveState;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      enemy: {
        dock: 'float',
        visible: true,
        floatW: 704,
        floatH: 510,
        combatVisualExpanded: true,
      },
    };
    panelManager.panels = {};
    panelManager.saveState = () => {};

    assert.equal(panelManager.prepareCombatVisualLayout(), true);
    assert.equal(panelManager.state.panels.enemy.floatW, 580);
    assert.equal(panelManager.state.panels.enemy.floatH, 465);
    assert.equal(panelManager.state.panels.enemy.zLayer, 10);
    assert.equal(panelManager.state.panels.enemy.combatVisualLayoutVersion, 3);
  } finally {
    panelManager.saveState = originalSaveState;
  }
});

test('visual layout migration expands a legacy Enemy pane before floating it from a dock', () => {
  const originalSaveState = panelManager.saveState;
  const originalApplyFloatPosition = panelManager._applyFloatPosition;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state.panels = {
      enemy: {
        dock: 'left',
        visible: true,
        floatW: PANEL_DEFS.enemy.defaultFloatW,
        floatH: PANEL_DEFS.enemy.defaultFloatH,
        combatVisualExpanded: false,
      },
    };
    panelManager.panels = { enemy: { el: {} } };
    panelManager.saveState = () => {};
    panelManager._applyFloatPosition = () => {};

    assert.equal(panelManager.prepareCombatVisualLayout(), true);
    assert.equal(panelManager.state.panels.enemy.floatW, 580);
    assert.equal(panelManager.state.panels.enemy.floatH, 465);
    assert.equal(panelManager.state.panels.enemy.zLayer, 10);
  } finally {
    panelManager.saveState = originalSaveState;
    panelManager._applyFloatPosition = originalApplyFloatPosition;
  }
});

test('mobile visual activation leaves the desktop size migration pending', () => {
  const originalSaveState = panelManager.saveState;
  let saves = 0;

  try {
    panelManager._mobile.enabled = true;
    panelManager.state.panels = {
      enemy: {
        dock: 'float',
        visible: true,
        floatW: PANEL_DEFS.enemy.defaultFloatW,
        floatH: PANEL_DEFS.enemy.defaultFloatH,
        combatVisualExpanded: false,
      },
    };
    panelManager.panels = {};
    panelManager.saveState = () => { saves++; };

    assert.equal(panelManager.prepareCombatVisualLayout(), false);
    assert.equal(panelManager.state.panels.enemy.floatW, PANEL_DEFS.enemy.defaultFloatW);
    assert.equal(panelManager.state.panels.enemy.floatH, PANEL_DEFS.enemy.defaultFloatH);
    assert.equal(panelManager.state.panels.enemy.combatVisualLayoutVersion, undefined);
    assert.equal(saves, 0);
  } finally {
    panelManager._mobile.enabled = false;
    panelManager.saveState = originalSaveState;
  }
});

test('active visual combat keeps its exact frame when pane grid snapping is enabled', () => {
  const originalActive = panelManager._combatVisualPresentationActive;
  try {
    panelManager._combatVisualPresentationActive = true;
    assert.deepEqual(
      panelManager._snapFloatSizeToGrid('enemy', 580, 465),
      { width: 580, height: 465 },
    );
    assert.deepEqual(
      panelManager._snapFloatSizeToGrid('enemy', 701, 512),
      { width: 580, height: 465 },
    );
  } finally {
    panelManager._combatVisualPresentationActive = originalActive;
  }
});

test('visual combat floats and centers the Enemy pane in the available screen', () => {
  const originalState = panelManager.state;
  const originalPanels = panelManager.panels;
  const originalMakeFloat = panelManager._makeFloat;
  const originalGetSnapBounds = panelManager._getSnapBounds;
  const originalApplyFloatPosition = panelManager._applyFloatPosition;
  let madeFloat = 0;
  let applied = 0;
  let uncollapsed = false;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state = {
      docks: { left: false, right: false },
      panels: {
        enemy: {
          dock: 'left',
          visible: true,
          collapsed: true,
          floatX: 12,
          floatY: 20,
          floatW: 620,
          floatH: 420,
          snapLeft: true,
          snapTop: true,
          snapRight: false,
          snapBottom: false,
          panelAnchor: { targetId: 'terminal', relation: 'above' },
        },
      },
    };
    panelManager.panels = {
      enemy: {
        el: {
          classList: { contains() { return false; } },
          querySelector() { return null; },
        },
        bodyEl: {
          classList: {
            remove(name) {
              if (name === 'collapsed') uncollapsed = true;
            },
          },
        },
      },
    };
    panelManager._makeFloat = () => { madeFloat++; };
    panelManager._getSnapBounds = () => ({
      left: 100,
      top: 40,
      right: 1100,
      bottom: 740,
    });
    panelManager._applyFloatPosition = () => { applied++; };

    assert.equal(panelManager._centerEnemyPanelForCombat(), true);
    const state = panelManager.state.panels.enemy;
    assert.equal(state.dock, 'float');
    assert.equal(state.collapsed, false);
    assert.equal(state.snapLeft, false);
    assert.equal(state.snapTop, false);
    assert.equal(state.snapRight, false);
    assert.equal(state.snapBottom, false);
    assert.equal(state.panelAnchor, undefined);
    assert.equal(state.floatW, 580);
    assert.equal(state.floatH, 465);
    assert.equal(state.zLayer, 10);
    assert.equal(state.floatZ, 1100);
    assert.equal(state.floatX, 310);
    assert.equal(state.floatY, 158);
    assert.equal(madeFloat, 1);
    assert.equal(applied, 1);
    assert.equal(uncollapsed, true);
  } finally {
    panelManager.state = originalState;
    panelManager.panels = originalPanels;
    panelManager._makeFloat = originalMakeFloat;
    panelManager._getSnapBounds = originalGetSnapBounds;
    panelManager._applyFloatPosition = originalApplyFloatPosition;
  }
});

test('active visual combat stays above higher-layer panes before Char.Enemy arrives', () => {
  const originalState = panelManager.state;
  const originalPanels = panelManager.panels;
  const originalGmcpData = panelManager.gmcpData;

  try {
    panelManager._mobile.enabled = false;
    panelManager.state = {
      docks: { left: false, right: false },
      panels: {
        enemy: { dock: 'float', visible: true, zLayer: 10 },
        ide: { dock: 'float', visible: true, zLayer: 50 },
      },
    };
    panelManager.panels = {
      enemy: { el: { style: { display: '', zIndex: '1019' } } },
      ide: { el: { style: { display: '', zIndex: '1509' } } },
    };
    panelManager.gmcpData = {
      enemy: { enemy_name: 'None' },
      combatVisual: { visualEnabled: true, active: true },
    };

    panelManager._keepEnemyPanelAbove();
    assert.equal(panelManager.panels.enemy.el.style.zIndex, '1510');
  } finally {
    panelManager.state = originalState;
    panelManager.panels = originalPanels;
    panelManager.gmcpData = originalGmcpData;
  }
});

test('presentation readiness rejects hidden, collapsed, and collapsed-dock combat panes', () => {
  panelManager._mobile.enabled = false;
  panelManager.state = {
    docks: { left: false, right: false },
    panels: {
      enemy: { dock: 'float', visible: true, collapsed: false },
    },
  };
  panelManager.panels = { enemy: { el: { style: { display: '' } } } };

  assert.equal(panelManager.getPanelPresentationState('enemy').ready, true);

  panelManager.state.panels.enemy.collapsed = true;
  assert.equal(panelManager.getPanelPresentationState('enemy').ready, false);

  panelManager.state.panels.enemy.collapsed = false;
  panelManager.state.panels.enemy.dock = 'left';
  panelManager.state.docks.left = true;
  assert.equal(panelManager.getPanelPresentationState('enemy').ready, false);

  panelManager.state.docks.left = false;
  panelManager.panels.enemy.el.style.display = 'none';
  assert.equal(panelManager.getPanelPresentationState('enemy').ready, false);
});

test('Combat title override is retained before a hidden Enemy pane is created', () => {
  panelManager._mobile.enabled = false;
  panelManager.panels = {};

  panelManager.setPanelTitle('enemy', 'Combat');
  assert.equal(panelManager._panelTitleOverrides.enemy, 'Combat');

  panelManager.setPanelTitle('enemy', 'Enemy');
  assert.equal(panelManager._panelTitleOverrides.enemy, undefined);
});

test('visual model toggles the Combat host layout class with the mode', () => {
  const originalPanels = panelManager.panels;
  const originalGmcpData = panelManager.gmcpData;
  const originalRenderPanel = panelManager._renderPanel;
  const toggles = [];

  try {
    panelManager.panels = {
      enemy: {
        el: {
          classList: {
            toggle(name, enabled) {
              toggles.push([name, enabled]);
            },
          },
        },
      },
    };
    panelManager.gmcpData = {};
    panelManager._renderPanel = () => true;

    assert.equal(panelManager.setCombatVisualState({ visualEnabled: true }), true);
    assert.deepEqual(toggles.at(-1), ['combat-visual-host', true]);
    assert.equal(panelManager.gmcpData.combatVisual.visualEnabled, true);

    panelManager.setCombatVisualState(null);
    assert.deepEqual(toggles.at(-1), ['combat-visual-host', false]);
    assert.equal(panelManager.gmcpData.combatVisual, undefined);
  } finally {
    panelManager.panels = originalPanels;
    panelManager.gmcpData = originalGmcpData;
    panelManager._renderPanel = originalRenderPanel;
  }
});
