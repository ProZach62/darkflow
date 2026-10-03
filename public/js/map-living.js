// Living terrain: distinct sea, lake, and river movement, drifting swamp
// mist, and torchlight in towns at night. The compositor runs two pattern
// planes per terrain kind, masked to the painter's regions, rather than an
// animation per cell. Torches are painted once onto three canvases. Layers
// are rebuilt only when the terrain painting is, and animations start once.

const PITCH = 40;
const TILE = 32;
const TORCH_LAYERS = 3;
const TORCH_RESOLUTION = 0.5;

// Every translation is one complete CSS background tile, so each loop joins
// without a jump. Two planes at different speeds keep the motion organic
// while remaining a fixed amount of compositor work for any map size.
const MASKED_MOTION = {
  sea: [
    { x: -96, y: 0, duration: 7600 },
    { x: -64, y: -64, duration: 11800 },
  ],
  lake: [
    { x: -128, y: 0, duration: 19000 },
    { x: -96, y: -96, duration: 27000 },
  ],
  river: [
    { x: -96, y: -48, duration: 3400 },
    { x: -64, y: -32, duration: 5300 },
  ],
  swamp: [
    { x: -160, y: 0, duration: 52000 },
    { x: -120, y: -120, duration: 73000 },
  ],
};

function hash01(x, y, salt) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) + salt * 0x27d4eb2d, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function canvasToUrl(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' }).then((blob) => URL.createObjectURL(blob));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('no mask'))), 'image/png');
  });
}

/** Creates the living-terrain layers for one map; update() keeps them current. */
export function createLivingLayers() {
  const masked = {};
  const torches = [];
  let maskKey = null;
  let torchKey = null;
  let disposed = false;

  function animateOnce(el, slot, keyframes, options) {
    const running = el[slot];
    if (running && running.playState !== 'idle') return;
    el[slot] = el.animate(keyframes, options);
  }

  function maskedLayer(kind) {
    if (masked[kind]) return masked[kind];
    const layer = document.createElement('div');
    layer.className = 'map-live-layer map-live-' + kind;
    layer.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    const patterns = MASKED_MOTION[kind].map((_, index) => {
      const pattern = document.createElement('div');
      pattern.className = 'map-live-pattern map-live-pattern-' + (index + 1);
      layer.append(pattern);
      return pattern;
    });
    masked[kind] = { layer, patterns, url: null };
    return masked[kind];
  }

  function placeAfterTerrain(grid, el) {
    if (el.parentNode === grid) return;
    const terrain = grid.querySelector(':scope > canvas.map-terrain');
    if (terrain) terrain.after(el);
    else grid.prepend(el);
  }

  // Renders come often; even a write of an unchanged value restyles, so
  // sizes and visibility are written only when they change.
  function sizeLayer(entry, width, height, motion) {
    const size = width + 'x' + height;
    if (entry.size === size) return;
    entry.size = size;
    entry.layer.style.width = width + 'px';
    entry.layer.style.height = height + 'px';
    entry.patterns.forEach((pattern, index) => {
      pattern.style.width = Math.ceil(width + Math.abs(motion[index].x)) + 'px';
      pattern.style.height = Math.ceil(height + Math.abs(motion[index].y)) + 'px';
    });
  }

  function show(el, visible) {
    if (el.hidden === !visible) return;
    el.hidden = !visible;
  }

  function setMask(kind, canvas, key) {
    const entry = maskedLayer(kind);
    if (!canvas) {
      show(entry.layer, false);
      return;
    }
    canvasToUrl(canvas).then((url) => {
      if (disposed || maskKey !== key) {
        URL.revokeObjectURL(url);
        return;
      }
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = url;
      entry.layer.style.maskImage = 'url(' + url + ')';
      entry.layer.style.webkitMaskImage = 'url(' + url + ')';
      show(entry.layer, true);
    }).catch(() => {
      show(entry.layer, false);
    });
  }

  function drawTorches(cells, width, height) {
    while (torches.length < TORCH_LAYERS) {
      const canvas = document.createElement('canvas');
      canvas.className = 'map-live-torches';
      canvas.setAttribute('aria-hidden', 'true');
      torches.push(canvas);
    }
    const w = Math.max(1, Math.round(width * TORCH_RESOLUTION));
    const h = Math.max(1, Math.round(height * TORCH_RESOLUTION));
    for (const canvas of torches) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.getContext('2d').clearRect(0, 0, w, h);
    }
    for (const cell of cells) {
      const layer = torches[Math.floor(hash01(cell.x, cell.y, 3) * TORCH_LAYERS)];
      const ctx = layer.getContext('2d');
      const x = (cell.col * PITCH + TILE * (0.25 + hash01(cell.x, cell.y, 1) * 0.5)) * TORCH_RESOLUTION;
      const y = (cell.row * PITCH + TILE * (0.25 + hash01(cell.x, cell.y, 2) * 0.5)) * TORCH_RESOLUTION;
      const radius = 9 * TORCH_RESOLUTION;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, 'rgba(255, 214, 130, 1)');
      glow.addColorStop(0.18, 'rgba(255, 180, 80, 0.85)');
      glow.addColorStop(0.45, 'rgba(255, 140, 50, 0.3)');
      glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }

  return {
    /**
     * Brings the layers up to date in grid. opts: { maskKey, masks: { sea,
     * lake, river, swamp } (canvases in the painting's coordinates, or null), width,
     * height (the painting's CSS size), torches: [{ col, row, x, y }] (town
     * cells to light, empty by day), torchKey }.
     */
    update(grid, opts) {
      if (disposed || !grid) return;
      const entries = {};
      for (const [kind, motion] of Object.entries(MASKED_MOTION)) {
        entries[kind] = maskedLayer(kind);
        sizeLayer(entries[kind], opts.width, opts.height, motion);
      }
      if (opts.maskKey !== maskKey) {
        maskKey = opts.maskKey;
        for (const kind of Object.keys(MASKED_MOTION)) {
          setMask(kind, opts.masks && opts.masks[kind], maskKey);
        }
      }
      for (const kind of ['swamp', 'sea', 'lake', 'river']) placeAfterTerrain(grid, entries[kind].layer);
      for (const [kind, motion] of Object.entries(MASKED_MOTION)) {
        motion.forEach((move, index) => {
          animateOnce(entries[kind].patterns[index], '__slide', [
            { translate: '0px 0px' },
            { translate: move.x + 'px ' + move.y + 'px' },
          ], { duration: move.duration, iterations: Infinity, easing: 'linear' });
        });
      }
      animateOnce(entries.swamp.layer, '__breathe', [
        { opacity: 0.55 },
        { opacity: 1 },
      ], { duration: 12000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });

      const lit = opts.torches && opts.torches.length;
      if (lit && opts.torchKey !== torchKey) {
        torchKey = opts.torchKey;
        drawTorches(opts.torches, opts.width, opts.height);
      }
      torches.forEach((canvas, index) => {
        show(canvas, !!lit);
        if (!lit) return;
        // Before the marks, so the player's marker (same z-index) draws on
        // top; above the night tint, so the torches glow in the dark.
        if (canvas.parentNode !== grid) grid.insertBefore(canvas, grid.querySelector(':scope > .map-marks'));
        animateOnce(canvas, '__flicker', [
          { opacity: 0.9 }, { opacity: 0.55 }, { opacity: 1 }, { opacity: 0.7 }, { opacity: 0.95 }, { opacity: 0.6 },
        ], { duration: 1300 + index * 430, iterations: Infinity, easing: 'linear' });
      });
      if (!lit) torchKey = null;
    },
    /** Takes the layers out of the map (the setting is off, or motion is reduced). */
    clear() {
      for (const entry of Object.values(masked)) entry.layer.remove();
      for (const canvas of torches) canvas.remove();
      maskKey = null;
      torchKey = null;
    },
    dispose() {
      disposed = true;
      for (const entry of Object.values(masked)) {
        entry.layer.remove();
        if (entry.url) URL.revokeObjectURL(entry.url);
      }
      for (const canvas of torches) canvas.remove();
    },
  };
}
