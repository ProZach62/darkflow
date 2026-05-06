import { getRoom, getCurrentRoomId, getRoomsByArea } from './map-data.js';

const TILE_SIZE = 32;
const MAP_DIRECTIONS = new Set([
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down',
]);
let lastRenderDebug = null;

// Priority order: more specific terrains first
const TERRAIN_PRIORITY = [
  'city', 'road', 'path', 'forest', 'jungle', 'canopy',
  'plains', 'farm', 'hills', 'mountain', 'desert',
  'sea', 'lake', 'river', 'beach', 'swamp', 'arctic',
  'underground', 'inside', 'barren', 'underwater', 'sky', 'outside',
];

function getTerrainName(environment) {
  if (!environment) return 'outside';
  const terrains = environment.toLowerCase().split(/,\s*| and /);
  for (const t of TERRAIN_PRIORITY) {
    if (terrains.includes(t)) return t;
  }
  return 'outside';
}

export function renderMap(bodyEl) {
  const currentId = getCurrentRoomId();
  const currentRoom = currentId ? getRoom(currentId) : null;

  if (!currentRoom || currentRoom.x === null) {
    bodyEl.innerHTML = '<div class="map-grid map-empty">'
      + '<div class="map-empty-msg">No map data yet.<br>Explore to build the map.</div></div>';
    return;
  }

  const bodyWidth = bodyEl.clientWidth || 320;
  const bodyHeight = bodyEl.clientHeight || 240;

  // How many tiles fit in the panel
  const tilesX = Math.max(3, Math.floor(bodyWidth / TILE_SIZE));
  const tilesY = Math.max(3, Math.floor(bodyHeight / TILE_SIZE));

  // Ensure odd numbers so player is centered
  const gridW = tilesX % 2 === 0 ? tilesX - 1 : tilesX;
  const gridH = tilesY % 2 === 0 ? tilesY - 1 : tilesY;
  const radiusX = (gridW - 1) / 2;
  const radiusY = (gridH - 1) / 2;

  const cx = currentRoom.x;
  const cy = currentRoom.y;
  const cz = currentRoom.z;

  const areaRooms = getRoomsByArea(currentRoom.area);
  const distances = buildConnectedDistances(currentRoom, Math.max(gridW, gridH) + 8);
  const buckets = new Map();
  const visibleBounds = {
    minX: cx - radiusX,
    maxX: cx + radiusX,
    minY: cy - radiusY,
    maxY: cy + radiusY,
  };
  const connectedVisibleCount = countVisibleConnectedRooms(areaRooms, distances, cz, visibleBounds);

  for (const room of areaRooms) {
    if (room.z === cz) {
      const key = room.x + ',' + room.y;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(room);
    }
  }

  // Build grid HTML
  let html = '<div class="map-grid" style="'
    + 'grid-template-columns:repeat(' + gridW + ',' + TILE_SIZE + 'px);'
    + 'grid-template-rows:repeat(' + gridH + ',' + TILE_SIZE + 'px)">';

  for (let ry = 0; ry < gridH; ry++) {
    for (let rx = 0; rx < gridW; rx++) {
      const worldX = cx - radiusX + rx;
      const worldY = cy - radiusY + ry;
      const bucket = buckets.get(worldX + ',' + worldY) || [];
      const room = chooseRoomForTile(bucket, currentId, distances, connectedVisibleCount);

      if (!room) {
        html += '<div class="map-tile"></div>';
      } else if (room.id === currentId) {
        const terrain = getTerrainName(room.environment);
        html += '<div class="map-tile map-tile-' + terrain
          + ' map-tile-player' + conflictClass(bucket)
          + '" title="' + escAttr(tileTitle(room, bucket)) + '"></div>';
      } else {
        const terrain = getTerrainName(room.environment);
        html += '<div class="map-tile map-tile-' + terrain
          + conflictClass(bucket)
          + '" title="' + escAttr(tileTitle(room, bucket)) + '"></div>';
      }
    }
  }

  html += '</div>';

  // Z-level indicator overlay
  const hasUp = currentRoom.exits && currentRoom.exits.up !== undefined;
  const hasDown = currentRoom.exits && currentRoom.exits.down !== undefined;
  if (hasUp || hasDown || cz !== 0) {
    html += '<div class="map-zlevel">';
    if (hasUp) html += '<span class="map-zlevel-arrow">&#x25B2;</span> ';
    html += 'Z:' + cz;
    if (hasDown) html += ' <span class="map-zlevel-arrow">&#x25BC;</span>';
    html += '</div>';
  }

  bodyEl.innerHTML = html;

  lastRenderDebug = {
    currentRoom: {
      id: currentRoom.id.slice(0, 8),
      name: currentRoom.name,
      area: currentRoom.area,
      coords: cx + ',' + cy + ',' + cz,
      exits: currentRoom.exits ? Object.keys(currentRoom.exits) : [],
    },
    areaRoomCount: areaRooms.length,
    connectedRoomCount: distances.size,
    connectedVisibleCount,
    visibleBucketCount: countVisibleBuckets(buckets, visibleBounds),
    grid: { width: gridW, height: gridH },
  };
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildConnectedDistances(startRoom, maxDistance) {
  const distances = new Map();
  const queue = [startRoom.id];
  let head = 0;

  distances.set(startRoom.id, 0);

  while (head < queue.length) {
    const id = queue[head++];
    const room = getRoom(id);
    const distance = distances.get(id);

    if (!room || distance >= maxDistance || !room.exits) continue;

    for (const [dir, destId] of Object.entries(room.exits)) {
      if (!MAP_DIRECTIONS.has(dir) || !destId || distances.has(destId)) continue;

      const dest = getRoom(destId);
      if (!dest || dest.area !== startRoom.area) continue;

      distances.set(destId, distance + 1);
      queue.push(destId);
    }
  }

  return distances;
}

function chooseRoomForTile(bucket, currentId, distances, connectedVisibleCount) {
  let best = null;
  let bestDistance = Infinity;

  for (const room of bucket) {
    if (room.id === currentId) return room;

    const distance = distances.get(room.id);
    if (distance === undefined) continue;
    if (distance < bestDistance) {
      best = room;
      bestDistance = distance;
    }
  }

  if (best) return best;

  // If the known exit graph is sparse or one-way in this area, do not leave the
  // map black. Fall back to the positioned room in this coordinate bucket.
  if (connectedVisibleCount < 3 && bucket.length) return bucket[0];

  return bucket.length === 1 ? bucket[0] : null;
}

function conflictClass(bucket) {
  return bucket.length > 1 ? ' map-tile-conflict' : '';
}

function tileTitle(room, bucket) {
  if (bucket.length <= 1) return room.name;

  const names = bucket.slice(0, 6).map((entry) => entry.name || 'Unknown');
  const suffix = bucket.length > names.length ? '\n+' + (bucket.length - names.length) + ' more' : '';
  return room.name + '\n' + bucket.length + ' mapped rooms share this coordinate:\n'
    + names.join('\n') + suffix;
}

function countVisibleConnectedRooms(areaRooms, distances, z, bounds) {
  let count = 0;

  for (const room of areaRooms) {
    if (room.z !== z) continue;
    if (room.x < bounds.minX || room.x > bounds.maxX) continue;
    if (room.y < bounds.minY || room.y > bounds.maxY) continue;
    if (distances.has(room.id)) count++;
  }

  return count;
}

function countVisibleBuckets(buckets, bounds) {
  let count = 0;

  for (const key of buckets.keys()) {
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (x < bounds.minX || x > bounds.maxX) continue;
    if (y < bounds.minY || y > bounds.maxY) continue;
    count++;
  }

  return count;
}

if (typeof window !== 'undefined') {
  window.mapRenderDebug = function mapRenderDebug() {
    return lastRenderDebug;
  };
}
