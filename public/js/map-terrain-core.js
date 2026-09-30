// Painted terrain for the map: rooms of one terrain join into a region with
// soft edges, water gets a shore, and roads and paths run between rooms as
// strokes over the land around them. This module plans what to paint; the
// painter in map-terrain-paint.js draws it.

// Grid geometry, in unscaled grid pixels: a cell is a 32px room box plus the
// 8px gap to the next.
export const TERRAIN_TILE = 32;
export const TERRAIN_PITCH = 40;

// Bottom to top: low ground first, so higher ground and dense cover overlap
// it where regions meet.
export const TERRAIN_DRAW_ORDER = Object.freeze([
  'underwater', 'sea', 'lake', 'river', 'beach', 'swamp', 'desert', 'barren',
  'arctic', 'plains', 'outside', 'farm', 'sky', 'inside', 'underground', 'city',
  'hills', 'jungle', 'forest', 'canopy', 'mountain', 'road', 'path',
]);

const ROAD_KINDS = new Set(['road', 'path']);
export const WATER_TERRAINS = Object.freeze(['sea', 'lake', 'river', 'underwater']);
const WATER = new Set(WATER_TERRAINS);
const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

// The textures each terrain is painted with. `span` is how many cells one
// repeat of the texture covers. The stand-ins are the 32px map tiles.
export const TERRAIN_TEXTURES = Object.freeze(Object.fromEntries(
  TERRAIN_DRAW_ORDER.map((terrain) => [terrain, {
    src: '/assets/tiles/' + terrain + '.jpg',
    span: 0.8,
  }]),
));

// Where the painted textures live, and the index the texture build writes to
// say which exist.
export const PAINTED_TEXTURE_DIR = '/assets/terrain/';
export const PAINTED_TEXTURE_INDEX = PAINTED_TEXTURE_DIR + 'index.json';

/**
 * The texture to paint a terrain with: the painted one when the index lists
 * it, else the old map tile. index is the parsed index.json, or null.
 */
export function terrainTextureFor(terrain, index) {
  const fallback = TERRAIN_TEXTURES[terrain] || TERRAIN_TEXTURES.outside;
  const listed = index && Array.isArray(index.textures) && index.textures.includes(terrain);
  if (!listed || !/^[a-z]+$/.test(terrain)) return fallback;
  const span = Number(index.span);
  return {
    src: PAINTED_TEXTURE_DIR + terrain + '.webp',
    span: Number.isFinite(span) && span > 0 && span <= 8 ? span : 2.5,
  };
}

function cellKey(col, row) {
  return col + ',' + row;
}

// What a road or path cell stands on: the commonest land around it that is
// not itself a road, or plains when there is none. Roads run beside water,
// not across it.
function groundUnder(cell, byKey) {
  const counts = new Map();
  for (const [dx, dy] of NEIGHBOURS) {
    const next = byKey.get(cellKey(cell.col + dx, cell.row + dy));
    if (!next || next.unseen || ROAD_KINDS.has(next.terrain) || WATER.has(next.terrain)) continue;
    counts.set(next.terrain, (counts.get(next.terrain) || 0) + 1);
  }
  let best = 'plains';
  let bestCount = 0;
  for (const terrain of TERRAIN_DRAW_ORDER) {
    const count = counts.get(terrain) || 0;
    if (count > bestCount) {
      best = terrain;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Plans the painted terrain for one render.
 * cells: [{ col, row, terrain, unseen }] for each room drawn, by grid column
 *   and row. Unseen rooms are left unpainted.
 * links: [{ from: { col, row }, to: { col, row } }] for exits between rooms
 *   drawn in neighbouring cells.
 * Returns { layers: [{ terrain, cells: [{ col, row }], shore }], roads:
 *   [{ kind, from, to }] } with layers in draw order.
 */
export function planTerrain(cells, links = []) {
  const byKey = new Map();
  for (const cell of cells || []) {
    if (!cell || !Number.isInteger(cell.col) || !Number.isInteger(cell.row)) continue;
    const terrain = TERRAIN_DRAW_ORDER.includes(cell.terrain) ? cell.terrain : 'outside';
    byKey.set(cellKey(cell.col, cell.row), { col: cell.col, row: cell.row, terrain, unseen: !!cell.unseen });
  }

  const regions = new Map();
  for (const cell of byKey.values()) {
    if (cell.unseen) continue;
    const ground = ROAD_KINDS.has(cell.terrain) ? groundUnder(cell, byKey) : cell.terrain;
    if (!regions.has(ground)) regions.set(ground, []);
    regions.get(ground).push({ col: cell.col, row: cell.row });
  }

  const roads = [];
  const seen = new Set();
  for (const link of links || []) {
    const from = link && link.from && byKey.get(cellKey(link.from.col, link.from.row));
    const to = link && link.to && byKey.get(cellKey(link.to.col, link.to.row));
    if (!from || !to || from.unseen || to.unseen) continue;
    if (Math.abs(from.col - to.col) > 1 || Math.abs(from.row - to.row) > 1) continue;
    // Roads run between road rooms only. A road room's other exits (into a
    // forest or a town, say) keep their ordinary connector, or every
    // roadside room would sprout a spur.
    if (!ROAD_KINDS.has(from.terrain) || !ROAD_KINDS.has(to.terrain)) continue;
    const pair = [cellKey(from.col, from.row), cellKey(to.col, to.row)].sort().join('|');
    if (seen.has(pair)) continue;
    seen.add(pair);
    // A road meeting a path is still a road.
    const kind = from.terrain === 'road' || to.terrain === 'road' ? 'road' : 'path';
    roads.push({ kind, from: { col: from.col, row: from.row }, to: { col: to.col, row: to.row } });
  }
  // A road room with no road links still shows a patch of road.
  for (const cell of byKey.values()) {
    if (cell.unseen || !ROAD_KINDS.has(cell.terrain)) continue;
    const key = cellKey(cell.col, cell.row);
    const linked = [...seen].some((pair) => pair.split('|').includes(key));
    if (!linked) {
      roads.push({ kind: cell.terrain, from: { col: cell.col, row: cell.row }, to: { col: cell.col, row: cell.row } });
    }
  }

  const layers = TERRAIN_DRAW_ORDER
    .filter((terrain) => regions.has(terrain))
    .map((terrain) => ({ terrain, cells: regions.get(terrain), shore: WATER.has(terrain) }));
  return { layers, roads };
}

/** A stable key for a plan, so an unchanged scene is not painted twice. */
export function terrainPlanKey(plan) {
  if (!plan) return '';
  const layers = plan.layers
    .map((layer) => layer.terrain + ':' + layer.cells.map((c) => cellKey(c.col, c.row)).sort().join(';'))
    .join('/');
  const roads = plan.roads
    .map((road) => road.kind + ':'
      + [cellKey(road.from.col, road.from.row), cellKey(road.to.col, road.to.row)].sort().join('>'))
    .sort()
    .join(';');
  return layers + '#' + roads;
}
