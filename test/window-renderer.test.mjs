import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countDirectPlayerRows,
  usesPlayerRowMultiColumnGrid,
} from '../public/js/window-renderer.js';

function gridWithPlayerRows(count) {
  return {
    type: 'grid',
    children: Array.from({ length: count }, (_, index) => ({
      type: 'player_row',
      name: 'Character ' + (index + 1),
    })),
  };
}

test('player row grids stay single layout through three characters', () => {
  assert.equal(countDirectPlayerRows(gridWithPlayerRows(3)), 3);
  assert.equal(usesPlayerRowMultiColumnGrid(gridWithPlayerRows(3), { windowId: 'charselect' }), false);
});

test('charselect player row grids switch to multicolumn beyond three characters', () => {
  assert.equal(countDirectPlayerRows(gridWithPlayerRows(4)), 4);
  assert.equal(usesPlayerRowMultiColumnGrid(gridWithPlayerRows(4), { windowId: 'charselect' }), true);
});

test('non-charselect player row grids do not switch layout', () => {
  assert.equal(usesPlayerRowMultiColumnGrid(gridWithPlayerRows(4), { windowId: 'finger' }), false);
});
