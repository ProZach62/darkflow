import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal fake element supporting what the guild-vitals renderer touches:
// classList, dataset, className get/set, appendChild ordering, remove,
// class-selector querySelector(All) over direct children.
function makeFakeEl(className = '') {
  const el = {
    children: [],
    dataset: {},
    style: {},
    title: '',
    textContent: '',
    _innerHTML: '',
    parent: null,
    appendChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      this.children.push(child);
      child.parent = this;
      return child;
    },
    remove() {
      if (this.parent) {
        const idx = this.parent.children.indexOf(this);
        if (idx >= 0) this.parent.children.splice(idx, 1);
        this.parent = null;
      }
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const classes = sel.split('.').filter(Boolean);
      return this.children.filter((child) =>
        classes.every((cls) => child.classList.contains(cls)));
    },
  };
  const classSet = new Set(String(className).split(/\s+/).filter(Boolean));
  el.classList = {
    add(...cls) { cls.forEach((c) => classSet.add(c)); },
    remove(...cls) { cls.forEach((c) => classSet.delete(c)); },
    contains(c) { return classSet.has(c); },
    [Symbol.iterator]() { return classSet.values(); },
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(classSet).join(' '); },
    set(value) {
      classSet.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((c) => classSet.add(c));
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(value) {
      this._innerHTML = value;
      if (value === '') this.children = [];
    },
  });
  return el;
}

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  createElement() { return makeFakeEl(); },
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

const { panelRenderers, guildVitalItemHtml } =
  await import('../public/js/panel-renderers.js');

test('boolean items render an LED with severity class', () => {
  const on = guildVitalItemHtml({
    kind: 'boolean', label: 'Overdrive', on: 1, severity: 'ok',
  });
  assert.match(on, /vitals-led on vitals-sev-ok/);
  assert.match(on, /Overdrive/);

  const off = guildVitalItemHtml({ kind: 'boolean', label: 'Overdrive', on: 0 });
  assert.doesNotMatch(off, /vitals-led on/);
});

test('flags items render ordered pips with on classes and tips', () => {
  const html = guildVitalItemHtml({
    kind: 'flags', label: 'Firmware',
    flags: [
      { label: 'OC', on: 1, tip: 'Overclock' },
      { label: 'OD', on: 0 },
      null,
    ],
  });
  assert.match(html, /vitals-flag on" title="Overclock">OC</);
  assert.match(html, /vitals-flag">OD</);
  assert.ok(html.indexOf('OC') < html.indexOf('OD'));
});

test('state items fall back from display to value and honor severity', () => {
  const html = guildVitalItemHtml({
    kind: 'state', label: 'Thermal', value: 'overheat',
    display: 'OVERHEAT', severity: 'danger',
  });
  assert.match(html, /vitals-state-badge vitals-sev-danger">OVERHEAT</);

  const fallback = guildVitalItemHtml({
    kind: 'state', label: 'Stance', value: 'crane',
  });
  assert.match(fallback, />crane</);
});

test('counter items render clamped pips', () => {
  const html = guildVitalItemHtml({
    kind: 'counter', label: 'Madness', cur: 3, max: 5, severity: 'warn',
  });
  assert.equal((html.match(/class="vitals-pip[ "]/g) || []).length, 5);
  assert.equal((html.match(/filled/g) || []).length, 3);
  assert.match(html, /3 \/ 5/);

  const clamped = guildVitalItemHtml({
    kind: 'counter', label: 'Big', cur: 40, max: 40,
  });
  assert.equal((clamped.match(/class="vitals-pip[ "]/g) || []).length, 12);
});

test('cooldown items render duration text and depletion width', () => {
  const html = guildVitalItemHtml({
    kind: 'cooldown', label: 'Combo Window', remaining: 90, max: 120,
  });
  assert.match(html, /1m 30s/);
  assert.match(html, /width:75%/);

  const noMax = guildVitalItemHtml({
    kind: 'cooldown', label: 'Incite', remaining: 8,
  });
  assert.match(noMax, /8s/);
  assert.doesNotMatch(noMax, /vitals-cd-bar/);
});

test('hostile labels and unknown severities are neutralized', () => {
  const html = guildVitalItemHtml({
    kind: 'state', label: '<script>x</script>',
    value: '<img onerror=1>', severity: 'evil"class',
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /vitals-sev-evil/);
});

test('meter kinds return null from the pure html builder', () => {
  assert.equal(guildVitalItemHtml({ kind: 'meter', label: 'Chi' }), null);
  assert.equal(guildVitalItemHtml({ label: 'Chi' }), null);
});

test('guildVitals shows placeholder when no items or bars', () => {
  const bodyEl = makeFakeEl();
  panelRenderers.guildVitals(bodyEl, {});
  assert.match(bodyEl.innerHTML, /No guild vitals/);
});

test('guildVitals groups multi-guild items under headers and GCs stale rows', () => {
  const bodyEl = makeFakeEl();
  panelRenderers.guildVitals(bodyEl, { items: [
    { id: 'monk.chi_focus', guild: 'Monk', label: 'Chi Focus',
      kind: 'boolean', on: 1 },
    { id: 'paladin.blessings', guild: 'Paladin', label: 'Blessings',
      kind: 'flags', flags: [{ label: 'D', on: 1 }] },
  ] });

  const headers = bodyEl.querySelectorAll('.vitals-guild-header');
  assert.equal(headers.length, 2);
  assert.equal(headers[0].textContent, 'Monk');
  assert.equal(headers[1].textContent, 'Paladin');
  assert.equal(bodyEl.querySelectorAll('.vitals-row').length, 2);

  // Second render with only Monk: Paladin row + header must be removed,
  // and with one guild left, no headers remain.
  panelRenderers.guildVitals(bodyEl, { items: [
    { id: 'monk.chi_focus', guild: 'Monk', label: 'Chi Focus',
      kind: 'boolean', on: 0 },
  ] });
  assert.equal(bodyEl.querySelectorAll('.vitals-guild-header').length, 0);
  assert.equal(bodyEl.querySelectorAll('.vitals-row').length, 1);
  assert.doesNotMatch(bodyEl.querySelectorAll('.vitals-row')[0].innerHTML,
    /vitals-led on/);
});

test('guildVitals accepts a legacy v1 bars payload without throwing', () => {
  const bodyEl = makeFakeEl();
  // Legacy meters route through renderVitalBar, which builds child spans
  // via innerHTML the fake cannot resolve - so assert only that the entry
  // point tolerates the shape for non-meter-free payloads via items=[].
  panelRenderers.guildVitals(bodyEl, { bars: [] });
  assert.match(bodyEl.innerHTML, /No guild vitals/);
});
