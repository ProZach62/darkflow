import { gmcp } from './gmcp.js';

const STORAGE_KEY = 'darkwind-map-data';

const DIR_OFFSETS = {
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

const DIR_ALIASES = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
  up: 'up', down: 'down',
};

// Room graph: roomId → room record
let rooms = new Map();
let currentRoomId = null;
let previousRoomId = null;
let pendingDirection = null;

// Coordinate occupancy per area: "area:x,y,z" → roomId
let coordIndex = new Map();

// Server area versions for incremental sync
let areaVersions = new Map();

// Debug transition log — captures every Room.Info event with context
const debugLog = [];

export function getCurrentRoomId() { return currentRoomId; }

export function getRoom(id) { return rooms.get(id); }

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null) result.push(room);
  }
  return result;
}

export function trackCommand(cmd) {
  const normalized = cmd.trim().toLowerCase().split(/\s+/)[0];
  const dir = DIR_ALIASES[normalized];
  if (dir) pendingDirection = dir;
}

export function processRoomInfo(data) {
  if (!data || !data.num) return null;

  const roomId = data.num;
  const roomChanged = roomId !== currentRoomId;
  const isNew = !rooms.has(roomId);

  // Capture state BEFORE processing
  // Note: at this point currentRoomId = the room we just LEFT (not yet updated)
  const fromRoomId = currentRoomId;
  const pendingDirectionUsed = pendingDirection;
  const entry = {
    ts: new Date().toISOString(),
    roomId: roomId.slice(0, 8),
    name: data.name || '?',
    area: data.area || '?',
    environment: data.environment || '',
    exits: data.exits && typeof data.exits === 'object' ? Object.keys(data.exits) : [],
    pendingDir: pendingDirection,
    fromRoomId: fromRoomId ? fromRoomId.slice(0, 8) : null,
    fromRoomName: fromRoomId && rooms.get(fromRoomId) ? rooms.get(fromRoomId).name : null,
    isNew,
    roomChanged,
    result: null,  // filled after processing
  };

  // Update or create room record
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: data.name || '',
      area: data.area || '',
      environment: data.environment || '',
      exits: {},
      x: null, y: null, z: null,
    };
    rooms.set(roomId, room);
  } else {
    // Update mutable fields
    room.name = data.name || room.name;
    room.area = data.area || room.area;
    room.environment = data.environment || room.environment;
  }

  // Update exits (server sends "" when no exits, object when exits exist)
  if (data.exits && typeof data.exits === 'object') {
    room.exits = {};
    for (const [dir, destId] of Object.entries(data.exits)) {
      room.exits[dir] = destId;
    }
  } else if (data.exits === '') {
    room.exits = {};
  }

  // Assign coordinates if this room has none and we have movement context
  // fromRoomId = currentRoomId = the room we just LEFT (not yet updated)
  if (room.x === null && roomChanged && pendingDirection && fromRoomId) {
    const fromRoom = rooms.get(fromRoomId);
    const offset = DIR_OFFSETS[pendingDirection];
    if (fromRoom && fromRoom.x !== null && offset) {
      const nx = fromRoom.x + offset.dx;
      const ny = fromRoom.y + offset.dy;
      const nz = fromRoom.z + offset.dz;
      const coordKey = room.area + ':' + nx + ',' + ny + ',' + nz;
      if (!coordIndex.has(coordKey)) {
        room.x = nx;
        room.y = ny;
        room.z = nz;
        coordIndex.set(coordKey, roomId);
        entry.result = 'assigned ' + nx + ',' + ny + ',' + nz;
      } else {
        entry.result = 'CONFLICT at ' + nx + ',' + ny + ',' + nz + ' (occupied by ' + coordIndex.get(coordKey).slice(0, 8) + ')';
      }
    } else {
      entry.result = 'no-from-coords';
      if (!fromRoom) entry.result += ' (fromRoom missing)';
      else if (fromRoom.x === null) entry.result += ' (fromRoom unpositioned: ' + fromRoom.name + ')';
      if (!offset) entry.result += ' (bad direction: ' + pendingDirection + ')';
    }
  } else if (room.x === null) {
    if (!roomChanged) entry.result = 'same-room';
    else if (!pendingDirection) entry.result = 'no-pending-dir';
    else if (!fromRoomId) entry.result = 'no-from-room';
    else entry.result = 'already-positioned';
  } else {
    entry.result = 'already-has-coords ' + room.x + ',' + room.y + ',' + room.z;
  }

  // Seed origin: when we have a direction and a fromRoom, but nothing in
  // the area is positioned yet, seed the fromRoom at origin and then
  // position this room relative to it.
  if (room.x === null && roomChanged && pendingDirectionUsed && fromRoomId) {
    const fromRoom = rooms.get(fromRoomId);
    if (fromRoom && fromRoom.x === null) {
      const areaRooms = getRoomsByArea(room.area);
      if (areaRooms.length === 0) {
        const coordKey = fromRoom.area + ':0,0,0';
        if (!coordIndex.has(coordKey)) {
          fromRoom.x = 0;
          fromRoom.y = 0;
          fromRoom.z = 0;
          coordIndex.set(coordKey, fromRoomId);
          // Now position this room relative to the newly seeded fromRoom
          const offset = DIR_OFFSETS[pendingDirectionUsed];
          if (offset) {
            const nx = offset.dx;
            const ny = offset.dy;
            const nz = offset.dz;
            const destKey = room.area + ':' + nx + ',' + ny + ',' + nz;
            if (!coordIndex.has(destKey)) {
              room.x = nx;
              room.y = ny;
              room.z = nz;
              coordIndex.set(destKey, roomId);
              entry.result = 'seeded-origin+assigned ' + nx + ',' + ny + ',' + nz;
            }
          }
        }
      }
    }
  }

  entry.finalCoords = room.x !== null ? room.x + ',' + room.y + ',' + room.z : 'NONE';
  debugLog.push(entry);
  if (debugLog.length > 500) debugLog.shift();

  // Send traversal data to server for collaborative mapping
  if (roomChanged && fromRoomId && pendingDirectionUsed) {
    gmcp.send('Darkwind.MapData.RoomUpdate', {
      id: roomId,
      from_id: fromRoomId,
      direction: pendingDirectionUsed,
      name: room.name,
      area: room.area,
      environment: room.environment,
    });
  }

  if (roomChanged) {
    previousRoomId = currentRoomId;
    currentRoomId = roomId;
  }
  pendingDirection = null;

  save();
  return room;
}

function rebuildCoordIndex() {
  coordIndex.clear();
  for (const room of rooms.values()) {
    if (room.x !== null) {
      coordIndex.set(room.area + ':' + room.x + ',' + room.y + ',' + room.z, room.id);
    }
  }
}

function save() {
  try {
    const data = {};
    for (const [id, room] of rooms) {
      data[id] = room;
    }
    const versions = {};
    for (const [area, ver] of areaVersions) {
      versions[area] = ver;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rooms: data,
      currentRoomId,
      previousRoomId,
      areaVersions: versions,
    }));
  } catch (e) {
    // localStorage full or unavailable — silently ignore
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.rooms) {
      rooms.clear();
      for (const [id, room] of Object.entries(data.rooms)) {
        rooms.set(id, room);
      }
      rebuildCoordIndex();
    }
    if (data.currentRoomId) currentRoomId = data.currentRoomId;
    if (data.previousRoomId) previousRoomId = data.previousRoomId;
    if (data.areaVersions) {
      areaVersions.clear();
      for (const [area, ver] of Object.entries(data.areaVersions)) {
        areaVersions.set(area, ver);
      }
    }
  } catch (e) {
    // Corrupt data — start fresh
    rooms.clear();
    coordIndex.clear();
  }
}

// Receive server-resolved area data (Darkwind.MapData.Area)
// Server coords take priority over client-inferred coords
export function mergeServerAreaData(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return;

  let merged = 0;
  for (const serverRoom of data.rooms) {
    if (!serverRoom.id) continue;

    let room = rooms.get(serverRoom.id);
    if (!room) {
      room = {
        id: serverRoom.id,
        name: serverRoom.name || '',
        area: data.area,
        environment: serverRoom.env || '',
        exits: {},
        x: null, y: null, z: null,
      };
      rooms.set(serverRoom.id, room);
    }

    // Server name/env updates
    if (serverRoom.name) room.name = serverRoom.name;
    if (serverRoom.env) room.environment = serverRoom.env;

    // Server exits
    if (serverRoom.exits && typeof serverRoom.exits === 'object') {
      room.exits = {};
      for (const [dir, destId] of Object.entries(serverRoom.exits)) {
        room.exits[dir] = destId;
      }
    }

    // Server coordinates take priority — remove old coord index entry first
    if (room.x !== null) {
      const oldKey = room.area + ':' + room.x + ',' + room.y + ',' + room.z;
      if (coordIndex.get(oldKey) === room.id) coordIndex.delete(oldKey);
    }

    if (serverRoom.x !== undefined && serverRoom.y !== undefined && serverRoom.z !== undefined) {
      room.x = serverRoom.x;
      room.y = serverRoom.y;
      room.z = serverRoom.z;
      const newKey = data.area + ':' + room.x + ',' + room.y + ',' + room.z;
      coordIndex.set(newKey, room.id);
      merged++;
    }
  }

  if (merged > 0) save();
  return merged;
}

// Receive incremental update (Darkwind.MapData.Update)
// Merges rooms, stores version, and auto-requests next chunk if more available
export function mergeServerUpdate(data) {
  const merged = mergeServerAreaData(data);
  if (data && data.area && data.version !== undefined) {
    areaVersions.set(data.area, data.version);
    save();

    // If server indicates more chunks available, request the next one
    if (data.more) {
      gmcp.send('Darkwind.MapData.Sync', {
        area: data.area,
        version: data.version,
      });
    }
  }
  return merged;
}

// Request a full resync for an area (sends Darkwind.MapData.Sync with version 0)
export function requestAreaSync(area) {
  const ver = area ? (areaVersions.get(area) || 0) : 0;
  gmcp.send('Darkwind.MapData.Sync', { area: area, version: ver });
}

export function clearMapData() {
  rooms.clear();
  coordIndex.clear();
  areaVersions.clear();
  currentRoomId = null;
  previousRoomId = null;
  pendingDirection = null;
  localStorage.removeItem(STORAGE_KEY);
}

export { DIR_OFFSETS };

// ── Debug tools (exposed on window.mapDebug) ──────────────────────────

function debugDumpLog() {
  return JSON.parse(JSON.stringify(debugLog));
}

function debugDumpRooms() {
  const out = [];
  for (const room of rooms.values()) {
    out.push({
      id: room.id.slice(0, 8),
      name: room.name,
      area: room.area,
      env: room.environment,
      coords: room.x !== null ? room.x + ',' + room.y + ',' + room.z : 'NONE',
      exits: Object.keys(room.exits),
      exitTargets: Object.fromEntries(
        Object.entries(room.exits).map(([d, id]) => [d, id.slice(0, 8)])
      ),
    });
  }
  return out;
}

function debugDumpConflicts() {
  // Find rooms that have no coordinates
  const unpositioned = [];
  for (const room of rooms.values()) {
    if (room.x === null) {
      unpositioned.push({
        id: room.id.slice(0, 8),
        name: room.name,
        area: room.area,
        exits: Object.keys(room.exits),
      });
    }
  }
  return unpositioned;
}

function debugDumpCoordIndex() {
  const out = {};
  for (const [key, id] of coordIndex) {
    const room = rooms.get(id);
    out[key] = { id: id.slice(0, 8), name: room ? room.name : '?' };
  }
  return out;
}

function debugSummary() {
  const total = rooms.size;
  let positioned = 0;
  let unpositioned = 0;
  const areas = {};
  for (const room of rooms.values()) {
    if (room.x !== null) {
      positioned++;
      areas[room.area] = (areas[room.area] || 0) + 1;
    } else {
      unpositioned++;
    }
  }
  return {
    totalRooms: total,
    positioned,
    unpositioned,
    currentRoom: currentRoomId ? currentRoomId.slice(0, 8) : null,
    currentName: currentRoomId && rooms.get(currentRoomId) ? rooms.get(currentRoomId).name : null,
    previousRoom: previousRoomId ? previousRoomId.slice(0, 8) : null,
    pendingDirection,
    roomsByArea: areas,
    recentLog: debugLog.slice(-10),
  };
}

function debugExportAll() {
  return JSON.stringify({
    summary: debugSummary(),
    rooms: debugDumpRooms(),
    unpositioned: debugDumpConflicts(),
    coordIndex: debugDumpCoordIndex(),
    log: debugDumpLog(),
  }, null, 2);
}

// Expose on window for browser console access
if (typeof window !== 'undefined') {
  window.mapDebug = {
    summary: debugSummary,
    rooms: debugDumpRooms,
    log: debugDumpLog,
    conflicts: debugDumpConflicts,
    coordIndex: debugDumpCoordIndex,
    exportAll: debugExportAll,
    clearData: clearMapData,
  };
}
