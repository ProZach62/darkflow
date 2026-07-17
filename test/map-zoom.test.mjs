import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MAP_ZOOM,
  MAP_ZOOM_LEVELS,
  formatMapZoom,
  normalizeMapZoom,
  stepMapZoom,
} from '../public/js/map-zoom.js';

test('map zoom defaults and snaps to supported levels', () => {
  assert.equal(normalizeMapZoom(undefined), DEFAULT_MAP_ZOOM);
  assert.equal(normalizeMapZoom(null), DEFAULT_MAP_ZOOM);
  assert.equal(normalizeMapZoom('0.82'), 0.8);
  assert.equal(normalizeMapZoom(9), MAP_ZOOM_LEVELS.at(-1));
});

test('map zoom steps and clamps at both ends', () => {
  assert.equal(stepMapZoom(1, -1), 0.9);
  assert.equal(stepMapZoom(1, 1), 1.1);
  assert.equal(stepMapZoom(0.3, -1), 0.2);
  assert.equal(stepMapZoom(MAP_ZOOM_LEVELS[0], -1), MAP_ZOOM_LEVELS[0]);
  assert.equal(stepMapZoom(MAP_ZOOM_LEVELS.at(-1), 1), MAP_ZOOM_LEVELS.at(-1));
});

test('map zoom formats as a percentage', () => {
  assert.equal(formatMapZoom(1), '100%');
  assert.equal(formatMapZoom(1.25), '125%');
});
