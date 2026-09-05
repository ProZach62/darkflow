// Sprite sheets for the combat stage figures.
//
// A sheet replaces the procedural body of one figure kind (humanoid, beast)
// with one image frame per pose name from combat-rig-core.mjs. Weapons,
// shield, helmet, and the portrait head keep drawing on top, so equipment
// and identity still work with any art. See docs/combat-sprites.md for the
// manifest format an artist authors against.
//
// The pure parts (manifest normalization, frame selection, placement math)
// live here so they can be tested without a canvas; the loader takes fetch
// and Image constructors as parameters for the same reason.

import { POSES } from './combat-rig-core.mjs';

export const SPRITE_MANIFEST_VERSION = 1;
export const SPRITE_KINDS = Object.freeze(['humanoid', 'beast']);

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function point(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = { x, y };
  if (Number.isFinite(Number(value.r))) out.r = Number(value.r);
  return out;
}

// Validates a manifest object. Returns null when it cannot be used; every
// frame must name a known pose and sit inside the image grid so a bad file
// degrades to the procedural body instead of drawing garbage.
export function normalizeSpriteManifest(raw, kind) {
  if (!raw || typeof raw !== 'object') return null;
  if (finite(raw.version, 0) !== SPRITE_MANIFEST_VERSION) return null;
  if (kind && raw.kind && raw.kind !== kind) return null;
  const frameWidth = finite(raw.frameWidth, 0);
  const frameHeight = finite(raw.frameHeight, 0);
  const unit = finite(raw.unit, 0);
  const anchor = point(raw.anchor);
  const image = typeof raw.image === 'string' ? raw.image.trim() : '';
  if (frameWidth <= 0 || frameHeight <= 0 || unit <= 0 || !anchor || !image) return null;
  if (!/^(\/|https:\/\/)/.test(image)) return null;
  const frames = {};
  const source = raw.frames && typeof raw.frames === 'object' ? raw.frames : {};
  for (const name of Object.keys(source)) {
    if (!(name in POSES)) continue;
    const frame = source[name];
    if (!frame || typeof frame !== 'object') continue;
    const x = finite(frame.x, -1);
    const y = finite(frame.y, -1);
    if (x < 0 || y < 0) continue;
    const anchors = {};
    if (frame.anchors && typeof frame.anchors === 'object') {
      for (const key of ['head', 'neck', 'hand', 'offHand', 'cloak']) {
        const p = point(frame.anchors[key]);
        if (p) anchors[key] = p;
      }
    }
    frames[name] = { x, y, anchors };
  }
  if (!frames.idle) return null;
  return {
    version: SPRITE_MANIFEST_VERSION,
    kind: raw.kind || kind || 'humanoid',
    image,
    frameWidth,
    frameHeight,
    unit,
    anchor,
    facing: raw.facing === 'left' ? -1 : 1,
    rigAligned: raw.rigAligned !== false,
    frames,
  };
}

// Which frames to draw for a pose phase, with alphas. Sparse sheets carry
// one frame per pose, so a blend is a short crossfade between the two.
export function selectSpriteFrames(sheet, phase, easedT) {
  const idle = sheet.frames.idle;
  if (!phase) return [{ frame: idle, name: 'idle', alpha: 1 }];
  // A pose the sheet lacks falls back to the other pose of the blend, and
  // finally to idle; the reported name is the frame actually drawn.
  const fromName = sheet.frames[phase.from] ? phase.from : 'idle';
  const from = sheet.frames[fromName];
  const toName = sheet.frames[phase.to] ? phase.to : fromName;
  const to = sheet.frames[toName];
  const t = Math.max(0, Math.min(1, Number.isFinite(easedT) ? easedT : phase.t));
  if (from === to || t >= 1) return [{ frame: to, name: toName, alpha: 1 }];
  if (t <= 0) return [{ frame: from, name: fromName, alpha: 1 }];
  return [
    { frame: from, name: fromName, alpha: 1 },
    { frame: to, name: toName, alpha: t },
  ];
}

// Destination rectangle for a frame so its ground anchor lands on
// (hipX, groundY) at the figure's scale, mirrored for left-facing figures.
// `stretch` scales vertically about the ground line.
export function placeSpriteFrame(sheet, unit, scale, hipX, groundY, facing, stretch = 1) {
  const s = (unit * scale) / sheet.unit;
  const width = sheet.frameWidth * s;
  const height = sheet.frameHeight * s * stretch;
  const anchorX = sheet.anchor.x * s;
  const anchorY = sheet.anchor.y * s * stretch;
  const mirrored = facing !== sheet.facing;
  return {
    scale: s,
    width,
    height,
    mirrored,
    // Top-left in stage space when not mirrored; when mirrored the caller
    // flips around hipX, so the left edge is measured from the flipped side.
    x: mirrored ? hipX - (width - anchorX) : hipX - anchorX,
    y: groundY - anchorY,
  };
}

// Converts a frame-space anchor (pixels inside one frame, unmirrored) into
// stage space using a placement from placeSpriteFrame().
export function anchorToStage(placement, anchor) {
  const localX = anchor.x * placement.scale;
  const localY = anchor.y * placement.scale;
  const out = {
    x: placement.mirrored
      ? placement.x + placement.width - localX
      : placement.x + localX,
    y: placement.y + localY,
  };
  if (Number.isFinite(anchor.r)) out.r = anchor.r * placement.scale;
  return out;
}

// Loads manifests and images on demand. One entry per kind; failures are
// cached so a missing sheet costs one request, not one per frame.
export function createSpriteLibrary(options = {}) {
  const fetchImpl = options.fetch || null;
  const ImageCtor = options.Image || null;
  const basePath = options.basePath || '/assets/sprites/';
  const onReady = typeof options.onReady === 'function' ? options.onReady : () => {};
  const entries = new Map();

  function load(kind) {
    if (!SPRITE_KINDS.includes(kind)) return null;
    if (entries.has(kind)) return entries.get(kind);
    const entry = { kind, status: 'loading', sheet: null, image: null };
    entries.set(kind, entry);
    if (!fetchImpl || !ImageCtor) {
      entry.status = 'unavailable';
      return entry;
    }
    let request;
    try {
      request = fetchImpl(basePath + kind + '.json', { cache: 'force-cache' });
    } catch (error) {
      entry.status = 'failed';
      return entry;
    }
    Promise.resolve(request)
      .then((response) => (response && response.ok ? response.json() : null))
      .then((json) => {
        const sheet = normalizeSpriteManifest(json, kind);
        if (!sheet) {
          entry.status = 'failed';
          return;
        }
        entry.sheet = sheet;
        const image = new ImageCtor();
        image.decoding = 'async';
        image.onload = () => {
          entry.image = image;
          entry.status = 'ready';
          onReady(kind);
        };
        image.onerror = () => {
          entry.status = 'failed';
        };
        image.src = sheet.image;
      })
      .catch(() => {
        entry.status = 'failed';
      });
    return entry;
  }

  return {
    load,
    get(kind) {
      const entry = load(kind);
      return entry && entry.status === 'ready' ? entry : null;
    },
    status(kind) {
      const entry = entries.get(kind);
      return entry ? entry.status : 'unloaded';
    },
    clear() {
      entries.clear();
    },
  };
}
