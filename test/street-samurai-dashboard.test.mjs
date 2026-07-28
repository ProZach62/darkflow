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
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const {
  clampPercent,
  dashboardSeverity,
  normalizeStreetSamuraiState,
  STREET_SAMURAI_PACKAGE,
  worstAlertSeverity,
} = await import('../public/js/street-samurai-dashboard.js');
const { DISPLAY_TYPES } = await import('../public/js/window-types.js');

function dashboardFixture(overrides = {}) {
  return normalizeStreetSamuraiState({
    protocol_version: 1,
    cortex_version: '3.1',
    firmware_version: 'Ronin-sama',
    grade: 'ghost',
    active: true,
    guild_level: 16,
    guild_level_max: 16,
    cortex_rank: 42,
    cortex_rank_max: 200,
    guild_xp: 1930,
    guild_xp_needed: 7000,
    cortex_effect: '105%',
    edge: 5,
    edge_max: 10,
    heat: 2,
    heat_max: 10,
    heat_band: 'Clean',
    biological: { current: 920, max: 1000, percent: 92 },
    strain: {
      used: 32,
      total: 36,
      free: 4,
      percent: 89,
      breakdown: { base: 20, level: 10, total: 36 },
    },
    target_locks: [{ name: 'Test target', remaining: 21 }],
    alerts: [{
      severity: 'warning',
      marker: '!',
      code: 'strain_high',
      message: 'Strain is high.',
    }],
    monitor_flags: { OC: 1, OD: 0 },
    active_firmware: ['Overclock'],
    processes: [{
      id: 'cortex_os',
      name: 'Cortex OS',
      grade: 'ghost',
      family: 'neural',
      load: 4,
      durability: 170,
      integrity: 100,
      fragmentation: 6,
      effectiveness: 100,
      patches: [],
      vulnerabilities: [],
      faults: [],
      state: 'RONIN KERNEL',
      state_severity: 'healthy',
    }],
    ...overrides,
  });
}

test('Street Samurai dashboard is an advertised custom window node', () => {
  assert.equal(STREET_SAMURAI_PACKAGE, 'Darkwind.StreetSamurai');
  assert.equal(DISPLAY_TYPES.has('street_samurai_dashboard'), true);
});

test('dashboard payload normalization preserves live game state', () => {
  const state = dashboardFixture();

  assert.equal(state.cortexVersion, '3.1');
  assert.equal(state.firmwareVersion, 'Ronin-sama');
  assert.equal(state.guildLevel, 16);
  assert.equal(state.strain.free, 4);
  assert.equal(state.targetLocks[0].name, 'Test target');
  assert.equal(state.monitorFlags.OC, true);
  assert.equal(state.monitorFlags.OD, false);
  assert.equal(state.processes[0].id, 'cortex_os');
  assert.equal(state.processes[0].state, 'RONIN KERNEL');
  assert.equal(state.processes[0].durability, 170);
  assert.equal(state.alerts[0].code, 'strain_high');
});

test('normalization clamps percentages and tolerates malformed collections', () => {
  const state = normalizeStreetSamuraiState({
    heat_percent: 140,
    biological: { percent: -12 },
    strain: { used: 5, total: 0, percent: 'not-a-number' },
    processes: 'not-an-array',
    alerts: null,
    monitor_flags: [],
  });

  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent(-1), 0);
  assert.equal(state.heatPercent, 100);
  assert.equal(state.biological.percent, 0);
  assert.equal(state.strain.percent, 0);
  assert.deepEqual(state.processes, []);
  assert.deepEqual(state.alerts, []);
  assert.deepEqual(state.monitorFlags, {});
});

test('dashboard severity follows the server-facing health thresholds', () => {
  const healthy = dashboardFixture();
  assert.equal(dashboardSeverity('biological', healthy), 'healthy');
  assert.equal(dashboardSeverity('thermal', healthy), 'healthy');
  assert.equal(dashboardSeverity('strain', healthy), 'warning');

  const critical = dashboardFixture({
    thermal_lockout: true,
    biological: { current: 20, max: 100, percent: 20 },
    strain: { used: 40, total: 36, percent: 100 },
  });
  assert.equal(dashboardSeverity('biological', critical), 'danger');
  assert.equal(dashboardSeverity('thermal', critical), 'danger');
  assert.equal(dashboardSeverity('strain', critical), 'danger');
});

test('alert rail uses the highest active severity', () => {
  assert.equal(worstAlertSeverity([]), 'healthy');
  assert.equal(worstAlertSeverity([{ severity: 'warning' }]), 'warning');
  assert.equal(worstAlertSeverity([
    { severity: 'warning' },
    { severity: 'danger' },
  ]), 'danger');
});
