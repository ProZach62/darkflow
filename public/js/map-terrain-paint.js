// Draws a planned terrain scene (map-terrain-core.js) onto the map's terrain
// canvas. Each terrain is a region: the rooms' boxes grown into the gaps,
// rounded, feathered, and filled with that terrain's texture. Water is laid
// over a band of beach, and roads are stroked last. Textures are anchored to
// world coordinates, so the land holds still as the view moves over it.
import {
  PAINTED_TEXTURE_INDEX,
  TERRAIN_PITCH,
  TERRAIN_TILE,
  terrainPlanKey,
  terrainTextureFor,
} from './map-terrain-core.js';

// The painted textures' index, fetched once for the page and shared by every
// painter; null until it arrives, or if there is none.
let paintedIndex = null;
let paintedIndexRequest = null;
const paintedIndexListeners = new Set();

function requestPaintedIndex() {
  if (paintedIndexRequest || typeof fetch !== 'function') return;
  paintedIndexRequest = fetch(PAINTED_TEXTURE_INDEX, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((index) => {
      if (index && Array.isArray(index.textures) && index.textures.length) {
        paintedIndex = index;
        for (const listener of paintedIndexListeners) listener();
      }
    });
}

// How far a room's land reaches into the gaps around it, how round and soft
// its edge is, and how wide the beach around water shows.
const GROW = 6;
const CORNER = 11;
const FEATHER = 4;
const SHORE = 5;
const ROAD_WIDTH = { road: 10, path: 6, bridge: 11 };
// The living-terrain layers are masked to water and swamp regions with
// copies of the painter's own region masks, kept small: they are soft.
const LIVING_MASK_SCALE = 0.25;
const LIVING_KIND = { sea: 'water', lake: 'water', river: 'water', swamp: 'swamp' };
// Keep the backing store modest; the paint is soft, so it need not be sharp.
const MAX_PIXELS = 2_600_000;
const MAX_SCALE = 2;

// Flat colours to paint with until a texture has loaded, or if one fails.
const TERRAIN_COLORS = {
  underwater: '#1d3f5c', sea: '#1f4f78', lake: '#2c6488', river: '#3a78a0',
  beach: '#c9b27c', swamp: '#4b5a36', desert: '#c8a45e', barren: '#6f6556',
  arctic: '#dfe8ee', plains: '#6f8f45', outside: '#5f7a44', farm: '#8e8a44',
  sky: '#9fc3e0', inside: '#6a5a48', underground: '#3e3a36', city: '#77736c',
  hills: '#6c7a45', jungle: '#2f5a2c', forest: '#35532d', canopy: '#2a4a26',
  mountain: '#7a756d', road: '#8a7c66', path: '#8b6f4a', bridge: '#7a6248',
};

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function sized(canvas, width, height) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

// The resolution a painting of this CSS size is made at: the zoom and pixel
// ratio, within a pixel budget.
function pixelSize(width, height, view) {
  let scale = Math.min(MAX_SCALE, Math.max(0.25, (view.zoom || 1) * (view.dpr || 1)));
  if (width * height * scale * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (width * height));
  }
  return { scale, pixelWidth: Math.round(width * scale), pixelHeight: Math.round(height * scale) };
}

/** Creates a painter with its own texture cache and last-painted scene. */
export function createTerrainPainter(options = {}) {
  const onTexturesChanged = typeof options.onTexturesChanged === 'function'
    ? options.onTexturesChanged : () => {};
  const textures = new Map();
  let textureVersion = 0;
  let scene = null;
  let mask = null;
  let layer = null;
  let lastPaintMs = 0;
  let livingMasks = { key: null, water: null, swamp: null };

  // When the painted textures' index arrives, drop the stand-ins and paint
  // again with whatever it lists.
  const onPaintedIndex = () => {
    textures.clear();
    textureVersion++;
    onTexturesChanged();
  };
  paintedIndexListeners.add(onPaintedIndex);
  requestPaintedIndex();

  function texture(terrain) {
    let entry = textures.get(terrain);
    if (entry) return entry;
    const spec = terrainTextureFor(terrain, paintedIndex);
    entry = { spec, image: null, ready: false };
    textures.set(terrain, entry);
    if (typeof Image === 'function') {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        entry.ready = true;
        textureVersion++;
        onTexturesChanged();
      };
      image.onerror = () => {
        textureVersion++;
        onTexturesChanged();
      };
      image.src = spec.src;
      entry.image = image;
    }
    return entry;
  }

  function fillFor(ctx, terrain, geom) {
    const entry = texture(terrain);
    if (!entry.ready || !entry.image.naturalWidth) return TERRAIN_COLORS[terrain] || '#555';
    const pattern = ctx.createPattern(entry.image, 'repeat');
    if (!pattern) return TERRAIN_COLORS[terrain] || '#555';
    const scale = (entry.spec.span * TERRAIN_PITCH / entry.image.naturalWidth) * geom.scale;
    pattern.setTransform(new DOMMatrix([
      scale, 0, 0, scale,
      -geom.worldX * TERRAIN_PITCH * geom.scale,
      -geom.worldY * TERRAIN_PITCH * geom.scale,
    ]));
    return pattern;
  }

  function paintRegion(target, terrain, cells, grow, geom) {
    const k = geom.scale;
    const maskCtx = mask.getContext('2d');
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    maskCtx.filter = 'blur(' + (FEATHER * k) + 'px)';
    maskCtx.fillStyle = '#fff';
    maskCtx.beginPath();
    for (const cell of cells) {
      const x = (cell.col * TERRAIN_PITCH - grow) * k;
      const y = (cell.row * TERRAIN_PITCH - grow) * k;
      const size = (TERRAIN_TILE + grow * 2) * k;
      maskCtx.roundRect(x, y, size, size, CORNER * k);
    }
    maskCtx.fill();
    maskCtx.filter = 'none';
    const kind = geom.living && LIVING_KIND[terrain];
    if (kind) {
      const w = Math.max(1, Math.round(mask.width * LIVING_MASK_SCALE));
      const h = Math.max(1, Math.round(mask.height * LIVING_MASK_SCALE));
      const into = geom.living[kind] || (geom.living[kind] = makeCanvas(w, h));
      into.getContext('2d').drawImage(mask, 0, 0, w, h);
    }

    const layerCtx = layer.getContext('2d');
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    layerCtx.fillStyle = fillFor(layerCtx, terrain, geom);
    layerCtx.fillRect(0, 0, layer.width, layer.height);
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(mask, 0, 0);
    layerCtx.globalCompositeOperation = 'source-over';
    target.drawImage(layer, 0, 0);
  }

  function paintRoads(ctx, roads, geom) {
    const k = geom.scale;
    const centre = (value) => (value * TERRAIN_PITCH + TERRAIN_TILE / 2) * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const kind of ['path', 'road']) {
      const mine = roads.filter((road) => road.kind === kind);
      if (!mine.length) continue;
      const trace = () => {
        ctx.beginPath();
        for (const road of mine) {
          const x1 = centre(road.from.col);
          const y1 = centre(road.from.row);
          const x2 = centre(road.to.col);
          const y2 = centre(road.to.row);
          if (x1 === x2 && y1 === y2) {
            ctx.moveTo(x1 + ROAD_WIDTH[kind] * k * 0.5, y1);
            ctx.arc(x1, y1, ROAD_WIDTH[kind] * k * 0.5, 0, Math.PI * 2);
          } else {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
          }
        }
      };
      trace();
      ctx.strokeStyle = 'rgba(24, 16, 8, 0.45)';
      ctx.lineWidth = (ROAD_WIDTH[kind] + 3) * k;
      ctx.stroke();
      trace();
      ctx.strokeStyle = fillFor(ctx, kind, geom);
      ctx.lineWidth = ROAD_WIDTH[kind] * k;
      ctx.stroke();
    }
    paintBridges(ctx, roads.filter((road) => road.kind === 'bridge'), geom, centre);
  }

  // Bridge decks are drawn one half-link at a time: dark rails, then the
  // plank texture turned to the deck's direction, so the boards always run
  // across it. Square ends, so the halves meet in one straight deck.
  function paintBridges(ctx, bridges, geom, centre) {
    const k = geom.scale;
    const width = ROAD_WIDTH.bridge * k;
    for (const bridge of bridges) {
      const x1 = centre(bridge.from.col);
      const y1 = centre(bridge.from.row);
      const x2 = centre(bridge.to.col);
      const y2 = centre(bridge.to.row);
      const lone = x1 === x2 && y1 === y2;
      const angle = lone ? 0 : Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.lineCap = lone ? 'square' : 'butt';
      ctx.beginPath();
      ctx.moveTo(lone ? x1 - width / 2 : x1, y1);
      ctx.lineTo(lone ? x1 + width / 2 : x2, lone ? y1 : y2);
      ctx.strokeStyle = 'rgba(28, 18, 8, 0.75)';
      ctx.lineWidth = width + 4 * k;
      ctx.stroke();
      ctx.strokeStyle = bridgeFill(ctx, angle, geom);
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.restore();
    }
  }

  function bridgeFill(ctx, angle, geom) {
    const entry = texture('bridge');
    if (!entry.ready || !entry.image.naturalWidth) return TERRAIN_COLORS.bridge;
    const pattern = ctx.createPattern(entry.image, 'repeat');
    if (!pattern) return TERRAIN_COLORS.bridge;
    // The painted planks run up and down the swatch, across a deck that
    // runs left to right; turn them with the deck.
    const scale = (TERRAIN_TILE * 0.9 / entry.image.naturalWidth) * geom.scale;
    pattern.setTransform(new DOMMatrix().rotateSelf((angle * 180) / Math.PI).scaleSelf(scale));
    return pattern;
  }

  function draw(target, plan, geom) {
    mask = sized(mask || makeCanvas(target.width, target.height), target.width, target.height);
    layer = sized(layer || makeCanvas(target.width, target.height), target.width, target.height);
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    for (const region of plan.layers) {
      if (region.shore) paintRegion(ctx, 'beach', region.cells, GROW + SHORE, geom);
      paintRegion(ctx, region.terrain, region.cells, GROW, geom);
    }
    paintRoads(ctx, plan.roads, geom);
  }

  return {
    /**
     * Paints plan onto canvas. view: { worldX, worldY } is the world cell at
     * the painting's column and row 0; width and height are the painting's
     * CSS size; zoom and dpr set its resolution. view.sceneKey, when given,
     * names the plan, so an unchanged scene is not painted twice.
     * view.crop: { x, y, width, height }, in CSS pixels of the painting, is
     * the part the canvas shows; without it the canvas shows all of it.
     */
    paint(canvas, plan, view) {
      if (!canvas || typeof canvas.getContext !== 'function' || !plan) return false;
      const width = Math.max(1, Math.round(view.width));
      const height = Math.max(1, Math.round(view.height));
      const { scale, pixelWidth, pixelHeight } = pixelSize(width, height, view);
      const geom = { scale, worldX: view.worldX, worldY: view.worldY, living: {} };
      const key = (view.sceneKey || terrainPlanKey(plan)) + '|' + view.worldX + ',' + view.worldY + '|'
        + pixelWidth + 'x' + pixelHeight + '|' + textureVersion;
      if (!scene || scene.key !== key) {
        for (const region of plan.layers) {
          texture(region.terrain);
          if (region.shore) texture('beach');
        }
        for (const road of plan.roads) texture(road.kind);
        const started = typeof performance !== 'undefined' ? performance.now() : 0;
        const bitmap = sized(scene ? scene.bitmap : makeCanvas(pixelWidth, pixelHeight), pixelWidth, pixelHeight);
        draw(bitmap, plan, geom);
        scene = { key, bitmap };
        livingMasks = { key, water: geom.living.water || null, swamp: geom.living.swamp || null };
        lastPaintMs = (typeof performance !== 'undefined' ? performance.now() : 0) - started;
      }
      const crop = view.crop || { x: 0, y: 0, width, height };
      const cropX = Math.round(crop.x * scale);
      const cropY = Math.round(crop.y * scale);
      const cropWidth = Math.max(1, Math.round(crop.width * scale));
      const cropHeight = Math.max(1, Math.round(crop.height * scale));
      sized(canvas, cropWidth, cropHeight);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, cropWidth, cropHeight);
      ctx.drawImage(scene.bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return true;
    },
    /** The key a paint of view would be cached under, for callers that keep the canvas. */
    keyFor(view) {
      const width = Math.max(1, Math.round(view.width));
      const height = Math.max(1, Math.round(view.height));
      const { pixelWidth, pixelHeight } = pixelSize(width, height, view);
      return (view.sceneKey || '') + '|' + view.worldX + ',' + view.worldY + '|'
        + pixelWidth + 'x' + pixelHeight + '|' + textureVersion;
    },
    lastPaintMs: () => lastPaintMs,
    /** The water and swamp masks of the last painting, and its key. */
    livingMasks: () => livingMasks,
    dispose() {
      paintedIndexListeners.delete(onPaintedIndex);
      scene = null;
      mask = null;
      layer = null;
    },
  };
}
