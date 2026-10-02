// Pure geometry and presentation choices shared by the isometric renderer and
// its Node tests. MapData2 coordinates use north as y - 1.
export const ISO_TILE_WIDTH = 128;
export const ISO_TILE_HEIGHT = 64;
export const ISO_FLOOR_LIFT = 48;

const TERRAIN_COLORS = Object.freeze({
  arctic: 0xdce9e8,
  barren: 0x766f63,
  beach: 0xd4bd78,
  bridge: 0x8b6842,
  canopy: 0x244d32,
  city: 0x777a78,
  desert: 0xc99b54,
  farm: 0x8e9b4c,
  forest: 0x315f3b,
  hills: 0x657947,
  inside: 0x765b43,
  jungle: 0x28583a,
  lake: 0x39799b,
  mountain: 0x686d6c,
  outside: 0x62744b,
  path: 0x967d57,
  plains: 0x779556,
  river: 0x387b9d,
  road: 0x81796b,
  sea: 0x2d6488,
  sky: 0x7798aa,
  swamp: 0x4f694c,
  underground: 0x4d4742,
  underwater: 0x285f70,
});
const TERRAIN_SPRITES = new Set(Object.keys(TERRAIN_COLORS));

/** Projects one MapData2 coordinate relative to the camera's world center. */
export function projectIso(x, y, z = 0, options = {}) {
  const width = Number(options.width) || ISO_TILE_WIDTH;
  const height = Number(options.height) || ISO_TILE_HEIGHT;
  const floorLift = Number(options.floorLift) || ISO_FLOOR_LIFT;
  const centerX = Number(options.centerX) || 0;
  const centerY = Number(options.centerY) || 0;
  const centerZ = Number(options.centerZ) || 0;
  const dx = x - centerX;
  const dy = y - centerY;
  return {
    x: (dx - dy) * width / 2,
    y: (dx + dy) * height / 2 - (z - centerZ) * floorLift,
  };
}

/** Inverts the ground-plane projection for pointer hit tests and camera math. */
export function unprojectIso(screenX, screenY, options = {}) {
  const width = Number(options.width) || ISO_TILE_WIDTH;
  const height = Number(options.height) || ISO_TILE_HEIGHT;
  const centerX = Number(options.centerX) || 0;
  const centerY = Number(options.centerY) || 0;
  return {
    x: centerX + screenX / width + screenY / height,
    y: centerY - screenX / width + screenY / height,
  };
}

/** Back-to-front key for a 2:1 isometric scene. */
export function isoDepthKey(room, layer = 0) {
  return ((Number(room.x) + Number(room.y)) * 10000) + (Number(room.z) * 100) + layer;
}

export function isoTerrainColor(terrain) {
  return TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS.outside;
}

/** Restricts server terrain vocabulary to bundled sprite filenames. */
export function isoTerrainSprite(terrain) {
  const key = String(terrain ?? '').trim().toLocaleLowerCase();
  return TERRAIN_SPRITES.has(key) ? key : 'outside';
}

/** Stable small variant number, so a room never changes appearance on redraw. */
export function isoRoomVariant(roomId, variants = 3) {
  const count = Math.max(1, Math.floor(Number(variants) || 1));
  let hash = 2166136261;
  for (const char of String(roomId)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

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

function spriteWord(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Resolves server room-detail vocabulary to the painted building set. */
export function isoBuildingSprite(detail) {
  const key = spriteWord(detail);
  if (key === 'post-office') return 'post';
  return BUILDING_SPRITES[key] ?? null;
}

/** Chooses a stable painted figure from optional occupant appearance hints. */
export function isoOccupantSprite(occupant = {}) {
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

/** Whether a projected diamond can affect the viewport, with an overscan margin. */
export function isoVisible(point, viewport, margin = ISO_TILE_WIDTH) {
  return point.x >= -margin
    && point.x <= viewport.width + margin
    && point.y >= -margin * 2
    && point.y <= viewport.height + margin * 2;
}
