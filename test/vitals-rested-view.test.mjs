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
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

const { renderVitalBar, reserveVitalBarColor, restedVitalsView } =
  await import('../public/js/panel-renderers.js');

function makeClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
    replace(names) {
      values.clear();
      String(names).split(/\s+/).filter(Boolean).forEach((name) => values.add(name));
    },
    [Symbol.iterator]() { return values.values(); },
  };
}

function makeVitalRow() {
  const classList = makeClassList();
  const label = { textContent: '' };
  const value = { textContent: '' };
  const fill = { style: {} };
  const track = {
    attributes: {},
    setAttribute(name, val) { this.attributes[name] = String(val); },
  };
  const descendants = {
    '.vitals-label-name': label,
    '.vitals-val': value,
    '.vitals-bar': track,
    '.vitals-bar-fill': fill,
  };
  return {
    classList,
    label,
    value,
    track,
    fill,
    title: '',
    set className(names) { classList.replace(names); },
    get className() { return Array.from(classList).join(' '); },
    set innerHTML(_html) {},
    querySelector(selector) { return descendants[selector] || null; },
    removeAttribute(name) { if (name === 'title') this.title = ''; },
    remove() {},
  };
}

function makeVitalBody() {
  return {
    children: [],
    querySelector(selector) {
      if (!selector.startsWith('.')) return null;
      const className = selector.slice(1);
      return this.children.find((child) => child.classList.contains(className)) || null;
    },
    appendChild(child) { this.children.push(child); return child; },
  };
}

test('rested view is absent when the server does not advertise a bank', () => {
  assert.equal(restedVitalsView({ hp: 100, maxhp: 100 }), null);
  assert.equal(restedVitalsView({ rested: 0, rested_max: 0 }), null);
});

test('empty rested bank is explicit and neutral', () => {
  const view = restedVitalsView({
    rested: 0,
    rested_max: 5715,
    rested_bonus_pct: 100,
    rested_tier: 'road',
    rested_accrual_pct_per_hour: 1,
    rested_seconds_to_cap: 360000,
  });

  assert.equal(view.display, '0 / 5,715 \u00b7 Inactive');
  assert.match(view.title, /No rested combat XP bonus/);
  assert.match(view.title, /Last rest: Road/);
  assert.match(view.title, /Full after 4d 4h offline/);
  assert.equal(reserveVitalBarColor(0), '#6e7681');
});

test('active rested bank explains the bonus without trusting rested_pct', () => {
  const view = restedVitalsView({
    rested: 2400,
    rested_max: 5715,
    rested_pct: 99,
    rested_bonus_pct: 100,
    rested_tier: 'hearth',
    rested_accrual_pct_per_hour: 2,
    rested_seconds_to_cap: 104355,
  });

  assert.equal(view.current, 2400);
  assert.equal(view.maximum, 5715);
  assert.equal(view.display, '2,400 / 5,715 \u00b7 +100% active');
  assert.match(view.title, /Grants \+100% combat XP/);
  assert.match(view.title, /Last rest: Hearth/);
  assert.equal(view.ariaValueText,
    '2,400 of 5,715 rested XP. +100% active.');
});

test('full and legacy rested banks degrade cleanly', () => {
  const full = restedVitalsView({
    rested: 8000,
    rested_max: 5715,
    rested_bonus_pct: 100,
  });
  assert.equal(full.current, 5715);
  assert.equal(full.display, '5,715 / 5,715 \u00b7 Full');
  assert.match(full.title, /bank is full/);
  assert.equal(reserveVitalBarColor(100), '#79c0ff');

  const legacy = restedVitalsView({ rested: 500, rested_max: 1000 });
  assert.equal(legacy.display, '500 / 1,000 \u00b7 Active');
});

test('rested meter exposes numeric progress and readable state', () => {
  const body = makeVitalBody();
  globalThis.document.createElement = () => makeVitalRow();

  renderVitalBar(body, 'Rested XP', 2400, 5715, {
    id: 'rested-xp',
    display: '2,400 / 5,715 \u00b7 +100% active',
    ariaValueText: '2,400 of 5,715 rested XP. +100% active.',
    colorMode: 'reserve',
  });

  const row = body.querySelector('.vitals-rested-xp');
  assert.equal(row.track.attributes.role, 'progressbar');
  assert.equal(row.track.attributes['aria-label'], 'Rested XP');
  assert.equal(row.track.attributes['aria-valuemin'], '0');
  assert.equal(row.track.attributes['aria-valuemax'], '5715');
  assert.equal(row.track.attributes['aria-valuenow'], '2400');
  assert.equal(row.track.attributes['aria-valuetext'],
    '2,400 of 5,715 rested XP. +100% active.');
  assert.equal(row.fill.style.width, '42%');
  assert.equal(row.fill.style.backgroundColor, '#58a6ff');
});
