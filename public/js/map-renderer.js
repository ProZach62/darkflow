import { getRoom, getCurrentRoomId, getRoomsByArea } from './map-data.js';

const TILE_SIZE = 32;

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

  // Get all rooms in the same area on the same z-level
  const areaRooms = getRoomsByArea(currentRoom.area);
  const posMap = new Map();
  for (const room of areaRooms) {
    if (room.z === cz) {
      posMap.set(room.x + ',' + room.y, room);
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
      const room = posMap.get(worldX + ',' + worldY);

      if (!room) {
        html += '<div class="map-tile"></div>';
      } else if (room.id === currentId) {
        const terrain = getTerrainName(room.environment);
        html += '<div class="map-tile map-tile-' + terrain
          + ' map-tile-player" title="' + escAttr(room.name) + '"></div>';
      } else {
        const terrain = getTerrainName(room.environment);
        html += '<div class="map-tile map-tile-' + terrain
          + '" title="' + escAttr(room.name) + '"></div>';
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
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
