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

// One compiled pattern per terrain word, made once.
const TERRAIN_PATTERNS = TERRAIN_PRIORITY.map((terrain) => [
  terrain,
  new RegExp('(?:^|[^a-z])' + terrain + '(?:$|[^a-z])'),
]);

// The map reads every visible room's environment on every render, and a
// world has only a few hundred distinct environment strings, so the tokens
// of each string are remembered. Bounded, and cleared whole when full.
const STRING_TOKENS = new Map();
const MAX_REMEMBERED = 4000;

function tokensOf(environment) {
  if (typeof environment === 'string') {
    const known = STRING_TOKENS.get(environment);
    if (known) return known;
  }
  const haystacks = flattenTerrainValues(environment);
  const tokens = Object.freeze(TERRAIN_PATTERNS
    .filter(([, pattern]) => haystacks.some((value) => pattern.test(value)))
    .map(([terrain]) => terrain));
  if (typeof environment === 'string') {
    if (STRING_TOKENS.size >= MAX_REMEMBERED) STRING_TOKENS.clear();
    STRING_TOKENS.set(environment, tokens);
  }
  return tokens;
}

export function extractTerrainTokens(environment, limit = TERRAIN_PRIORITY.length) {
  const tokens = tokensOf(environment);
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : TERRAIN_PRIORITY.length;
  return tokens.slice(0, safeLimit);
}

export function getPrimaryTerrain(environment) {
  return extractTerrainTokens(environment, 1)[0] || 'outside';
}
