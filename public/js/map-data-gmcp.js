export const DIR_OFFSETS = {
  north:     { dx:  0, dy: -1, dz: 0 },
  south:     { dx:  0, dy:  1, dz: 0 },
  east:      { dx:  1, dy:  0, dz: 0 },
  west:      { dx: -1, dy:  0, dz: 0 },
  northeast: { dx:  1, dy: -1, dz: 0 },
  northwest: { dx: -1, dy: -1, dz: 0 },
  southeast: { dx:  1, dy:  1, dz: 0 },
  southwest: { dx: -1, dy:  1, dz: 0 },
  up:        { dx:  0, dy:  0, dz: 1 },
  down:      { dx:  0, dy:  0, dz:-1 },
};

const STORAGE_PREFIX = 'darkflow-gmcp-map:';
const DEFAULT_WORLD_KEY = 'unknown-world';
const SCHEMA_VERSION = 1;
const MAP_STATUS_TTL_MS = 6000;
const SAVE_DEBOUNCE_MS = 200;
const TRUSTED_COORD_SAMPLE_MIN = 4;

let rooms = new Map();
let currentRoomId = null;
let currentAreaName = '';
let active = false;
let worldKey = DEFAULT_WORLD_KEY;
let mapStatusMessage = '';
let mapStatusAt = 0;
let saveTimer = null;
let lastRoomId = null;
let coordStatsByArea = new Map();

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function storageKey() {
  return STORAGE_PREFIX + worldKey;
}

function safeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_WORLD_KEY;
}

function roomIdFrom(data) {
  return normalizeRoomId(data && (data.num !== undefined ? data.num
    : data.id !== undefined ? data.id
    : data.vnum));
}

function areaFrom(data) {
  if (!data) return 'Unknown';
  if (data.area !== undefined && data.area !== null && data.area !== '') return String(data.area);
  if (data.zone !== undefined && data.zone !== null && data.zone !== '') return 'Zone ' + data.zone;
  return 'Unknown';
}

function exitKind(dir) {
  return DIR_OFFSETS[dir] ? (dir === 'up' || dir === 'down' ? 'vertical' : 'spatial') : 'special';
}

function doorStateNumber(state) {
  const text = String(state || '').toLowerCase();
  if (text === 'locked') return 3;
  if (text === 'closed') return 2;
  return 1;
}

function normalizeExits(data) {
  const exits = {};
  const exitKinds = {};
  const exitDoors = {};
  const rawExits = data && data.exits && typeof data.exits === 'object' ? data.exits : {};
  const rawStates = data && data.exit_states && typeof data.exit_states === 'object' ? data.exit_states : {};

  for (const [dir, dest] of Object.entries(rawExits)) {
    exitKinds[dir] = exitKind(dir);
    if (typeof dest === 'string' && !/^-?\d+$/.test(dest)) {
      exitDoors[dir] = doorStateNumber(dest);
      continue;
    }
    if (dest !== null && dest !== undefined && dest !== '') exits[dir] = normalizeRoomId(dest);
  }

  for (const [dir, state] of Object.entries(rawStates)) {
    exitKinds[dir] = exitKind(dir);
    exitDoors[dir] = doorStateNumber(state);
  }

  return { exits, exitKinds, exitDoors };
}

function getRawCoords(data) {
  const x = data && data.coord_x !== undefined ? Number(data.coord_x)
    : data && data.coords && data.coords.x !== undefined ? Number(data.coords.x) : NaN;
  const y = data && data.coord_y !== undefined ? Number(data.coord_y)
    : data && data.coords && data.coords.y !== undefined ? Number(data.coords.y) : NaN;
  const z = data && data.coord_z !== undefined ? Number(data.coord_z)
    : data && data.coords && data.coords.z !== undefined ? Number(data.coords.z) : NaN;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function coordKey(coords) {
  return coords.x + ',' + coords.y + ',' + coords.z;
}

function coordStats(area) {
  let stats = coordStatsByArea.get(area);
  if (!stats) {
    stats = { sample: 0, coords: new Set(), trusted: false };
    coordStatsByArea.set(area, stats);
  }
  return stats;
}

function noteCoords(area, coords) {
  if (!coords) return false;
  const stats = coordStats(area);
  stats.sample++;
  stats.coords.add(coordKey(coords));
  if (stats.sample >= TRUSTED_COORD_SAMPLE_MIN && stats.coords.size >= TRUSTED_COORD_SAMPLE_MIN) {
    stats.trusted = true;
  }
  return stats.trusted;
}

function rebuildCoordStats() {
  coordStatsByArea.clear();
  for (const room of rooms.values()) {
    if (room.rawCoords) noteCoords(room.area, room.rawCoords);
  }
}

function applyTrustedCoords(area) {
  const stats = coordStatsByArea.get(area);
  if (!stats || !stats.trusted) return;
  for (const room of rooms.values()) {
    if (room.area !== area || !room.rawCoords) continue;
    room.x = room.rawCoords.x;
    room.y = room.rawCoords.y;
    room.z = room.rawCoords.z;
    room.coordSource = 'gmcp';
    room.positioned = true;
  }
}

function coordsOccupied(area, x, y, z, exceptId) {
  for (const room of rooms.values()) {
    if (room.id === exceptId || room.area !== area || room.x === null) continue;
    if (room.x === x && room.y === y && room.z === z) return true;
  }
  return false;
}

function inferCoords(roomId, area, exits) {
  const previous = currentRoomId ? rooms.get(currentRoomId) : null;
  if (previous && previous.area === area && previous.x !== null) {
    for (const [dir, destId] of Object.entries(previous.exits || {})) {
      if (destId !== roomId) continue;
      const offset = DIR_OFFSETS[dir];
      if (!offset) continue;
      const x = previous.x + offset.dx;
      const y = previous.y + offset.dy;
      const z = previous.z + offset.dz;
      if (!coordsOccupied(area, x, y, z, roomId)) return { x, y, z, source: 'inferred' };
      setMapStatus('Map layout conflict near ' + (previous.name || 'previous room'));
      return null;
    }
  }

  if (previous && previous.area === area && previous.x !== null) {
    for (const [dir, destId] of Object.entries(exits || {})) {
      if (destId !== previous.id) continue;
      const offset = DIR_OFFSETS[dir];
      if (!offset) continue;
      const x = previous.x - offset.dx;
      const y = previous.y - offset.dy;
      const z = previous.z - offset.dz;
      if (!coordsOccupied(area, x, y, z, roomId)) return { x, y, z, source: 'inferred' };
      setMapStatus('Map layout conflict near ' + (previous.name || 'previous room'));
      return null;
    }
  }

  if (!previous || previous.area !== area) {
    if (!coordsOccupied(area, 0, 0, 0, roomId)) return { x: 0, y: 0, z: 0, source: 'seed' };
  }
  return null;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPendingMapSave();
  }, SAVE_DEBOUNCE_MS);
}

export function setMapStatus(msg) {
  mapStatusMessage = msg;
  mapStatusAt = Date.now();
}

export function configureWorld(identity = {}) {
  const nextKey = safeSlug([
    identity.name || identity.host || 'world',
    identity.host || '',
    identity.port || '',
  ].filter(Boolean).join('@'));
  if (nextKey === worldKey) return;
  flushPendingMapSave();
  worldKey = nextKey;
  load();
}

export function resetForConnection() {
  active = false;
  currentRoomId = null;
  currentAreaName = '';
  lastRoomId = null;
  mapStatusMessage = '';
}

export function processHello(data, connection = {}) {
  configureWorld({
    name: data && data.name,
    host: connection.host,
    port: connection.port,
  });
}

export function processRoomInfo(data) {
  const id = roomIdFrom(data);
  if (!id) return 0;

  const area = areaFrom(data);
  const rawCoords = getRawCoords(data);
  const coordsTrusted = noteCoords(area, rawCoords);
  const normalized = normalizeExits(data || {});
  const existing = rooms.get(id) || {};

  const next = {
    id,
    name: (data && data.name) || existing.name || '',
    area,
    environment: (data && (data.environment || data.terrain || data.env)) || existing.environment || '',
    exits: normalized.exits,
    exitKinds: normalized.exitKinds,
    exitDoors: normalized.exitDoors,
    rawCoords: rawCoords || existing.rawCoords || null,
    x: existing.x !== undefined ? existing.x : null,
    y: existing.y !== undefined ? existing.y : null,
    z: existing.z !== undefined ? existing.z : null,
    coordSource: existing.coordSource || '',
    positioned: false,
    version: 0,
  };

  if (coordsTrusted && rawCoords) {
    next.x = rawCoords.x;
    next.y = rawCoords.y;
    next.z = rawCoords.z;
    next.coordSource = 'gmcp';
  } else if (next.x === null || next.x === undefined) {
    const inferred = inferCoords(id, area, next.exits);
    if (inferred) {
      next.x = inferred.x;
      next.y = inferred.y;
      next.z = inferred.z;
      next.coordSource = inferred.source;
    }
  }
  next.positioned = next.x !== null && next.x !== undefined;

  rooms.set(id, Object.assign(existing, next));
  if (coordsTrusted) applyTrustedCoords(area);
  lastRoomId = currentRoomId;
  currentRoomId = id;
  currentAreaName = area;
  active = true;
  if (!next.positioned) setMapStatus('Locating ' + (next.name || 'current room') + '...');
  save();
  return 1;
}

export function flushPendingMapSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const data = {};
    for (const [id, room] of rooms) data[id] = room;
    localStorage.setItem(storageKey(), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      active,
      currentRoomId,
      currentAreaName,
      rooms: data,
    }));
  } catch (e) {
    // Ignore localStorage failures; the live in-memory map still works.
  }
}

export function load() {
  rooms.clear();
  currentRoomId = null;
  currentAreaName = '';
  active = false;
  lastRoomId = null;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(storageKey());
      return;
    }
    active = !!data.active;
    currentRoomId = normalizeRoomId(data.currentRoomId);
    currentAreaName = data.currentAreaName || '';
    if (data.rooms) {
      for (const [id, room] of Object.entries(data.rooms)) {
        room.id = normalizeRoomId(room.id) || normalizeRoomId(id);
        rooms.set(room.id, room);
      }
    }
    rebuildCoordStats();
  } catch (e) {
    rooms.clear();
  }
}

export function clearMapDataForArea(area) {
  if (!area) return;
  for (const [id, room] of rooms) {
    if (room.area === area) rooms.delete(id);
  }
  if (currentRoomId && !rooms.has(currentRoomId)) currentRoomId = null;
  coordStatsByArea.delete(area);
  setMapStatus('Cleared ' + area + '. Explore to rebuild it.');
  save();
}

export function clearMapData() {
  rooms.clear();
  currentRoomId = null;
  currentAreaName = '';
  active = false;
  lastRoomId = null;
  coordStatsByArea.clear();
  try {
    localStorage.removeItem(storageKey());
  } catch (e) {}
}

export function isActive() {
  return active;
}

export function hasCurrentRoom() {
  return !!currentRoomId;
}

export function hasPositionedCurrentRoom() {
  const room = currentRoomId ? rooms.get(currentRoomId) : null;
  return !!(room && room.x !== null && room.x !== undefined);
}

export function getCurrentRoomId() {
  return currentRoomId;
}

export function getRoom(id) {
  return rooms.get(normalizeRoomId(id));
}

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null && room.x !== undefined) result.push(room);
  }
  return result;
}

export function getAreaName() {
  return currentAreaName;
}

export function getMapStatus() {
  if (!mapStatusMessage || Date.now() - mapStatusAt > MAP_STATUS_TTL_MS) return '';
  return mapStatusMessage;
}

export function getWorldKey() {
  return worldKey;
}

export function getClearMapActionLabel() {
  return 'Clear';
}

export function getClearMapActionTitle() {
  return 'Clear the learned map for this area';
}
