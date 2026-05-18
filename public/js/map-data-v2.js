import { gmcp } from './gmcp.js';

const STORAGE_KEY = 'darkwind-map-data-v2';
const LEGACY_STORAGE_KEY = 'darkwind-map-data-v3';
const MIGRATION_KEY = 'darkwind-map-data-v2-migration-complete';
const SCHEMA_VERSION = 2;

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

let rooms = new Map();
let currentRoomId = null;
let areaVersions = new Map();
let active = false;
let mapStatusMessage = '';
let mapStatusAt = 0;
let saveTimer = null;
let forceFullSyncOnNextCurrent = false;

const MAP_STATUS_TTL_MS = 6000;
const SAVE_DEBOUNCE_MS = 200;

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function setMapStatus(msg) {
  mapStatusMessage = msg;
  mapStatusAt = Date.now();
}

export function isActive() {
  return active;
}

export function hasCurrentRoom() {
  return !!currentRoomId;
}

export function hasPositionedCurrentRoom() {
  const room = currentRoomId ? rooms.get(currentRoomId) : null;
  return !!(room && room.x !== null);
}

export function getCurrentRoomId() {
  return currentRoomId;
}

export function getRoom(id) {
  return rooms.get(normalizeRoomId(id));
}

export function getMapStatus() {
  if (!mapStatusMessage || Date.now() - mapStatusAt > MAP_STATUS_TTL_MS) return '';
  return mapStatusMessage;
}

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null) result.push(room);
  }
  return result;
}

function normalizeRoomPayload(data, fallbackArea) {
  if (!data || data.id === null || data.id === undefined) return null;
  const room = {
    id: normalizeRoomId(data.id),
    name: data.name || '',
    area: data.area || fallbackArea || '',
    environment: data.env || data.environment || '',
    exits: {},
    exitKinds: {},
    x: data.positioned && data.x !== undefined ? data.x : null,
    y: data.positioned && data.y !== undefined ? data.y : null,
    z: data.positioned && data.z !== undefined ? data.z : null,
    coordSource: data.coordSource || '',
    positioned: !!data.positioned,
    version: data.version || 0,
  };

  if (data.exits && typeof data.exits === 'object') {
    for (const [dir, destId] of Object.entries(data.exits)) {
      room.exits[dir] = normalizeRoomId(destId);
    }
  }
  if (data.exitKinds && typeof data.exitKinds === 'object') {
    room.exitKinds = Object.assign({}, data.exitKinds);
  }

  return room;
}

function mergeRoom(data, fallbackArea) {
  const next = normalizeRoomPayload(data, fallbackArea);
  if (!next) return 0;

  const old = rooms.get(next.id);
  rooms.set(next.id, old ? Object.assign(old, next) : next);
  return 1;
}

function removeAreaRooms(area) {
  for (const [id, room] of rooms) {
    if (id === currentRoomId) continue;
    if (room.area === area) rooms.delete(id);
  }
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPendingMapSave();
  }, SAVE_DEBOUNCE_MS);
}

export function flushPendingMapSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const data = {};
    const versions = {};
    for (const [id, room] of rooms) data[id] = room;
    for (const [area, version] of areaVersions) versions[area] = version;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      active,
      currentRoomId,
      rooms: data,
      areaVersions: versions,
    }));
  } catch (e) {
    // localStorage full or unavailable.
  }
}

function resetInMemoryState() {
  rooms.clear();
  areaVersions.clear();
  currentRoomId = null;
  active = false;
}

function runStorageMigration() {
  try {
    const migrated = localStorage.getItem(MIGRATION_KEY) === String(SCHEMA_VERSION);
    if (!migrated) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(MIGRATION_KEY, String(SCHEMA_VERSION));
      forceFullSyncOnNextCurrent = true;
      setMapStatus('Updating map data...');
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (data.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      forceFullSyncOnNextCurrent = true;
      setMapStatus('Updating map data...');
    }
  } catch (e) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (ignored) {
      // Ignore localStorage failures; the in-memory map will resync live.
    }
    forceFullSyncOnNextCurrent = true;
  }
}

export function load() {
  runStorageMigration();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      forceFullSyncOnNextCurrent = true;
      return;
    }
    active = !!data.active;
    currentRoomId = normalizeRoomId(data.currentRoomId);
    rooms.clear();
    if (data.rooms) {
      for (const [id, room] of Object.entries(data.rooms)) {
        room.id = normalizeRoomId(room.id) || normalizeRoomId(id);
        rooms.set(room.id, room);
      }
    }
    areaVersions.clear();
    if (data.areaVersions) {
      for (const [area, version] of Object.entries(data.areaVersions)) {
        areaVersions.set(area, version);
      }
    }
  } catch (e) {
    resetInMemoryState();
  }
}

export function processCurrent(data) {
  if (!data || data.id === null || data.id === undefined) return 0;
  active = true;
  mergeRoom(data, data.area);
  currentRoomId = normalizeRoomId(data.id);
  if (data.area && data.areaVersion !== undefined) {
    areaVersions.set(data.area, data.areaVersion);
  }
  if (!data.positioned) {
    setMapStatus('Map layout pending for ' + (data.name || 'current room'));
  }
  if (forceFullSyncOnNextCurrent && data.area) {
    forceFullSyncOnNextCurrent = false;
    setMapStatus('Updating map data...');
    requestAreaSync(data.area, true);
  }
  save();
  return 1;
}

export function mergeServerAreaData(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return 0;
  active = true;
  if (data.replace || data.version === undefined) removeAreaRooms(data.area);

  let merged = 0;
  for (const room of data.rooms) {
    merged += mergeRoom(room, data.area);
  }
  if (data.version !== undefined) areaVersions.set(data.area, data.version);
  if (merged || data.replace || data.version !== undefined) save();
  return merged;
}

export function mergeServerUpdate(data) {
  const merged = mergeServerAreaData(data);
  if (data && data.area && data.version !== undefined && data.more) {
    gmcp.send('Darkwind.MapData2.Sync', {
      area: data.area,
      version: data.version,
    });
  }
  return merged;
}

export function requestAreaSync(area, forceFull) {
  if (!area) return;
  gmcp.send('Darkwind.MapData2.Sync', {
    area,
    version: forceFull ? 0 : (areaVersions.get(area) || 0),
  });
}

export function clearMapDataForArea(area) {
  if (!area) return;
  removeAreaRooms(area);
  save();
  setMapStatus('Cleared ' + area + ', resyncing...');
  requestAreaSync(area, true);
}

export function clearMapData() {
  resetInMemoryState();
  localStorage.removeItem(STORAGE_KEY);
}
