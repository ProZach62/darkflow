import test from 'node:test';
import assert from 'node:assert/strict';

const {
  anchorToStage,
  createSpriteLibrary,
  normalizeSpriteManifest,
  placeSpriteFrame,
  selectSpriteFrames,
} = await import('../public/js/combat-sprites.mjs');

function manifest(overrides = {}) {
  return {
    version: 1,
    kind: 'humanoid',
    image: '/assets/sprites/humanoid.png',
    frameWidth: 256,
    frameHeight: 256,
    unit: 64,
    anchor: { x: 128, y: 232 },
    facing: 'right',
    frames: {
      idle: { x: 0, y: 0, anchors: { head: { x: 128, y: 60, r: 20 }, hand: { x: 150, y: 150 } } },
      strike: { x: 256, y: 0 },
      windup: { x: 512, y: 0 },
      bogus: { x: 768, y: 0 },
    },
    ...overrides,
  };
}

test('manifest normalization keeps known poses and rejects unusable files', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  assert.ok(sheet);
  assert.deepEqual(Object.keys(sheet.frames).sort(), ['idle', 'strike', 'windup']);
  assert.equal(sheet.facing, 1);
  assert.equal(sheet.rigAligned, true);
  assert.deepEqual(sheet.frames.idle.anchors.head, { x: 128, y: 60, r: 20 });
  assert.equal(normalizeSpriteManifest(manifest({ version: 2 }), 'humanoid'), null, 'unknown version');
  assert.equal(normalizeSpriteManifest(manifest({ kind: 'beast' }), 'humanoid'), null, 'kind mismatch');
  assert.equal(normalizeSpriteManifest(manifest({ frames: { strike: { x: 0, y: 0 } } }), 'humanoid'), null, 'idle is required');
  assert.equal(normalizeSpriteManifest(manifest({ image: 'javascript:alert(1)' }), 'humanoid'), null, 'image must be a path or https URL');
  assert.equal(normalizeSpriteManifest(manifest({ unit: 0 }), 'humanoid'), null);
  assert.equal(normalizeSpriteManifest(null, 'humanoid'), null);
  assert.equal(normalizeSpriteManifest(manifest({ facing: 'left' }), 'humanoid').facing, -1);
});

test('frame selection crossfades between the two poses of a phase', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  assert.deepEqual(selectSpriteFrames(sheet, null).map((f) => [f.name, f.alpha]), [['idle', 1]]);
  const mid = selectSpriteFrames(sheet, { from: 'idle', to: 'strike', t: 0.4 }, 0.4);
  assert.deepEqual(mid.map((f) => [f.name, f.alpha]), [['idle', 1], ['strike', 0.4]]);
  assert.deepEqual(selectSpriteFrames(sheet, { from: 'idle', to: 'strike', t: 1 }, 1).map((f) => f.name), ['strike']);
  assert.deepEqual(selectSpriteFrames(sheet, { from: 'strike', to: 'strike', t: 1 }, 1).map((f) => f.name), ['strike']);
  const missing = selectSpriteFrames(sheet, { from: 'idle', to: 'chop', t: 0.5 }, 0.5);
  assert.deepEqual(missing.map((f) => f.name), ['idle'], 'a pose without a frame keeps the from pose');
});

test('placement lands the ground anchor on the hip and mirrors for left-facing figures', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  const right = placeSpriteFrame(sheet, 32, 1, 300, 400, 1);
  assert.equal(right.scale, 0.5);
  assert.equal(right.width, 128);
  assert.equal(right.height, 128);
  assert.equal(right.mirrored, false);
  assert.equal(right.x, 300 - 64);
  assert.equal(right.y, 400 - 116);
  const left = placeSpriteFrame(sheet, 32, 1, 300, 400, -1);
  assert.equal(left.mirrored, true);
  assert.equal(left.x + left.width - 64, 300, 'mirrored anchor still sits on the hip');
  const stretched = placeSpriteFrame(sheet, 32, 1, 300, 400, 1, 1.1);
  assert.ok(stretched.height > right.height && stretched.y < right.y, 'stretch grows upward from the ground');

  const headRight = anchorToStage(right, sheet.frames.idle.anchors.head);
  assert.equal(headRight.x, 300);
  assert.equal(headRight.y, right.y + 30);
  assert.equal(headRight.r, 10);
  const handRight = anchorToStage(right, sheet.frames.idle.anchors.hand);
  assert.equal(handRight.x, 300 + 11, 'right hand is ahead of the hip when facing right');
  const handLeft = anchorToStage(left, sheet.frames.idle.anchors.hand);
  assert.equal(handLeft.x, 300 - 11, 'mirrored hand is ahead of the hip when facing left');
});

test('the library loads a sheet once, caches failures, and reports readiness', async () => {
  const requested = [];
  const images = [];
  class FakeImage {
    set src(value) {
      this._src = value;
      images.push(this);
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  }
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith('humanoid.json')) return { ok: true, json: async () => manifest() };
    return { ok: false, json: async () => null };
  };
  const ready = [];
  const library = createSpriteLibrary({ fetch: fetchImpl, Image: FakeImage, onReady: (kind) => ready.push(kind) });
  assert.equal(library.get('humanoid'), null, 'not ready synchronously');
  assert.equal(library.status('humanoid'), 'loading');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const entry = library.get('humanoid');
  assert.ok(entry && entry.sheet && entry.image);
  assert.deepEqual(ready, ['humanoid']);
  library.get('humanoid');
  assert.equal(requested.filter((url) => url.endsWith('humanoid.json')).length, 1, 'one manifest request');

  assert.equal(library.get('beast'), null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(library.status('beast'), 'failed');
  library.get('beast');
  assert.equal(requested.filter((url) => url.endsWith('beast.json')).length, 1, 'failure is cached');
  assert.equal(library.load('dragon'), null, 'unknown kinds are refused');

  const offline = createSpriteLibrary({});
  assert.equal(offline.get('humanoid'), null);
  assert.equal(offline.status('humanoid'), 'unavailable');
});
