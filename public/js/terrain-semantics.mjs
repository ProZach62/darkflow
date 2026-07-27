// Canonical Darkflow terrain vocabulary. Keep map rendering and optional visual
// ambience on the same deterministic interpretation of Room.Info.environment.
export const TERRAIN_PRIORITY = Object.freeze([
  'city', 'road', 'path', 'forest', 'jungle', 'canopy',
  'plains', 'farm', 'hills', 'mountain', 'desert',
  'sea', 'lake', 'river', 'beach', 'swamp', 'arctic',
  'underground', 'inside', 'barren', 'underwater', 'sky', 'outside',
]);

function flattenTerrainValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenTerrainValues);
  if (value && typeof value === 'object') {
    return [
      ...flattenTerrainValues(value.id),
      ...flattenTerrainValues(value.key),
      ...flattenTerrainValues(value.name),
      ...flattenTerrainValues(value.type),
      ...flattenTerrainValues(value.terrain),
      ...flattenTerrainValues(value.environment),
    ];
  }
  return typeof value === 'string' ? [value.toLowerCase()] : [];
}

export function extractTerrainTokens(environment, limit = TERRAIN_PRIORITY.length) {
  const haystacks = flattenTerrainValues(environment);
  const found = new Set();
  for (const terrain of TERRAIN_PRIORITY) {
    const pattern = new RegExp('(?:^|[^a-z])' + terrain + '(?:$|[^a-z])');
    if (haystacks.some((value) => pattern.test(value))) found.add(terrain);
  }
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : TERRAIN_PRIORITY.length;
  return TERRAIN_PRIORITY.filter((terrain) => found.has(terrain)).slice(0, safeLimit);
}

export function getPrimaryTerrain(environment) {
  return extractTerrainTokens(environment, 1)[0] || 'outside';
}
