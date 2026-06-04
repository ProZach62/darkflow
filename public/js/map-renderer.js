import * as mapData from './map-data-v2.js';

const TILE_SIZE = 32;
// Gap between room boxes. Rooms are drawn as separate boxes spaced apart, with
// connector lines bridging the gap between connected neighbours.
const TILE_GAP = 8;
const MAP_DIRECTIONS = new Set([
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down',
]);
let lastRenderDebug = null;

const CARDINAL_DIRS = [
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
];

// Remember the last room the player occupied that had a coordinate, per area.
// When the player steps into a room the server has not positioned yet, we keep
// the view parked on this spot instead of blanking the whole panel.
const lastCenterByArea = new Map();

// Pick a coordinate to center the grid on when the player's own room has no
// coordinate. Prefer the last positioned room we centered on for this area;
// otherwise fall back to the area room nearest the centroid so the view is
// stable rather than jumping to an arbitrary edge room.
function pickCenterRoom(area, areaRooms, source) {
  const lastId = lastCenterByArea.get(area);
  if (lastId) {
    const last = source.getRoom(lastId);
    if (last && last.area === area && last.x !== null) return last;
  }

  let sumX = 0;
  let sumY = 0;
  for (const room of areaRooms) {
    sumX += room.x;
    sumY += room.y;
  }
  const cx = sumX / areaRooms.length;
  const cy = sumY / areaRooms.length;

  let best = areaRooms[0];
  let bestDist = Infinity;
  for (const room of areaRooms) {
    const dx = room.x - cx;
    const dy = room.y - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      best = room;
      bestDist = dist;
    }
  }
  return best;
}

// Child spans drawn in the gap outside a room box for each cardinal exit:
//  - a CONNECTOR line bridging to an adjacent mapped neighbour, or
//  - a shorter STUB tick toward an exit whose destination is not mapped yet
//    (so the player can see where there is still more to explore -- the map
//    grows visibly as you walk, mirroring Mudlet's exit stubs).
function buildExitSpans(room, cz, source) {
  if (!room || !room.exits) return '';
  let spans = '';
  for (const [dir, abbr] of CARDINAL_DIRS) {
    const destId = room.exits[dir];
    if (!destId) continue;
    const dest = source.getRoom(destId);
    if (!dest || dest.x === null) {
      spans += '<span class="map-stub map-stub-' + abbr + '"></span>';
      continue;
    }
    if (dest.z !== cz) continue;
    const offset = source.DIR_OFFSETS[dir];
    if (dest.x === room.x + offset.dx && dest.y === room.y + offset.dy) {
      spans += '<span class="map-conn map-conn-' + abbr + '"></span>';
    }
    // Connected room positioned elsewhere (not adjacent): no drawable line.
  }
  return spans;
}

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
  const source = mapData;
  const currentId = source.getCurrentRoomId();
  const currentRoom = currentId ? source.getRoom(currentId) : null;

  // The player's room is only a usable render center when it has a coordinate.
  const playerRoom = currentRoom && currentRoom.x !== null ? currentRoom : null;
  const playerId = playerRoom ? playerRoom.id : null;

  // Decide what to center the grid on. If the player's room is positioned we
  // center on it. If it is not (a room the server has not laid out yet) we do
  // NOT blank the map: we keep showing the surrounding area parked on the last
  // known position, with a "locating" indicator, so a single unpositioned room
  // never wipes everything the player has already explored.
  let centerRoom = playerRoom;
  let pending = false;

  if (!centerRoom) {
    const area = currentRoom ? currentRoom.area : null;
    const areaRooms = area ? source.getRoomsByArea(area) : [];
    if (!area || areaRooms.length === 0) {
      const message = currentRoom
        ? 'Locating you...<br>Keep exploring this area.'
        : 'No map data yet.<br>Explore to build the map.';
      bodyEl.innerHTML = '<div class="map-grid map-empty">'
        + '<div class="map-empty-msg">' + message + '</div></div>';
      return;
    }
    centerRoom = pickCenterRoom(area, areaRooms, source);
    pending = true;
  } else if (centerRoom.area) {
    // Remember where we are so we can park here if the next room is unpositioned.
    lastCenterByArea.set(centerRoom.area, centerRoom.id);
  }

  const bodyWidth = bodyEl.clientWidth || 320;
  const bodyHeight = bodyEl.clientHeight || 240;

  // How many tiles fit in the panel (each cell is a tile plus the gap to the next)
  const pitch = TILE_SIZE + TILE_GAP;
  const tilesX = Math.max(3, Math.floor((bodyWidth + TILE_GAP) / pitch));
  const tilesY = Math.max(3, Math.floor((bodyHeight + TILE_GAP) / pitch));

  // Ensure odd numbers so player is centered
  const gridW = tilesX % 2 === 0 ? tilesX - 1 : tilesX;
  const gridH = tilesY % 2 === 0 ? tilesY - 1 : tilesY;
  const radiusX = (gridW - 1) / 2;
  const radiusY = (gridH - 1) / 2;

  const cx = centerRoom.x;
  const cy = centerRoom.y;
  const cz = centerRoom.z;

  const areaRooms = source.getRoomsByArea(centerRoom.area);
  const distances = buildConnectedDistances(centerRoom, Math.max(gridW, gridH) + 8, source);
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
    + 'gap:' + TILE_GAP + 'px;'
    + 'grid-template-columns:repeat(' + gridW + ',' + TILE_SIZE + 'px);'
    + 'grid-template-rows:repeat(' + gridH + ',' + TILE_SIZE + 'px)">';

  for (let ry = 0; ry < gridH; ry++) {
    for (let rx = 0; rx < gridW; rx++) {
      const worldX = cx - radiusX + rx;
      const worldY = cy - radiusY + ry;
      const bucket = buckets.get(worldX + ',' + worldY) || [];
      const room = chooseRoomForTile(bucket, playerId, distances, connectedVisibleCount);

      if (!room) {
        html += '<div class="map-tile"></div>';
      } else if (room.id === playerId) {
        const terrain = getTerrainName(room.environment);
        html += '<div class="map-tile map-tile-room map-tile-' + terrain
          + ' map-tile-player' + conflictClass(bucket)
          + '" title="' + escAttr(tileTitle(room, bucket)) + '">'
          + buildExitSpans(room, cz, source) + '</div>';
      } else {
        const terrain = getTerrainName(room.environment);
        const lastPos = pending && room.id === centerRoom.id ? ' map-tile-lastpos' : '';
        html += '<div class="map-tile map-tile-room map-tile-' + terrain
          + conflictClass(bucket) + lastPos
          + '" title="' + escAttr(tileTitle(room, bucket)) + '">'
          + buildExitSpans(room, cz, source) + '</div>';
      }
    }
  }

  html += '</div>';

  // Z-level indicator overlay. Reflects the room the player is in when known,
  // otherwise the parked center room.
  const zRoom = playerRoom || centerRoom;
  const hasUp = zRoom.exits && zRoom.exits.up !== undefined;
  const hasDown = zRoom.exits && zRoom.exits.down !== undefined;
  if (hasUp || hasDown || cz !== 0) {
    html += '<div class="map-zlevel">';
    if (hasUp) html += '<span class="map-zlevel-arrow">&#x25B2;</span> ';
    html += 'Z:' + cz;
    if (hasDown) html += ' <span class="map-zlevel-arrow">&#x25BC;</span>';
    html += '</div>';
  }

  // Name the room the player is actually in (even if it is not positioned yet).
  const nameRoom = currentRoom || centerRoom;
  html += '<div class="map-roomname">' + escAttr(nameRoom.name) + '</div>';
  html += '<div class="map-compass">N&#x2191;</div>';
  if (pending) {
    html += '<div class="map-pending">&#x25C9; Locating you...</div>';
  } else {
    const status = source.getMapStatus();
    if (status) html += '<div class="map-status">' + escAttr(status) + '</div>';
  }
  html += '<button class="map-resync-btn" title="Clear and resync map for this area">Resync</button>';

  bodyEl.innerHTML = html;

  const resyncBtn = bodyEl.querySelector('.map-resync-btn');
  if (resyncBtn) {
    resyncBtn.addEventListener('click', () => {
      const area = (currentRoom || centerRoom).area;
      if (area) source.clearMapDataForArea(area);
    });
  }

  lastRenderDebug = {
    pending,
    currentRoom: currentRoom ? {
      id: currentRoom.id.slice(0, 8),
      name: currentRoom.name,
      area: currentRoom.area,
      positioned: currentRoom.x !== null,
      exits: currentRoom.exits ? Object.keys(currentRoom.exits) : [],
    } : null,
    centerRoom: {
      id: centerRoom.id.slice(0, 8),
      name: centerRoom.name,
      coords: cx + ',' + cy + ',' + cz,
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

function buildConnectedDistances(startRoom, maxDistance, source) {
  const distances = new Map();
  const queue = [startRoom.id];
  let head = 0;

  distances.set(startRoom.id, 0);

  while (head < queue.length) {
    const id = queue[head++];
    const room = source.getRoom(id);
    const distance = distances.get(id);

    if (!room || distance >= maxDistance || !room.exits) continue;

    for (const [dir, destId] of Object.entries(room.exits)) {
      if (!MAP_DIRECTIONS.has(dir) || !destId || distances.has(destId)) continue;

      const dest = source.getRoom(destId);
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
