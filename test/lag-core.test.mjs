import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAG_THRESHOLDS,
  makeRing,
  makePingCorrelator,
  summarizeRtt,
  summarizeLocal,
  diagnose,
  chipStatus,
  sparklinePoints,
} from '../public/js/lag-core.mjs';

const NOW = 1_000_000;

function rttSamples(values, { spacing = 5000 } = {}) {
  return values.map((rtt, i) => ({ t: NOW - (values.length - 1 - i) * spacing, rtt }));
}

function baseInputs(overrides = {}) {
  return {
    connected: true,
    online: true,
    mud: { count: 10, lost: 0, lossPct: 0, median: 40, p90: 60, latest: 40 },
    http: { count: 5, lost: 0, lossPct: 0, median: 30, p90: 40, latest: 30 },
    server: {
      window_s: 60, hb_interval_ms: 2000, hb_drift_avg_ms: 5,
      hb_drift_max_ms: 40, hb_missed: 0, hb_processed_pct: 100,
    },
    serverSupported: true,
    serverPollMisses: 0,
    local: { driftP90: 10, longTaskMsPerMin: 0, count: 50 },
    wsStalled: false,
    reconnectsRecent: 0,
    bufferedBytes: 0,
    sameHost: true,
    ...overrides,
  };
}

// --- ring -------------------------------------------------------------

test('ring keeps only the newest capacity entries in order', () => {
  const ring = makeRing(3);
  for (let i = 1; i <= 5; i++) ring.push({ i });
  assert.deepEqual(ring.items().map((e) => e.i), [3, 4, 5]);
  assert.equal(ring.last().i, 5);
  ring.clear();
  assert.equal(ring.size(), 0);
  assert.equal(ring.last(), null);
});

// --- correlator -------------------------------------------------------

test('correlator measures rtt and refuses a second outstanding ping', () => {
  const c = makePingCorrelator({ timeoutMs: 4000 });
  assert.equal(c.onSend(100), true);
  assert.equal(c.onSend(200), false); // still outstanding
  assert.equal(c.onEcho(350), 250);
  assert.equal(c.isOutstanding(), false);
});

test('correlator times out a lost ping exactly once', () => {
  const c = makePingCorrelator({ timeoutMs: 4000 });
  c.onSend(100);
  assert.equal(c.checkTimeout(3000), false);
  assert.equal(c.checkTimeout(4100), true);
  assert.equal(c.checkTimeout(4200), false); // already counted
});

test('late echo after timeout does not match the next ping', () => {
  const c = makePingCorrelator({ timeoutMs: 4000 });
  c.onSend(100);
  assert.equal(c.checkTimeout(5000), true); // lost
  assert.equal(c.onEcho(5200), null);       // late echo ignored
  c.onSend(6000);
  assert.equal(c.onEcho(6100), 100);        // next ping unaffected
});

test('abort drops the outstanding ping without a loss', () => {
  const c = makePingCorrelator({ timeoutMs: 4000 });
  c.onSend(100);
  c.abort();
  assert.equal(c.checkTimeout(9999), false);
  assert.equal(c.onEcho(200), null);
});

// --- stats ------------------------------------------------------------

test('summarizeRtt needs minSamples and computes median/p90/loss', () => {
  assert.equal(summarizeRtt(rttSamples([50, 60]), NOW), null);
  const stats = summarizeRtt(rttSamples([10, 20, 30, 40, 1000, null, null, 50, 60, 70]), NOW);
  assert.equal(stats.count, 10);
  assert.equal(stats.lost, 2);
  assert.equal(stats.lossPct, 20);
  assert.ok(stats.median >= 30 && stats.median <= 60);
  assert.ok(stats.p90 >= stats.median);
});

test('summarizeRtt ignores samples outside the window and gap markers', () => {
  const stale = [{ t: NOW - 120000, rtt: 9999 }, { t: NOW - 90000, rtt: 9999 }];
  const fresh = rttSamples([40, 50, 60]).concat([{ t: NOW, gap: true }]);
  const stats = summarizeRtt(stale.concat(fresh), NOW);
  assert.equal(stats.count, 3);
  assert.ok(stats.median <= 60);
});

test('summarizeLocal excludes hidden-tab samples', () => {
  const samples = [
    { t: NOW - 3000, driftMs: 5, longTaskMs: 0 },
    { t: NOW - 2000, driftMs: 2000, longTaskMs: 900, hidden: true },
    { t: NOW - 1000, driftMs: 8, longTaskMs: 10 },
  ];
  const stats = summarizeLocal(samples, NOW);
  assert.equal(stats.count, 2);
  assert.ok(stats.driftP90 <= 8);
  assert.equal(stats.longTaskMsPerMin, 10);
});

// --- diagnosis matrix --------------------------------------------------

test('all healthy -> ok verdict', () => {
  const d = diagnose(baseInputs());
  assert.equal(d.network.status, 'ok');
  assert.equal(d.server.status, 'ok');
  assert.equal(d.local.status, 'ok');
  assert.equal(d.verdict, 'ok');
});

test('network warn and bad boundaries', () => {
  let d = diagnose(baseInputs({ mud: { ...baseInputs().mud, median: LAG_THRESHOLDS.rttOkMs + 1 } }));
  assert.equal(d.network.status, 'warn');
  d = diagnose(baseInputs({
    mud: { ...baseInputs().mud, median: LAG_THRESHOLDS.rttWarnMs + 1 },
    http: { ...baseInputs().http, median: LAG_THRESHOLDS.rttWarnMs + 50 },
  }));
  assert.equal(d.network.status, 'bad');
  assert.equal(d.verdict, 'network');
});

test('loss alone can fail the network axis', () => {
  const d = diagnose(baseInputs({
    mud: { ...baseInputs().mud, lossPct: LAG_THRESHOLDS.lossWarnPct + 5 },
    http: { ...baseInputs().http, median: 500 },
  }));
  assert.equal(d.network.status, 'bad');
});

test('cross-rule: slow game path + fast web path + server drift -> blame server', () => {
  const d = diagnose(baseInputs({
    mud: { ...baseInputs().mud, median: 600 },
    http: { ...baseInputs().http, median: 30 },
    server: { ...baseInputs().server, hb_drift_avg_ms: 400, hb_drift_max_ms: 2500 },
  }));
  assert.equal(d.verdict, 'server');
  assert.equal(d.network.status, 'warn'); // downgraded by cross-rule
});

test('cross-rule: slow game path + slow web path -> blame network', () => {
  const d = diagnose(baseInputs({
    mud: { ...baseInputs().mud, median: 600 },
    http: { ...baseInputs().http, median: 700 },
  }));
  assert.equal(d.verdict, 'network');
  assert.match(d.network.reasons.join(' '), /path between you and the server/);
});

test('cross-rule: slow game path + fast web + healthy server -> queueing warn', () => {
  const d = diagnose(baseInputs({
    mud: { ...baseInputs().mud, median: 600 },
    http: { ...baseInputs().http, median: 30 },
  }));
  assert.equal(d.network.status, 'warn');
  assert.match(d.network.reasons.join(' '), /queueing/);
});

test('server axis: drift thresholds and warm-up', () => {
  let d = diagnose(baseInputs({ server: { ...baseInputs().server, hb_drift_avg_ms: LAG_THRESHOLDS.driftAvgOkMs + 1 } }));
  assert.equal(d.server.status, 'warn');
  d = diagnose(baseInputs({ server: { ...baseInputs().server, hb_missed: 1 } }));
  assert.equal(d.server.status, 'bad');
  assert.equal(d.verdict, 'server');
  d = diagnose(baseInputs({ server: { ...baseInputs().server, window_s: 5 } }));
  assert.equal(d.server.status, 'unknown'); // warming up, never reads ok
});

test('server axis: unanswered health polls while pings flow -> bad', () => {
  const d = diagnose(baseInputs({ server: null, serverPollMisses: 2 }));
  assert.equal(d.server.status, 'bad');
});

test('unsupported server reads unknown, not ok', () => {
  const d = diagnose(baseInputs({ serverSupported: false, server: null }));
  assert.equal(d.server.status, 'unknown');
  assert.equal(d.verdict, 'ok');
});

test('local axis: offline, stall, reconnects, jank', () => {
  assert.equal(diagnose(baseInputs({ online: false })).verdict, 'local');
  assert.equal(diagnose(baseInputs({ wsStalled: true })).verdict, 'local');
  assert.equal(diagnose(baseInputs({ reconnectsRecent: 1 })).verdict, 'local');
  const jank = diagnose(baseInputs({ local: { driftP90: 600, longTaskMsPerMin: 0, count: 30 } }));
  assert.equal(jank.verdict, 'local');
  const mild = diagnose(baseInputs({ local: { driftP90: 200, longTaskMsPerMin: 0, count: 30 } }));
  assert.equal(mild.local.status, 'warn');
});

test('local bad outranks network bad in the verdict', () => {
  const d = diagnose(baseInputs({
    online: false,
    mud: { ...baseInputs().mud, median: 900 },
    http: { ...baseInputs().http, median: 900 },
  }));
  assert.equal(d.verdict, 'local');
});

test('disconnected verdict wins over everything', () => {
  const d = diagnose(baseInputs({ connected: false, online: false }));
  assert.equal(d.verdict, 'disconnected');
});

test('no samples while connected -> collecting verdict', () => {
  const d = diagnose(baseInputs({ mud: null, http: null, server: null, local: null }));
  assert.equal(d.verdict, 'unknown');
});

// --- chip ---------------------------------------------------------------

test('chip status follows rtt and verdict', () => {
  assert.equal(chipStatus(null, 'ok'), 'off');
  assert.equal(chipStatus(50, 'disconnected'), 'off');
  assert.equal(chipStatus(50, 'ok'), 'ok');
  assert.equal(chipStatus(LAG_THRESHOLDS.rttOkMs + 1, 'ok'), 'warn');
  assert.equal(chipStatus(LAG_THRESHOLDS.rttWarnMs + 1, 'ok'), 'bad');
  assert.equal(chipStatus(50, 'server'), 'bad');
});

// --- sparkline ------------------------------------------------------------

test('sparkline splits segments at gaps and lost samples and scales', () => {
  const samples = [
    { t: NOW - 50000, rtt: 50 },
    { t: NOW - 45000, rtt: 80 },
    { t: NOW - 40000, gap: true },
    { t: NOW - 30000, rtt: 120 },
    { t: NOW - 25000, rtt: null }, // lost
    { t: NOW - 20000, rtt: 400 },
  ];
  const { segments, maxRtt } = sparklinePoints(samples, NOW, { width: 100, height: 40 });
  assert.equal(segments.length, 3);
  assert.equal(maxRtt, 400);
  for (const seg of segments) {
    for (const p of seg) {
      assert.ok(p.x >= 0 && p.x <= 100);
      assert.ok(p.y >= 0 && p.y <= 40);
    }
  }
});
