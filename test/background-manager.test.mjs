import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyBackground,
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND_KEY,
  NO_BACKGROUND_KEY,
  getBackgroundPreset,
  normalizeBackgroundKey,
} from '../public/js/background-manager.js';

function jpegSize(buffer) {
  assert.equal(buffer[0], 0xff);
  assert.equal(buffer[1], 0xd8);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG dimensions not found');
}

function fakeDocument() {
  const properties = new Map();
  return {
    properties,
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
    },
  };
}

test('background catalog contains one solid option and eight complete image presets', async () => {
  assert.equal(BACKGROUND_PRESETS[0].key, NO_BACKGROUND_KEY);
  assert.equal(BACKGROUND_PRESETS.length, 9);
  assert.ok(BACKGROUND_PRESETS.some((preset) => preset.key === DEFAULT_BACKGROUND_KEY));
  assert.deepEqual(
    BACKGROUND_PRESETS.slice(-4).map((preset) => preset.key),
    ['neon-city', 'arcane-observatory', 'berserker-hold', 'outback-night']
  );
  assert.equal(new Set(BACKGROUND_PRESETS.map((preset) => preset.key)).size, BACKGROUND_PRESETS.length);

  for (const preset of BACKGROUND_PRESETS.filter((entry) => entry.image)) {
    const image = await readFile(new URL('../public' + preset.image, import.meta.url));
    const thumbnail = await readFile(new URL('../public' + preset.thumbnail, import.meta.url));
    assert.deepEqual(jpegSize(image), { width: 1792, height: 960 }, preset.key);
    assert.deepEqual(jpegSize(thumbnail), { width: 336, height: 180 }, preset.key + ' thumbnail');
    assert.ok(image.length > 100_000, preset.key + ' image is unexpectedly small');
    assert.ok(thumbnail.length > 4_000, preset.key + ' thumbnail is unexpectedly small');
  }
});

test('unknown background keys normalize to the solid fallback', () => {
  assert.equal(normalizeBackgroundKey(DEFAULT_BACKGROUND_KEY), DEFAULT_BACKGROUND_KEY);
  assert.equal(normalizeBackgroundKey('missing-background'), NO_BACKGROUND_KEY);
  assert.equal(normalizeBackgroundKey(null), NO_BACKGROUND_KEY);
  assert.equal(getBackgroundPreset('missing-background').key, NO_BACKGROUND_KEY);
});

test('applying a preset writes trusted CSS variables and none clears them', () => {
  const doc = fakeDocument();
  const preset = applyBackground('moonlit-forest', doc);
  assert.equal(preset.key, 'moonlit-forest');
  assert.equal(doc.documentElement.dataset.background, 'moonlit-forest');
  assert.equal(doc.documentElement.dataset.backgroundActive, 'true');
  assert.equal(doc.properties.get('--df-background-image'), 'url("/assets/backgrounds/moonlit-forest.jpg")');
  assert.equal(doc.properties.get('--df-background-position'), 'center center');
  assert.equal(doc.properties.get('--df-background-dim'), '0.2');
  assert.equal(doc.properties.get('--df-terminal-background-alpha'), '0.54');

  applyBackground(NO_BACKGROUND_KEY, doc);
  assert.equal(doc.documentElement.dataset.background, NO_BACKGROUND_KEY);
  assert.equal(doc.documentElement.dataset.backgroundActive, undefined);
  assert.equal(doc.properties.size, 0);
});

test('background CSS repeats horizontally and keeps the picker usable on narrow screens', async () => {
  const mainCss = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const panelsCss = await readFile(new URL('../public/css/panels.css', import.meta.url), 'utf8');
  assert.match(mainCss, /#app-background\s*\{[^}]*background-repeat:\s*repeat-x;/s);
  assert.match(mainCss, /#app-background\s*\{[^}]*background-size:\s*auto 100%;/s);
  assert.match(mainCss, /html\[data-background-active="true"\]\s+#output-shell/);
  assert.match(mainCss, /@media \(max-width: 700px\)\s*\{[\s\S]*?\.settings-modal-body\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(mainCss, /\.settings-tabs\s*\{[^}]*flex-direction:\s*row;[^}]*overflow-x:\s*auto;/s);
  assert.match(panelsCss, /html\[data-background-active="true"\]\s+body\.floating-workspace-mode\s+#main-content\s*\{\s*background:\s*transparent;/);
});
