import { getRoom, getCurrentRoomId, getRoomsByArea, DIR_OFFSETS } from './map-data.js';

// Terrain → { char, color } mapping
// When a room has multiple terrain types, priority order determines which displays
const TERRAIN_STYLES = {
  city:        { ch: '#', color: '#e5e5e5' },
  road:        { ch: '+', color: '#cdcd00' },
  path:        { ch: '\u00b7', color: '#aa8844' },  // middle dot
  forest:      { ch: '\u2663', color: '#00cd00' },   // ♣
  jungle:      { ch: '\u2663', color: '#00ff00' },
  canopy:      { ch: '\u2663', color: '#008800' },
  plains:      { ch: '"', color: '#88cc44' },
  farm:        { ch: '=', color: '#88cc44' },
  hills:       { ch: '^', color: '#aa8844' },
  mountain:    { ch: '\u25b2', color: '#999999' },   // ▲
  desert:      { ch: '~', color: '#ffff00' },
  sea:         { ch: '\u2248', color: '#0000ee' },    // ≈
  lake:        { ch: '\u2248', color: '#00cdcd' },
  river:       { ch: '~', color: '#00cdcd' },
  beach:       { ch: '.', color: '#ffff00' },
  swamp:       { ch: '%', color: '#448844' },
  arctic:      { ch: '*', color: '#ffffff' },
  underground: { ch: '\u00b7', color: '#666666' },
  inside:      { ch: '\u00b7', color: '#999999' },
  barren:      { ch: '.', color: '#884444' },
  underwater:  { ch: '\u2248', color: '#4444aa' },
  sky:         { ch: '\u00b7', color: '#00ffff' },
  outside:     { ch: '.', color: '#888888' },
};

// Priority order: more specific terrains first
const TERRAIN_PRIORITY = [
  'city', 'road', 'path', 'forest', 'jungle', 'canopy',
  'plains', 'farm', 'hills', 'mountain', 'desert',
  'sea', 'lake', 'river', 'beach', 'swamp', 'arctic',
  'underground', 'inside', 'barren', 'underwater', 'sky', 'outside',
];

// Connector characters for exit lines between rooms
const CONNECTORS = {
  north:     '\u2502',  // │
  south:     '\u2502',
  east:      '\u2500',  // ─
  west:      '\u2500',
  northeast: '\u2571',  // ╱
  southwest: '\u2571',
  northwest: '\u2572',  // ╲
  southeast: '\u2572',
};

function getTerrainStyle(environment) {
  if (!environment) return TERRAIN_STYLES.outside;
  const terrains = environment.toLowerCase().split(/,\s*| and /);
  for (const t of TERRAIN_PRIORITY) {
    if (terrains.includes(t)) return TERRAIN_STYLES[t];
  }
  return TERRAIN_STYLES.outside;
}

function colorSpan(ch, color) {
  return '<span style="color:' + color + '">' + ch + '</span>';
}

// Measure actual monospace character dimensions using the map's font
let cachedCharW = 0;
let cachedCharH = 0;

function measureChar(bodyEl) {
  const probe = document.createElement('pre');
  probe.className = 'map-display';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.textContent = 'XXXXXXXXXXXXXXXXXXXX\nX\nX\nX\nX\nX\nX\nX\nX\nX\nX';
  bodyEl.appendChild(probe);
  cachedCharW = probe.scrollWidth / 20;
  cachedCharH = probe.scrollHeight / 11;
  bodyEl.removeChild(probe);
}

export function renderMap(bodyEl) {
  const currentId = getCurrentRoomId();
  const currentRoom = currentId ? getRoom(currentId) : null;

  if (!currentRoom || currentRoom.x === null) {
    bodyEl.innerHTML = '<pre class="map-display"><span style="color:#666">No map data yet.\nExplore to build the map.</span></pre>';
    return;
  }

  // Measure character size each render (cheap, ensures accuracy on resize)
  measureChar(bodyEl);

  const bodyWidth = bodyEl.clientWidth || 320;
  const bodyHeight = bodyEl.clientHeight || 240;
  const charW = cachedCharW || 8.4;
  const charH = cachedCharH || 16.1;

  console.log('[MAP]', { bodyWidth, bodyHeight, charW, charH, totalCols: Math.floor(bodyWidth/charW), totalRows: Math.floor(bodyHeight/charH) });

  // How many characters fit in the panel — 1 char per room, no connector cells
  const totalCols = Math.max(5, Math.floor(bodyWidth / charW));
  const totalRows = Math.max(5, Math.floor(bodyHeight / charH) - 1); // -1 for z-level line

  const radiusX = Math.max(2, Math.floor((totalCols - 1) / 2));
  const radiusY = Math.max(2, Math.floor((totalRows - 1) / 2));

  const cx = currentRoom.x;
  const cy = currentRoom.y;
  const cz = currentRoom.z;

  // Get all rooms in the same area on the same z-level
  const areaRooms = getRoomsByArea(currentRoom.area);

  // Build a lookup: "x,y" → room (for current z-level only)
  const posMap = new Map();
  for (const room of areaRooms) {
    if (room.z === cz) {
      posMap.set(room.x + ',' + room.y, room);
    }
  }

  const gridW = radiusX * 2 + 1;
  const gridH = radiusY * 2 + 1;

  // Initialize render buffer — 1:1 mapping, each cell = one room position
  const buf = [];
  for (let row = 0; row < gridH; row++) {
    buf.push(new Array(gridW).fill(null));
  }

  // Place rooms
  for (let ry = 0; ry < gridH; ry++) {
    for (let rx = 0; rx < gridW; rx++) {
      const worldX = cx - radiusX + rx;
      const worldY = cy - radiusY + ry;
      const room = posMap.get(worldX + ',' + worldY);
      if (!room) continue;

      if (room.id === currentId) {
        buf[ry][rx] = colorSpan('@', '#ffffff');
      } else {
        const style = getTerrainStyle(room.environment);
        buf[ry][rx] = colorSpan(style.ch, style.color);
      }
    }
  }

  // Build output string
  const lines = [];
  for (let row = 0; row < gridH; row++) {
    let line = '';
    for (let col = 0; col < gridW; col++) {
      line += buf[row][col] || ' ';
    }
    // Center horizontally if grid is narrower than panel
    const pad = totalCols - gridW;
    if (pad > 0) line = ' '.repeat(Math.floor(pad / 2)) + line;
    lines.push(line);
  }

  // Center vertically
  const usedRows = gridH + 1;
  const topPad = Math.floor((totalRows - usedRows) / 2);
  const botPad = totalRows - usedRows - topPad;
  for (let i = 0; i < topPad; i++) lines.unshift('');
  for (let i = 0; i < botPad; i++) lines.push('');

  // Z-level indicator
  const hasUp = currentRoom.exits && currentRoom.exits.up !== undefined;
  const hasDown = currentRoom.exits && currentRoom.exits.down !== undefined;
  let zLine = '<span style="color:#666">[';
  if (hasUp) zLine += colorSpan('\u25b2', '#888888');  // ▲
  else zLine += ' ';
  zLine += ' Z:' + cz + ' ';
  if (hasDown) zLine += colorSpan('\u25bc', '#888888');  // ▼
  else zLine += ' ';
  zLine += ']</span>';
  lines.push(zLine);

  bodyEl.innerHTML = '<pre class="map-display">' + lines.join('\n') + '</pre>';
}

export function invalidateMapCache() {
  cachedCharW = 0;
  cachedCharH = 0;
}
