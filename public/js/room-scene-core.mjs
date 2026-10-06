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
  'anvil',
  'barrels',
  'bed',
  'bench',
  'bookshelf',
  'brazier',
  'campfire',
  'cart',
  'chair',
  'chains',
  'chest',
  'crates',
  'dead-tree',
  'fountain',
  'gate',
  'gravestone',
  'loot',
  'market-stall',
  'mushrooms',
  'reeds',
  'rubble',
  'rug',
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
  north: { x: 63, y: 29, label: 'North' },
  northeast: { x: 84, y: 39, label: 'NE' },
  east: { x: 86, y: 70, label: 'East' },
  southeast: { x: 71, y: 73, label: 'SE' },
  south: { x: 29, y: 73, label: 'South' },
  southwest: { x: 10, y: 60, label: 'SW' },
  west: { x: 16, y: 39, label: 'West' },
  northwest: { x: 32, y: 29, label: 'NW' },
  up: { x: 80, y: 29, label: 'Up' },
  down: { x: 13, y: 72, label: 'Down' },
});

function spriteWord(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function commandWord(value) {
  const command = String(value ?? '').trim().toLocaleLowerCase();
  return /^[a-z][a-z0-9_-]{0,23}$/.test(command) ? command : '';
}

function commandNoun(value) {
  const noun = String(value ?? '').trim();
  // Preserve the server-authored parser phrase exactly, but never permit a
  // noun to become a second command or contain terminal controls.
  return noun && noun.length <= 120 && !/[;\r\n\x00-\x1f\x7f]/.test(noun) ? noun : '';
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
  const looksSupplied = Array.isArray(looks) || looks === '';
  if (Array.isArray(looks)) {
    for (const look of looks) {
      if (!look || typeof look !== 'object') continue;
      const id = spriteWord(look.id);
      const name = String(look.name ?? '').trim();
      const nouns = Array.isArray(look.nouns) ? look.nouns.map(commandNoun).filter(Boolean) : [];
      if (!id || !name || !nouns.length) continue;
      targets.push({
        id,
        name,
        nouns: [...new Set(nouns)],
        kind: spriteWord(look.kind),
        sprite: spriteWord(look.sprite),
        state: spriteWord(look.state),
        category: spriteWord(look.category),
        cue: spriteWord(look.cue),
        verbs: Array.isArray(look.verbs)
          ? [...new Set(look.verbs.map(commandWord).filter(Boolean))].slice(0, 6)
          : [],
        position:
          look.position && typeof look.position === 'object'
            ? { x: Number(look.position.x), y: Number(look.position.y) }
            : null,
      });
    }
  }
  if (!looksSupplied && !targets.length && Array.isArray(details)) {
    targets.push(...details.map(detailTarget));
  } else if (!looksSupplied && !targets.length && details && typeof details === 'object') {
    for (const [key, value] of Object.entries(details)) {
      if (value === false || value === 0 || value === null || value === '') continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const name = String(value.name ?? key).trim();
        const nouns = Array.isArray(value.nouns) ? value.nouns.map(commandNoun).filter(Boolean) : [commandNoun(key)];
        targets.push({
          id: spriteWord(value.id ?? key),
          name,
          nouns: [...new Set(nouns)],
          kind: spriteWord(value.kind),
          sprite: spriteWord(value.sprite),
          state: spriteWord(value.state),
          category: spriteWord(value.category),
          cue: spriteWord(value.cue),
          verbs: Array.isArray(value.verbs)
            ? [...new Set(value.verbs.map(commandWord).filter(Boolean))].slice(0, 6)
            : [],
          position:
            value.position && typeof value.position === 'object'
              ? { x: Number(value.position.x), y: Number(value.position.y) }
              : null,
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
    ['market-stall', ['market-stall', 'stall', 'vendor']],
    ['dead-tree', ['dead-tree', 'dead-oak', 'snag']],
    ['bookshelf', ['bookshelf', 'bookcase', 'shelf', 'books']],
    ['gravestone', ['gravestone', 'headstone', 'grave', 'tombstone']],
    ['mushrooms', ['mushroom', 'mushrooms', 'fungus']],
    ['campfire', ['campfire', 'camp-fire', 'firepit']],
    ['brazier', ['brazier', 'fire-basket']],
    ['reeds', ['reeds', 'cattails']],
    ['chains', ['chains', 'shackles']],
    ['rubble', ['rubble', 'debris']],
    ['crates', ['crate', 'crates']],
    ['anvil', ['anvil', 'forge']],
    ['bench', ['bench', 'pew']],
    ['cart', ['cart', 'wagon']],
    ['bed', ['bed', 'cot']],
    ['rug', ['rug', 'carpet']],
    ['loot', ['loot', 'coins', 'satchel', 'treasure']],
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

export function roomSceneTargetCommand(target, verb = 'look') {
  const action = commandWord(verb) || 'look';
  const noun = (target.nouns || []).map(commandNoun).find(Boolean);
  return noun ? `${action} ${noun}` : '';
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

export function roomSceneOccupantPosition(index, occupant = {}, targets = []) {
  const anchor = spriteWord(occupant.anchor_id);
  const target = anchor ? targets.find((candidate) => spriteWord(candidate.id) === anchor) : null;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    const side = target.x > 68 ? -1 : target.x < 32 ? 1 : occupant.kind === 'npc' ? 1 : -1;
    return { x: Math.max(10, Math.min(90, target.x + side * 7)), y: Math.max(24, Math.min(80, target.y + 3)) };
  }
  if (occupant.fighting) {
    return occupant.hostile ? { x: 56 + (index % 2) * 4, y: 63 + (index % 3) * 4 } : { x: 41 - (index % 2) * 6, y: 63 + (index % 3) * 4 };
  }
  return OCCUPANT_POSITIONS[index % OCCUPANT_POSITIONS.length];
}

export function roomSceneBuildingPosition(index) {
  return BUILDING_POSITIONS[index % BUILDING_POSITIONS.length];
}

export function roomSceneTargetPosition(index, target = {}) {
  const x = Number(target.position?.x);
  const y = Number(target.position?.y);
  if (Number.isFinite(x) && Number.isFinite(y) && x >= 8 && x <= 92 && y >= 24 && y <= 82) {
    return { x, y };
  }
  return TARGET_POSITIONS[index % TARGET_POSITIONS.length];
}

export function roomSceneWeaponSprite(weapon) {
  const key = spriteWord(weapon);
  if (!key) return null;
  if (key.includes('great-axe') || key.includes('greataxe')) return 'great-axe';
  if (key.includes('great-sword') || key.includes('greatsword')) return 'great-sword';
  if (key.includes('spear') || key.includes('polearm') || key.includes('staff')) return 'spear';
  if (key.includes('maul')) return 'maul';
  if (key.includes('hammer') || key.includes('mace')) return 'hammer';
  if (key.includes('axe')) return 'axe';
  if (key.includes('sword') || key.includes('blade') || key.includes('dagger')) return 'sword';
  return null;
}

export function roomSceneExitKind(direction, detail = {}) {
  const explicit = spriteWord(detail.kind);
  if (['cave', 'door', 'gate', 'path', 'portal', 'stairs'].includes(explicit)) return explicit;
  const key = spriteWord(direction);
  if (key === 'up' || key === 'down') return 'stairs';
  return 'path';
}

export function roomSceneAtmosphere(scene = {}) {
  const time = spriteWord(scene.time);
  const weather = spriteWord(scene.weather);
  const lighting = spriteWord(scene.lighting);
  return {
    time: time === 'twilight' ? 'dusk' : ['dawn', 'day', 'dusk', 'night'].includes(time) ? time : 'day',
    weather: ['ash', 'clear', 'fog', 'rain', 'sand', 'snow'].includes(weather) ? weather : 'clear',
    lighting: ['bright', 'dim', 'dark', 'fire', 'magic', 'normal'].includes(lighting) ? lighting : 'normal',
  };
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
