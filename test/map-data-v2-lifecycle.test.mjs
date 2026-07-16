import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser surface required by the real MapData2 and GMCP modules.
const noop = () => {};
globalThis.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
};
globalThis.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener: noop,
  removeEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {},
    classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop,
    addEventListener: noop,
    setAttribute: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: noop,
  }),
  body: {},
  documentElement: {},
};
globalThis.window = globalThis;
globalThis.WebSocket = class WebSocket { addEventListener() {} send() {} close() {} };
globalThis.Audio = class Audio { play() { return Promise.resolve(); } addEventListener() {} };
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

const v2 = await import('../public/js/map-data-v2.js');
const { gmcp } = await import('../public/js/gmcp.js');

const EPOCH = 'lifecycle-epoch';
let sent = [];

gmcp.send = (name, data) => {
  sent.push({ name, data });
  return true;
};

beforeEach(() => {
  v2.clearMapData();
  sent = [];
});

function makeRoom(area, suffix, x = 0) {
  return {
    id: `${area}:${suffix}`,
    name: suffix,
    area,
    positioned: true,
    x,
    y: 0,
    z: 0,
    exits: {},
  };
}

function processCurrent(area, overrides = {}) {
  return v2.processCurrent({
    protocol: 2,
    mapEpoch: EPOCH,
    areaGeneration: 1,
    areaVersion: 8,
    area,
    ...makeRoom(area, 'current'),
    ...overrides,
  });
}

function onlyAreaSync(area) {
  const matches = sent.filter(({ name, data }) =>
    name === 'Darkwind.MapData2.Sync' && data.area === area && data.current !== 1);
  assert.equal(matches.length, 1, `expected exactly one area Sync for ${area}`);
  return matches[0].data;
}

function updateFor(request, overrides = {}) {
  const fromCursor = overrides.fromCursor === undefined ? 0 : overrides.fromCursor;
  return {
    protocol: 2,
    mapEpoch: EPOCH,
    area: request.area,
    areaGeneration: request.generation || 1,
    since: request.since || 0,
    snapshotVersion: request.snapshotVersion || 8,
    latestVersion: 8,
    syncId: request.syncId,
    fromCursor,
    cursor: overrides.cursor === undefined ? fromCursor : overrides.cursor,
    complete: 1,
    replace: (request.since || 0) === 0,
    rooms: [],
    ...overrides,
  };
}

test('v2 Current creates one correlated transfer and retires legacy Update packets', () => {
  const area = 'Lifecycle Current';
  processCurrent(area);

  const request = onlyAreaSync(area);
  assert.equal(request.protocol, 2);
  assert.equal(request.since, 0);
  assert.equal(request.cursor, 0);
  assert.equal(request.fromCursor, 0);
  assert.equal(typeof request.syncId, 'string');
  assert.ok(request.syncId.length > 0, 'transfer has a correlation id');

  const before = sent.length;
  const merged = v2.mergeServerUpdate({
    area,
    version: 8,
    since: 0,
    offset: 50,
    more: 1,
    replace: 1,
    rooms: [makeRoom(area, 'legacy')],
  });

  assert.equal(merged, 0, 'protocol-less legacy packet is ignored after v2 Current');
  assert.equal(v2.getRoom(`${area}:legacy`), undefined);
  assert.equal(sent.length, before, 'legacy pagination cannot start a second transfer');
});

test('area reset preserves last-good context and starts only one full transfer', () => {
  const area = 'Lifecycle Reset';
  const current = makeRoom(area, 'current');
  const neighbor = makeRoom(area, 'neighbor', 1);

  v2.mergeServerAreaData({
    area,
    version: 8,
    replace: true,
    rooms: [current, neighbor],
  });
  processCurrent(area);
  sent = [];

  v2.clearMapDataForArea(area, {
    protocol: 2,
    scope: 'area',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 2,
  });

  assert.equal(v2.getCurrentRoomId(), current.id, 'reset preserves current-room context');
  assert.ok(v2.getRoom(current.id), 'current room remains visible');
  assert.ok(v2.getRoom(neighbor.id), 'last-good area remains visible during replacement');

  const request = onlyAreaSync(area);
  assert.equal(request.protocol, 2);
  assert.equal(request.since, 0);
  assert.ok(request.syncId);

  processCurrent(area, { areaGeneration: 2, areaVersion: 9 });
  assert.equal(
    sent.filter(({ name, data }) => name === 'Darkwind.MapData2.Sync'
      && data.area === area && data.current !== 1).length,
    1,
    'the Current following Reset reuses the active transfer',
  );
});

test('stale transfer ids, duplicate pages, and wrong fromCursor values are ignored', () => {
  const area = 'Lifecycle Ordering';
  processCurrent(area);
  const request = onlyAreaSync(area);

  v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 0,
    cursor: 'page-a',
    complete: 0,
    rooms: [makeRoom(area, 'new-a', 1)],
  }));
  const continuation = sent.at(-1).data;
  assert.equal(continuation.syncId, request.syncId);
  assert.equal(continuation.cursor, 'page-a');

  const sentBeforeInvalid = sent.length;
  v2.processSyncError({
    protocol: 2,
    code: 'generation_changed',
    restart: 1,
    area,
    mapEpoch: EPOCH,
    areaGeneration: 2,
    syncId: request.syncId,
    fromCursor: 0,
  });
  assert.equal(v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 'wrong-cursor',
    cursor: 'bad-end',
    rooms: [makeRoom(area, 'wrong-cursor')],
  })), 0);
  assert.equal(v2.mergeServerUpdate(updateFor(request, {
    syncId: `${request.syncId}-stale`,
    fromCursor: 'page-a',
    cursor: 'stale-end',
    rooms: [makeRoom(area, 'stale')],
  })), 0);
  assert.equal(sent.length, sentBeforeInvalid,
    'stale errors and invalid pages cannot mutate the active cursor');

  v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 'page-a',
    cursor: 'page-b',
    rooms: [makeRoom(area, 'new-b', 2)],
  }));
  assert.ok(v2.getRoom(`${area}:new-a`));
  assert.ok(v2.getRoom(`${area}:new-b`));

  assert.equal(v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 'page-a',
    cursor: 'duplicate-end',
    rooms: [makeRoom(area, 'duplicate')],
  })), 0, 'completed transfer rejects a duplicate final page');
  assert.equal(v2.getRoom(`${area}:duplicate`), undefined);
  assert.equal(v2.getRoom(`${area}:wrong-cursor`), undefined);
  assert.equal(v2.getRoom(`${area}:stale`), undefined);
});

test('rate limiting retains the stage and retries the same transfer cursor', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Rate Limit';
  processCurrent(area);
  const request = onlyAreaSync(area);

  v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 0,
    cursor: 'rate-page-a',
    complete: 0,
    rooms: [makeRoom(area, 'new-a', 1)],
  }));
  const continuation = sent.at(-1).data;
  sent = [];

  v2.processSyncError({
    protocol: 2,
    code: 'rate_limited',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 1,
    syncId: request.syncId,
    fromCursor: 'rate-page-a',
    cursor: 'rate-page-a',
    retryAfterMs: 1000,
  });
  assert.equal(sent.length, 0, 'rate-limit retry is paced');

  t.mock.timers.tick(1000);
  const retry = onlyAreaSync(area);
  assert.equal(retry.syncId, request.syncId, 'retry stays in the same transfer');
  assert.equal(retry.cursor, continuation.cursor, 'retry resumes at the rejected cursor');
  assert.equal(retry.fromCursor, continuation.fromCursor);

  v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 'rate-page-a',
    cursor: 'rate-page-b',
    rooms: [makeRoom(area, 'new-b', 2)],
  }));
  assert.ok(v2.getRoom(`${area}:new-a`), 'pre-rate-limit page was retained');
  assert.ok(v2.getRoom(`${area}:new-b`));
});

test('area reflow retains the public snapshot and retries the same transfer cursor', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Area Reflow';
  const current = makeRoom(area, 'current');
  const lastGood = makeRoom(area, 'last-good', 1);
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current, lastGood] });
  processCurrent(area);
  sent = [];

  v2.requestAreaSync(area, true);
  const request = onlyAreaSync(area);
  v2.mergeServerUpdate(updateFor(request, {
    fromCursor: 0,
    cursor: 'reflow-page-a',
    complete: 0,
    rooms: [makeRoom(area, 'staged-only', 2)],
  }));
  const continuation = sent.at(-1).data;
  sent = [];

  v2.processSyncError({
    protocol: 2,
    code: 'area_reflow',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 1,
    syncId: request.syncId,
    fromCursor: 'reflow-page-a',
    retryAfterMs: 100,
  });

  assert.ok(v2.getRoom(current.id), 'current room remains publicly visible');
  assert.ok(v2.getRoom(lastGood.id), 'last-good area snapshot remains visible');
  assert.equal(v2.getRoom(`${area}:staged-only`), undefined,
    'an incomplete replacement never leaks into the public map');
  assert.equal(sent.length, 0, 'reflow retry is paced');

  t.mock.timers.tick(100);
  const retry = onlyAreaSync(area);
  assert.equal(retry.syncId, request.syncId);
  assert.equal(retry.cursor, continuation.cursor);
  assert.equal(retry.fromCursor, continuation.fromCursor);
});

test('grid reflow keeps Current visible and uses a bounded paced retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Grid Reflow';
  const current = makeRoom(area, 'current');
  const lastGood = makeRoom(area, 'last-good', 1);
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current, lastGood] });
  processCurrent(area);
  sent = [];

  const unavailable = {
    protocol: 2,
    code: 'current_unavailable',
    reason: 'grid_reflow',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 1,
    retryAfterMs: 100,
  };
  v2.processSyncError(unavailable);

  assert.equal(v2.hasLiveCurrent(), false, 'stale Current cannot drive movement');
  assert.equal(v2.getCurrentRoomId(), current.id, 'last Current remains the presentation center');
  assert.ok(v2.getRoom(lastGood.id), 'last-good map remains intact');
  assert.match(v2.getMapStatus(), /Repositioning authoritative map/);

  const expectedDelays = [100, 200, 400, 800, 1600, 2000, 2000, 2000];
  for (let i = 0; i < expectedDelays.length; i++) {
    t.mock.timers.tick(expectedDelays[i]);
    const retries = sent.filter(({ name, data }) =>
      name === 'Darkwind.MapData2.Sync' && data.current === 1);
    assert.equal(retries.length, i + 1, `Current retry ${i + 1} was paced`);
    v2.processSyncError(unavailable);
  }

  const sentAtLimit = sent.length;
  t.mock.timers.tick(10000);
  assert.equal(sent.length, sentAtLimit, 'transient Current retries stop at the bound');
});

test('fresh Current cancels a pending grid-reflow retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Grid Recovery';
  const current = makeRoom(area, 'current');
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current] });
  processCurrent(area);
  sent = [];

  v2.processSyncError({
    protocol: 2,
    code: 'current_unavailable',
    reason: 'grid_reflow',
    area,
    mapEpoch: EPOCH,
    retryAfterMs: 100,
  });
  processCurrent(area);
  sent = [];

  t.mock.timers.tick(1000);
  assert.equal(sent.filter(({ data }) => data.current === 1).length, 0,
    'fresh Current retires the transient recovery timer');
  assert.equal(v2.hasLiveCurrent(), true);
});

test('area Reset replaces a pending grid retry with one Current recovery request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Grid Reset';
  const current = makeRoom(area, 'current');
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current] });
  processCurrent(area);
  sent = [];

  v2.processSyncError({
    protocol: 2,
    code: 'current_unavailable',
    reason: 'grid_reflow',
    area,
    mapEpoch: EPOCH,
    retryAfterMs: 100,
  });
  v2.clearMapDataForArea(area, {
    protocol: 2,
    scope: 'area',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 2,
  });

  const currentRequests = () => sent.filter(({ name, data }) =>
    name === 'Darkwind.MapData2.Sync' && data.current === 1);
  assert.equal(currentRequests().length, 1,
    'Reset asks for Current immediately after retiring the transient timer');
  t.mock.timers.tick(1000);
  assert.equal(currentRequests().length, 1,
    'the retired grid-reflow timer cannot issue a duplicate request');
});

test('connection reset cancels a pending grid-reflow retry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const area = 'Lifecycle Grid Disconnect';
  const current = makeRoom(area, 'current');
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current] });
  processCurrent(area);
  sent = [];

  v2.processSyncError({
    protocol: 2,
    code: 'current_unavailable',
    reason: 'grid_reflow',
    area,
    mapEpoch: EPOCH,
    retryAfterMs: 100,
  });
  v2.resetForConnection();
  t.mock.timers.tick(1000);

  assert.equal(sent.filter(({ data }) => data.current === 1).length, 0,
    'a disconnected socket never receives a stale retry');
});

test('a late page from an abandoned transfer cannot commit a suffix snapshot', () => {
  const area = 'Lifecycle Late Page';
  const current = makeRoom(area, 'current');
  const lastGood = makeRoom(area, 'last-good', 1);
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [current, lastGood] });
  processCurrent(area);
  sent = [];

  v2.requestAreaSync(area, true);
  const abandoned = onlyAreaSync(area);
  v2.mergeServerUpdate(updateFor(abandoned, {
    fromCursor: 0,
    cursor: 'old-page-a',
    complete: 0,
    rooms: [makeRoom(area, 'old-new-a', 2)],
  }));

  v2.processSyncError({
    protocol: 2,
    code: 'generation_changed',
    restart: 1,
    area,
    mapEpoch: EPOCH,
    areaGeneration: 2,
    syncId: abandoned.syncId,
    fromCursor: 'old-page-a',
    cursor: 'old-page-a',
  });
  const replacement = sent.at(-1).data;
  assert.notEqual(replacement.syncId, abandoned.syncId, 'restart creates a new transfer');

  assert.equal(v2.mergeServerUpdate(updateFor(abandoned, {
    areaGeneration: 1,
    fromCursor: 'old-page-a',
    cursor: 'old-page-b',
    rooms: [makeRoom(area, 'old-new-b', 3)],
  })), 0);
  assert.ok(v2.getRoom(lastGood.id), 'last-good snapshot remains intact');
  assert.equal(v2.getRoom(`${area}:old-new-a`), undefined);
  assert.equal(v2.getRoom(`${area}:old-new-b`), undefined,
    'late suffix from the abandoned transfer was not committed');
});

test('missing-Current recovery is a deduplicated context-only request', () => {
  const area = 'Lifecycle Context';
  v2.clearMapDataForArea(area, {
    protocol: 2,
    scope: 'area',
    area,
    mapEpoch: EPOCH,
    areaGeneration: 1,
  });

  const recoveries = sent.filter(({ name, data }) =>
    name === 'Darkwind.MapData2.Sync' && data.current === 1);
  assert.deepEqual(recoveries, [{
    name: 'Darkwind.MapData2.Sync',
    data: { protocol: 2, current: 1, mapEpoch: EPOCH },
  }]);

  const sentAfterAutomaticRecovery = sent.length;
  v2.requestCurrentState();
  v2.requestCurrentState();
  assert.equal(sent.length, sentAfterAutomaticRecovery,
    'explicit recovery calls do not duplicate the automatic request');

  processCurrent(area);
  v2.requestCurrentState();
  assert.equal(sent.filter(({ data }) => data.current === 1).length, 1,
    'valid Current clears recovery state and suppresses unnecessary requests');
});

test('retained reconnect context is visible but cannot send stale movement', () => {
  const area = 'Lifecycle Reconnect';
  const neighbor = makeRoom(area, 'neighbor', 1);
  v2.mergeServerAreaData({ area, version: 8, replace: true, rooms: [neighbor] });
  processCurrent(area, {
    exits: { east: neighbor.id },
    liveExits: { east: neighbor.id },
    walkSafe: { east: 1 },
  });

  assert.equal(v2.canWalkExit(v2.getRoom(`${area}:current`), 'east', neighbor.id), true);
  v2.resetForConnection();
  assert.equal(v2.getCurrentRoomId(), `${area}:current`, 'last-good context stays visible');
  assert.equal(v2.canWalkExit(v2.getRoom(`${area}:current`), 'east', neighbor.id), false,
    'stale connection context is presentation-only');

  processCurrent(area, {
    exits: { east: neighbor.id },
    liveExits: { east: neighbor.id },
    walkSafe: { east: 1 },
  });
  assert.equal(v2.canWalkExit(v2.getRoom(`${area}:current`), 'east', neighbor.id), true,
    'fresh Current re-enables verified movement');
});
