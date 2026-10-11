#!/usr/bin/env node
// Builds the map's painted terrain textures from Gemini sheets.
//
// Each sheet is a 3x3 grid of square swatches with black gutters (see the
// prompts in the sprite kit's terrain folder). For every named swatch this
// finds the grid from the gutters, crops the swatch clear of them, makes it
// tile without seams, and writes a small WebP to public/assets/terrain. A
// preview with every texture repeated 3x3 goes next to the sheets, so seams
// can be checked by eye.
//
// Usage: node scripts/terrain-texture-build.cjs [kitDir] [outDir]
// Runs in headless Edge through Playwright, so it needs no image libraries.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SHEETS = [
  {
    file: 'sheet-1-wild-lands.png',
    names: ['forest', 'jungle', 'canopy', 'plains', 'farm', 'hills', 'swamp', 'mountain', 'outside'],
  },
  {
    file: 'sheet-2-water-and-harsh-lands.png',
    names: ['sea', 'lake', 'river', 'underwater', 'beach', 'desert', 'barren', 'arctic', 'sky'],
  },
  {
    file: 'sheet-3-built-and-below.png',
    names: ['city', 'road', 'path', 'inside', 'underground', 'bridge', null, null, null],
  },
];
const OUTPUT_SIZE = 256;
const WORK_SIZE = 512;
const WEBP_QUALITY = 0.86;
// How many map cells one repeat of a painted texture covers.
const TEXTURE_SPAN = 5;

// Runs in the page: find the grid, cut and seam every swatch, and return
// WebP and preview data URLs.
async function processSheet({ dataUrl, names, options }) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const source = new OffscreenCanvas(width, height);
  const sctx = source.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(image, 0, 0);
  const pixels = sctx.getImageData(0, 0, width, height).data;

  // Mean brightness of each column and row; gutters are the dark runs.
  const columnLight = new Float32Array(width);
  const rowLight = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      columnLight[x] += light / height;
      rowLight[y] += light / width;
    }
  }
  // The three widest bright runs along an axis are the swatch bands; a
  // sheet whose gutters cannot be found falls back to equal thirds.
  function bands(light, length) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= length; i++) {
      const bright = i < length && light[i] > 24;
      if (bright && start < 0) start = i;
      if (!bright && start >= 0) {
        runs.push([start, i]);
        start = -1;
      }
    }
    const widest = runs
      .filter(([a, b]) => b - a > length * 0.15)
      .sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))
      .slice(0, 3)
      .sort((p, q) => p[0] - q[0]);
    if (widest.length === 3) return { found: true, bands: widest };
    // A sheet with an empty black row or column shows only two bands; the
    // third sits one pitch further on.
    if (widest.length === 2) {
      const pitch = widest[1][0] - widest[0][0];
      const next = [widest[1][0] + pitch, Math.min(length, widest[1][1] + pitch)];
      if (pitch > 0 && next[1] - next[0] > length * 0.15) {
        const all = widest[0][0] > pitch * 0.5 ? [[widest[0][0] - pitch, widest[0][1] - pitch], ...widest] : [...widest, next];
        return { found: true, bands: all };
      }
    }
    const third = length / 3;
    return {
      found: false,
      bands: [0, 1, 2].map((n) => [Math.round(n * third), Math.round((n + 1) * third)]),
    };
  }
  const columns = bands(columnLight, width);
  const rows = bands(rowLight, height);

  function canvas(size) {
    return new OffscreenCanvas(size, size);
  }
  // A copy of `from` rolled by (dx, dy), wrapping around the edges.
  function rolled(from, dx, dy) {
    const size = from.width;
    const out = canvas(size);
    const ctx = out.getContext('2d');
    for (const ox of [0, -size]) {
      for (const oy of [0, -size]) ctx.drawImage(from, dx + ox, dy + oy);
    }
    return out;
  }
  function masked(from, paint) {
    const out = canvas(from.width);
    const ctx = out.getContext('2d');
    ctx.drawImage(from, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    paint(ctx, from.width);
    return out;
  }
  // Seam removal: roll the swatch by half so its own edges meet in the
  // middle and its outer edges wrap. Then cover the seams, from the outside
  // in, with copies rolled along one axis only (whose middles are clean),
  // and finally the untouched centre of the original.
  function seamless(swatch) {
    const n = swatch.width;
    const half = n / 2;
    const band = n * 0.2;
    const out = rolled(swatch, half, half);
    const ctx = out.getContext('2d');
    const vertical = masked(rolled(swatch, 0, half), (m, size) => {
      const g = m.createLinearGradient(half - band, 0, half + band, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.35, 'rgba(0,0,0,1)');
      g.addColorStop(0.65, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(0, 0, size, size);
    });
    const horizontal = masked(rolled(swatch, half, 0), (m, size) => {
      const g = m.createLinearGradient(0, half - band, 0, half + band);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.35, 'rgba(0,0,0,1)');
      g.addColorStop(0.65, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(0, 0, size, size);
    });
    const centre = masked(swatch, (m, size) => {
      const g = m.createRadialGradient(half, half, n * 0.14, half, half, n * 0.32);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(0, 0, size, size);
    });
    ctx.drawImage(vertical, 0, 0);
    ctx.drawImage(horizontal, 0, 0);
    ctx.drawImage(centre, 0, 0);
    return out;
  }
  async function dataUrlOf(c, type, quality) {
    const blob = await c.convertToBlob({ type, quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return 'data:' + type + ';base64,' + btoa(binary);
  }
  // How visible the wrap seam is: the mean colour step across the wrapped
  // edges, against the mean step between neighbouring pixels inside.
  function seamScore(c) {
    const n = c.width;
    const data = c.getContext('2d').getImageData(0, 0, n, n).data;
    const at = (x, y, k) => data[(y * n + x) * 4 + k];
    const step = (x1, y1, x2, y2) =>
      Math.abs(at(x1, y1, 0) - at(x2, y2, 0)) + Math.abs(at(x1, y1, 1) - at(x2, y2, 1))
      + Math.abs(at(x1, y1, 2) - at(x2, y2, 2));
    let edge = 0;
    let inside = 0;
    for (let i = 0; i < n; i++) {
      edge += step(n - 1, i, 0, i) + step(i, n - 1, i, 0);
      inside += step(n / 2 - 1, i, n / 2, i) + step(i, n / 2 - 1, i, n / 2);
    }
    return Math.round((edge / Math.max(1, inside)) * 100) / 100;
  }

  const results = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (!name) continue;
    const [x0, x1] = columns.bands[index % 3];
    const [y0, y1] = rows.bands[Math.floor(index / 3)];
    // Crop a square clear of the gutters and any soft edge by them.
    const inset = Math.round(Math.min(x1 - x0, y1 - y0) * 0.06);
    const side = Math.min(x1 - x0, y1 - y0) - inset * 2;
    const cx = Math.round((x0 + x1) / 2);
    const cy = Math.round((y0 + y1) / 2);
    const work = canvas(options.workSize);
    const wctx = work.getContext('2d');
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(source, cx - side / 2, cy - side / 2, side, side, 0, 0, options.workSize, options.workSize);
    const tiled = seamless(work);
    const out = canvas(options.outputSize);
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(tiled, 0, 0, options.outputSize, options.outputSize);
    const preview = canvas(options.outputSize * 3);
    const pctx = preview.getContext('2d');
    for (let i = 0; i < 9; i++) {
      pctx.drawImage(out, (i % 3) * options.outputSize, Math.floor(i / 3) * options.outputSize);
    }
    results.push({
      name,
      webp: await dataUrlOf(out, 'image/webp', options.quality),
      preview: await dataUrlOf(preview, 'image/png'),
      seam: seamScore(out),
      source: { x: cx - side / 2, y: cy - side / 2, side },
    });
  }
  return { width, height, gridFound: columns.found && rows.found, results };
}

function writeDataUrl(file, dataUrl) {
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function main() {
  const kitDir = path.resolve(process.argv[2] || 'F:/darkflow-sprite-kit/terrain');
  const outDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public', 'assets', 'terrain'));
  const previewDir = path.join(kitDir, 'previews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>terrain</title>');
  let built = 0;
  try {
    for (const sheet of SHEETS) {
      const file = path.join(kitDir, sheet.file);
      if (!fs.existsSync(file)) {
        console.log(`skip  ${sheet.file} (not there yet)`);
        continue;
      }
      const bytes = fs.readFileSync(file);
      // Gemini sometimes saves a JPEG under a .png name; say what it is.
      const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
      const dataUrl = 'data:' + type + ';base64,' + bytes.toString('base64');
      const result = await page.evaluate(processSheet, {
        dataUrl,
        names: sheet.names,
        options: { outputSize: OUTPUT_SIZE, workSize: WORK_SIZE, quality: WEBP_QUALITY },
      });
      console.log(
        `sheet ${sheet.file}: ${result.width}x${result.height}, `
        + (result.gridFound ? 'grid found from the gutters' : 'no clear gutters, cut in equal thirds'),
      );
      for (const texture of result.results) {
        writeDataUrl(path.join(outDir, texture.name + '.webp'), texture.webp);
        writeDataUrl(path.join(previewDir, texture.name + '-tiled.png'), texture.preview);
        const size = fs.statSync(path.join(outDir, texture.name + '.webp')).size;
        // Near 1 the wrap is as smooth as the texture's own grain.
        console.log(`  ${texture.name.padEnd(12)} ${Math.round(size / 1024)} KB, seam ${texture.seam}`);
        built++;
      }
    }
  } finally {
    await browser.close();
  }
  // The map reads this index to know which painted textures exist, and
  // paints anything missing with the old map tiles.
  const textures = fs.readdirSync(outDir)
    .filter((file) => file.endsWith('.webp'))
    .map((file) => file.slice(0, -'.webp'.length))
    .sort();
  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ version: 1, span: TEXTURE_SPAN, textures }, null, 2) + '\n',
  );
  console.log(`built ${built} texture${built === 1 ? '' : 's'} into ${outDir}; ${textures.length} listed in index.json`);
  return built;
}

module.exports = { SHEETS, processSheet, main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
