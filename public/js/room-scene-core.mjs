import { extractTerrainTokens, getPrimaryTerrain } from './terrain-semantics.mjs';

const BUILDING_SPRITES = Object.freeze({
  bank: 'bank',
  guild: 'guild',
  house: 'house',
  post: 'post',
  pub: 'pub',
  ruins: 'ruins',
  shop: 'shop',
  temple: 'temple',
  tower: 'ruins',
});

const PROP_SPRITES = new Set([
  'altar',
  'barrels',
  'bookshelf',
  'chair',
  'chest',
  'fountain',
  'gate',
  'sign',
  'statue',
  'table',
  'tree',
  'well',
]);

const TERRAIN_TEXTURES = Object.freeze({
  arctic: 'arctic',
  barren: 'desert',
  beach: 'beach',
  canopy: 'forest',
  city: 'city',
  desert: 'desert',
  farm: 'plains',
  forest: 'forest',
  hills: 'mountain',
  inside: 'inside',
  jungle: 'forest',
  lake: 'lake',
  mountain: 'mountain',
  outside: 'plains',
  path: 'plains',
  plains: 'plains',
  river: 'river',
  road: 'city',
  sea: 'lake',
  sky: 'arctic',
  swamp: 'swamp',
  underground: 'underground',
  underwater: 'lake',
});

const OCCUPANT_POSITIONS = Object.freeze([
  { x: 50, y: 62 },
  { x: 39, y: 58 },
  { x: 61, y: 58 },
  { x: 31, y: 64 },
  { x: 69, y: 64 },
  { x: 44, y: 71 },
  { x: 56, y: 71 },
  { x: 78, y: 69 },
]);

const BUILDING_POSITIONS = Object.freeze([
  { x: 28, y: 49 },
  { x: 50, y: 44 },
  { x: 72, y: 49 },
]);

const TARGET_POSITIONS = Object.freeze([
  { x: 24, y: 57 },
  { x: 76, y: 57 },
  { x: 19, y: 66 },
  { x: 81, y: 66 },
  { x: 35, y: 73 },
  { x: 65, y: 73 },
  { x: 50, y: 77 },
  { x: 50, y: 51 },
]);

const EXIT_POSITIONS = Object.freeze({
  north: { x: 68, y: 29, label: 'N' },
  northeast: { x: 84, y: 39, label: 'NE' },
  east: { x: 90, y: 70, label: 'E' },
  southeast: { x: 71, y: 73, label: 'SE' },
  south: { x: 29, y: 73, label: 'S' },
  southwest: { x: 10, y: 60, label: 'SW' },
  west: { x: 16, y: 39, label: 'W' },
  northwest: { x: 32, y: 29, label: 'NW' },
  up: { x: 87, y: 28, label: 'U' },
  down: { x: 13, y: 72, label: 'D' },
});

function spriteWord(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function roomSceneTerrain(environment) {
  return getPrimaryTerrain(environment);
}

export function roomSceneTexture(environment) {
  if (extractTerrainTokens(environment).includes('inside')) return 'inside';
  return TERRAIN_TEXTURES[roomSceneTerrain(environment)] ?? 'plains';
}

export function roomSceneDetails(details) {
  if (Array.isArray(details)) return [...new Set(details.map(spriteWord).filter(Boolean))].slice(0, 6);
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details)
    .filter(([, value]) => value !== false && value !== 0 && value !== null && value !== '')
    .map(([key]) => spriteWord(key))
    .filter(Boolean)
    .slice(0, 6);
}

function detailTarget(detail, index) {
  const key = spriteWord(detail);
  return {
    id: `detail:${key || index}`,
    name: String(detail ?? '').trim() || `detail ${index + 1}`,
    nouns: [key],
  };
}

export function roomSceneTargets(looks, details) {
  const targets = [];
  if (Array.isArray(looks)) {
    for (const look of looks) {
      if (!look || typeof look !== 'object') continue;
      const id = spriteWord(look.id);
      const name = String(look.name ?? '').trim();
      const nouns = Array.isArray(look.nouns) ? look.nouns.map(spriteWord).filter(Boolean) : [];
      if (!id || !name || !nouns.length) continue;
      targets.push({
        id,
        name,
        nouns: [...new Set(nouns)],
        kind: spriteWord(look.kind),
        sprite: spriteWord(look.sprite),
      });
    }
  }
  if (!targets.length && Array.isArray(details)) {
    targets.push(...details.map(detailTarget));
  } else if (!targets.length && details && typeof details === 'object') {
    for (const [key, value] of Object.entries(details)) {
      if (value === false || value === 0 || value === null || value === '') continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const name = String(value.name ?? key).trim();
        const nouns = Array.isArray(value.nouns) ? value.nouns.map(spriteWord).filter(Boolean) : [spriteWord(key)];
        targets.push({
          id: spriteWord(value.id ?? key),
          name,
          nouns: [...new Set(nouns)],
          kind: spriteWord(value.kind),
          sprite: spriteWord(value.sprite),
        });
      } else {
        targets.push(detailTarget(key, targets.length));
      }
    }
  }
  const seen = new Set();
  return targets.filter((target) => target.id && !seen.has(target.id) && seen.add(target.id)).slice(0, 12);
}

export function roomScenePropSprite(target = {}) {
  const explicit = spriteWord(target.sprite);
  if (PROP_SPRITES.has(explicit)) return explicit;
  const words = [target.kind, target.name, ...(target.nouns || [])].map(spriteWord).join('-');
  const matches = [
    ['bookshelf', ['bookshelf', 'bookcase', 'shelf', 'books']],
    ['fountain', ['fountain']],
    ['barrels', ['barrel', 'cask']],
    ['statue', ['statue', 'sculpture', 'idol']],
    ['chest', ['chest', 'coffer', 'trunk']],
    ['table', ['table', 'desk']],
    ['chair', ['chair', 'seat', 'bench']],
    ['altar', ['altar', 'shrine']],
    ['sign', ['sign', 'signpost']],
    ['well', ['well']],
    ['gate', ['gate', 'portcullis']],
    ['tree', ['tree', 'oak', 'willow', 'pine']],
  ];
  return matches.find(([, nouns]) => nouns.some((noun) => words.includes(noun)))?.[0] ?? null;
}

export function roomSceneTargetMatches(target, query) {
  const needle = spriteWord(query);
  if (!needle) return false;
  return [target.id, target.name, ...(target.nouns || [])].map(spriteWord).some((value) => value === needle);
}

export function roomSceneBuildingSprite(detail) {
  const key = spriteWord(detail);
  if (key === 'post-office') return 'post';
  return BUILDING_SPRITES[key] ?? null;
}

export function roomSceneOccupantSprite(occupant = {}) {
  const description = [occupant.race, occupant.family, occupant.name]
    .map(spriteWord)
    .filter(Boolean)
    .join('-');
  if (description.includes('arthok')) return 'arthok';
  if (description.includes('ursavar')) return 'ursavar';
  if (description.includes('ice-ogre') || description.includes('frost-giant')) return 'ice-ogre';

  const gender = spriteWord(occupant.gender);
  const suffix = gender === 'female' || gender === 'woman' ? 'female' : 'male';
  if (description.includes('scro') || description.includes('orc')) return `scro-${suffix}`;
  if (description.includes('dwarf') || description.includes('duergar')) return `dwarf-${suffix}`;
  if (description.includes('elf') || description.includes('sidhe')) return `elf-${suffix}`;
  if (description.includes('human') || description.includes('northman')) return `human-${suffix}`;
  return 'humanoid';
}

export function roomSceneOccupantPosition(index) {
  return OCCUPANT_POSITIONS[index % OCCUPANT_POSITIONS.length];
}

export function roomSceneBuildingPosition(index) {
  return BUILDING_POSITIONS[index % BUILDING_POSITIONS.length];
}

export function roomSceneTargetPosition(index) {
  return TARGET_POSITIONS[index % TARGET_POSITIONS.length];
}

export function roomSceneExitPosition(direction) {
  return EXIT_POSITIONS[spriteWord(direction)] ?? null;
}

export function roomSceneDoorSprite(value) {
  const key = spriteWord(value);
  if (key.includes('lock') || Number(value) === 3) return 'door-locked';
  if (key.includes('close') || Number(value) === 2) return 'door-closed';
  if (key.includes('open') || Number(value) === 1) return 'door-open';
  return null;
}
