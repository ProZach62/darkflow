import { normalizeMapZoom } from './map-zoom.js';
import { normalizeMapPan, splitMapPan } from './map-pan.js';
import { extractTerrainTokens, getPrimaryTerrain } from './terrain-semantics.mjs';
import { planTerrain } from './map-terrain-core.js';
import { createTerrainPainter } from './map-terrain-paint.js';
import { mapPinIconSvg, mapPinLabel } from './map-pins-core.js';

const TILE_SIZE = 32;
// Gap between room boxes. Rooms are drawn as separate boxes spaced apart, with
// connector lines bridging the gap between connected neighbours.
const TILE_GAP = 8;
const MAP_OVERSCAN_CELLS = 2;
const MAP_DIRECTIONS = new Set([
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down',
]);

const COMPASS_DIRS = [
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
  ['northeast', 'ne'], ['northwest', 'nw'],
  ['southeast', 'se'], ['southwest', 'sw'],
];

// Movement: the player marker steps to the new room quickly and the camera
// glides after it, so the marker leads and the view settles on it. Both run
// as CSS animations whose negative delay is the time already spent, so a
// re-render mid-glide picks up where the last frame left off.
const MARKER_STEP_MS = 180;
const CAMERA_GLIDE_MS = 380;
// Longer jumps (a teleport, a recall) cut rather than slide across the map.
const MAX_GLIDE_CELLS = 2;
// Zooming at a point eases in from the old scale around that point.
const ZOOM_GLIDE_MS = 220;
// Rooms that appear while the player explores an area clear out of the fog.
const REVEAL_MS = 700;
// More than this many at once is a load or a resync, not exploring.
const MAX_REVEALS_AT_ONCE = 40;

const REVERSE_DIR = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up',
};

// Remember the last room the player occupied that had a coordinate, per area.
// When the player steps into a room the server has not positioned yet, we keep
// the view parked on this spot instead of blanking the whole panel.
function createRendererState(options = {}) {
  return {
    lastCenterByArea: new Map(),
    lastRenderDebug: null,
    motion: null,
    reveal: null,
    painter: null,
    lastTerrain: null,
    lastZoom: 0,
    zoomGlide: null,
    lastView: null,
    now: typeof options.now === 'function'
      ? options.now
      : () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };
}

function easeOutCubic(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

// Where the marker and camera are coming from, in cells relative to the
// player's room: { area, z, x, y, at, cam, marker }. A move during a glide
// starts from wherever the glide had got to.
export function advanceMapMotion(previous, room, now, reducedMotion) {
  if (!room) return null;
  const next = {
    area: room.area, z: room.z, x: room.x, y: room.y, at: now,
    cam: { x: 0, y: 0 }, marker: { x: 0, y: 0 },
  };
  if (!previous || reducedMotion || previous.area !== room.area || previous.z !== room.z) {
    return next;
  }
  if (previous.x === room.x && previous.y === room.y) return previous;
  const elapsed = now - previous.at;
  const camLeft = 1 - easeOutCubic(elapsed / CAMERA_GLIDE_MS);
  const markerLeft = 1 - easeOutCubic(elapsed / MARKER_STEP_MS);
  const dx = room.x - previous.x;
  const dy = room.y - previous.y;
  const cam = { x: dx + previous.cam.x * camLeft, y: dy + previous.cam.y * camLeft };
  const marker = { x: dx + previous.marker.x * markerLeft, y: dy + previous.marker.y * markerLeft };
  const reach = Math.max(Math.abs(cam.x), Math.abs(cam.y), Math.abs(marker.x), Math.abs(marker.y));
  if (reach <= MAX_GLIDE_CELLS + 0.5) {
    next.cam = cam;
    next.marker = marker;
  }
  return next;
}

// Rooms new to the area since the player arrived, with when each appeared.
// Entering an area, or a bulk load, sets the baseline without revealing.
export function trackMapReveals(previous, area, areaRooms, now, reducedMotion) {
  if (!previous || previous.area !== area) {
    return { area, known: new Set(areaRooms.map((room) => room.id)), at: new Map() };
  }
  const fresh = areaRooms.filter((room) => !previous.known.has(room.id));
  for (const room of fresh) previous.known.add(room.id);
  if (!reducedMotion && fresh.length && fresh.length <= MAX_REVEALS_AT_ONCE) {
    for (const room of fresh) previous.at.set(room.id, now);
  }
  for (const [id, at] of previous.at) {
    if (now - at >= REVEAL_MS) previous.at.delete(id);
  }
  return previous;
}

function glideStyle(prefix, vector, scale, elapsed) {
  return '--map-' + prefix + '-x:' + round2(vector.x * scale) + 'px;'
    + '--map-' + prefix + '-y:' + round2(vector.y * scale) + 'px;'
    + 'animation-delay:-' + Math.round(elapsed) + 'ms;';
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Pick a coordinate to center the grid on when the player's own room has no
// coordinate. Prefer the last positioned room we centered on for this area;
// otherwise fall back to the area room nearest the centroid so the view is
// stable rather than jumping to an arbitrary edge room.
function pickCenterRoom(area, areaRooms, source, skipLast, state) {
  if (!skipLast) {
    const lastId = state.lastCenterByArea.get(area);
    if (lastId) {
      const last = source.getRoom(lastId);
      if (last && last.area === area && last.x !== null) return last;
    }
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

// Child spans drawn in the gap outside a room box for each compass exit
// (cardinals and diagonals):
//  - a CONNECTOR line bridging to an adjacent mapped neighbour, or
//  - a shorter STUB tick toward an exit whose destination is not mapped yet
//    (so the player can see where there is still more to explore -- the map
//    grows visibly as you walk, mirroring Mudlet's exit stubs).
// Each side draws the full gap-bridging line, so a one-way exit still renders
// a full connector and reciprocal neighbours' lines coincide exactly.
// Also emits per-tile up/down glyphs and a special-exit (enter/portal) dot so
// every exit a room has is visible on the map, not just planar compass ones.
function buildExitSpans(room, cz, source) {
  if (!room || !room.exits) return '';
  let spans = '';
  for (const [dir, abbr] of COMPASS_DIRS) {
    const destId = room.exits[dir];
    if (!destId) continue;
    const dest = source.getRoom(destId);
    // Stub if the destination isn't positioned, OR lives in a different zone --
    // a cross-zone exit's coordinates are in another area's space and must not
    // be drawn as an adjacent connector. A KNOWN other-zone destination is an
    // area boundary ("this leads somewhere else"), rendered distinctly from an
    // unexplored stub ("more to explore"); the tooltip names the zone.
    if (!dest || dest.x === null || dest.area !== room.area) {
      const stubMod = dest && dest.area && dest.area !== room.area
        ? ' map-stub-area' : ' map-stub-unvisited';
      spans += '<span class="map-stub map-stub-' + abbr + stubMod + '"></span>';
      continue;
    }
    if (dest.z !== cz) continue;
    const offset = source.DIR_OFFSETS[dir];
    if (dest.x === room.x + offset.dx && dest.y === room.y + offset.dy) {
      // One-way when the destination has no exit pointing back at us
      // (Mudlet's convention: dashed line + arrowhead toward the dest).
      const oneWay = !dest.exits || dest.exits[REVERSE_DIR[dir]] !== room.id;
      spans += '<span class="map-conn map-conn-' + abbr
        + (oneWay ? ' map-conn-oneway' : '') + '"></span>';
      if (oneWay) {
        spans += '<span class="map-arrow map-arrow-' + abbr + '"></span>';
      }
    } else {
      // The graph edge is authoritative but collision repair placed the room
      // somewhere non-adjacent. Show an adjusted stub rather than hiding a
      // known exit or drawing a false straight connection.
      spans += '<span class="map-stub map-stub-' + abbr
        + ' map-stub-adjusted"></span>';
    }
  }
  // Door ticks: a small state-colored marker mid-gap. A door may exist on a
  // direction with NO exit entry (the server strips exits behind closed
  // doors), so this runs independently of the connector/stub loop above.
  const doors = room.exitDoors;
  if (doors) {
    for (const [dir, abbr] of COMPASS_DIRS) {
      if (doors[dir]) {
        spans += '<span class="map-door map-door-' + abbr
          + ' map-door-state-' + doorStateName(doors[dir]) + '"></span>';
      }
    }
  }
  // Vertical glyphs render from either an exit or a door (a closed up-door
  // means there IS a way up, just shut right now); door state tints them.
  if (room.exits.up !== undefined || (doors && doors.up)) {
    spans += '<span class="map-vert map-vert-up' + vertDoorClass(doors, 'up')
      + '">&#x25B2;</span>';
  }
  if (room.exits.down !== undefined || (doors && doors.down)) {
    spans += '<span class="map-vert map-vert-down' + vertDoorClass(doors, 'down')
      + '">&#x25BC;</span>';
  }
  spans += specialExitSpans(room);
  if (room.details && room.details.length) {
    spans += detailBadge(room.details[0]);
  }
  return spans;
}

// Room feature badge (top edge): first detail only; the tooltip lists all.
// The common services get a drawn icon; anything else keeps its initial.
const DETAIL_ICONS = {
  shop: '<path d="M3 5h6l1 6H2z"/><path d="M4.5 5V4a1.5 1.5 0 0 1 3 0v1" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  bank: '<path d="M6 1l5 3H1z"/><path d="M2 5h1.5v4H2zM5.25 5h1.5v4h-1.5zM8.5 5H10v4H8.5zM1 9.8h10v1.4H1z"/>',
  guild: '<path d="M6 1l4.5 1.5V6c0 2.6-2 4.3-4.5 5.2C3.5 10.3 1.5 8.6 1.5 6V2.5z"/>',
  pub: '<path d="M2 3h6v7.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5z"/><path d="M8 4.5h1.2a1.6 1.6 0 0 1 0 3.2H8" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  post: '<path d="M1 3h10v7H1z"/><path d="M1.4 3.4L6 7l4.6-3.6" fill="none" stroke="#2a1d0a" stroke-width="1.1"/>',
};

export const MAP_DETAIL_ICON_KINDS = Object.freeze(Object.keys(DETAIL_ICONS));

/** The inline icon for a room detail, or '' when it has none. */
export function mapDetailIconSvg(detail) {
  const paths = DETAIL_ICONS[detail];
  return paths
    ? '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">' + paths + '</svg>'
    : '';
}

function detailBadge(detail) {
  const icon = mapDetailIconSvg(detail);
  if (icon) {
    return '<span class="map-detail map-detail-icon map-detail-' + detail + '">' + icon + '</span>';
  }
  return '<span class="map-detail">'
    + escAttr(String(detail).charAt(0).toUpperCase() || '?') + '</span>';
}

function doorStateName(state) {
  return state === 3 ? 'locked' : state === 2 ? 'closed' : 'open';
}

function vertDoorClass(doors, dir) {
  if (!doors || !doors[dir]) return '';
  return ' map-vert-door-' + doorStateName(doors[dir]);
}

// Indicators for non-compass exits. "in"-like and "out"-like exits get
// directional chevron glyphs (Mudlet draws inward/outward triangle pairs);
// any other special exit (portal, custom verb) keeps the generic dot, shifted
// left when it shares the corner with an in/out glyph. exitKinds may be
// absent on neighbour stubs that have only been seen from an adjacent room.
const IN_EXIT_NAMES = new Set(['in', 'enter']);
const OUT_EXIT_NAMES = new Set(['out', 'exit', 'leave']);

function specialExitSpans(room) {
  if (!room.exitKinds) return '';
  let hasIn = false;
  let hasOut = false;
  let hasOther = false;
  for (const [dir, kind] of Object.entries(room.exitKinds)) {
    if (kind === 'spatial' || kind === 'vertical') continue;
    if (IN_EXIT_NAMES.has(dir)) hasIn = true;
    else if (OUT_EXIT_NAMES.has(dir)) hasOut = true;
    else hasOther = true;
  }
  let spans = '';
  if (hasIn) spans += '<span class="map-inout map-exit-in">&#x203A;&#x2039;</span>';
  if (hasOut) spans += '<span class="map-inout map-exit-out">&#x2039;&#x203A;</span>';
  if (hasOther) {
    spans += '<span class="map-exit-special'
      + (hasIn || hasOut ? ' map-exit-special-shifted' : '') + '"></span>';
  }
  return spans;
}

function getTerrainName(environment) {
  return getPrimaryTerrain(environment);
}

// extras.ambience: { color, alpha, light } tints the map from the player's
// marker, with a pool of light around it when light is set.
// extras.pins: { roomId: { kind, note } } draws the player's pins.
// extras.living: animate water, swamp mist, and (at night) town torchlight.
// extras.zoomAnchor: { x, y } in pixels from the middle of the map, when the
// zoom just changed at that point, eases the change in around it.
// bodyEl.dataset.mapLevel shows a level that many floors above (or below)
// the player's, with the player's own floor faint beneath it.
function renderMap(bodyEl, source, state, extras = {}) {
  const now = state.now();
  state.lastView = null;
  const reducedMotion = !!(bodyEl.dataset && bodyEl.dataset.mapMotion === 'reduce');
  // Browse mode renders an arbitrary catalog area (opened in the Area Map pane)
  // with no player marker; the live map is the default source.
  const browse = !!source.isBrowse;
  const currentId = source.getCurrentRoomId();
  const currentRoom = currentId ? source.getRoom(currentId) : null;

  // The player's room is only a usable render center when it has a coordinate
  // (and only in live mode -- a browse view has no player).
  const playerRoom = !browse && currentRoom && currentRoom.x !== null ? currentRoom : null;
  const playerId = playerRoom ? playerRoom.id : null;

  let centerRoom = playerRoom;
  let pending = false;

  if (browse) {
    // Center on the server-suggested room, else the area centroid.
    const areaRooms = source.getRoomsByArea(currentRoom ? currentRoom.area : null);
    if (areaRooms.length === 0) {
      bodyEl.innerHTML = '<div class="map-grid map-empty">'
        + '<div class="map-empty-msg">No rooms mapped for this area yet.</div></div>';
      return;
    }
    centerRoom = currentRoom && currentRoom.x !== null
      ? currentRoom
      : pickCenterRoom(areaRooms[0].area, areaRooms, source, true, state);
  } else if (!centerRoom) {
    // Live mode: the player's room is not positioned yet. Do NOT blank the map;
    // keep showing the surrounding area parked on the last known position with a
    // "locating" indicator, so a single unpositioned room never wipes the map.
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
    centerRoom = pickCenterRoom(area, areaRooms, source, false, state);
    pending = true;
  } else if (centerRoom.area) {
    // Remember where we are so we can park here if the next room is unpositioned.
    state.lastCenterByArea.set(centerRoom.area, centerRoom.id);
  }

  // Parked or browsing, there is no marker to move; the next positioned room
  // starts fresh rather than gliding in from wherever the player was.
  state.motion = playerRoom
    ? advanceMapMotion(state.motion, playerRoom, now, reducedMotion)
    : null;
  const motion = state.motion;
  const motionElapsed = motion ? now - motion.at : Infinity;

  const bodyRect = bodyEl.getBoundingClientRect ? bodyEl.getBoundingClientRect() : null;
  const bodyWidth = (bodyRect && bodyRect.width) || bodyEl.clientWidth || 320;
  const bodyHeight = (bodyRect && bodyRect.height) || bodyEl.clientHeight || 240;
  const zoom = normalizeMapZoom(bodyEl.dataset && bodyEl.dataset.mapZoom);

  // How many tiles fit in the panel (each cell is a tile plus the gap to the next).
  // Keep a small offscreen buffer so drag-panning never exposes an empty edge
  // before the renderer recenters on another world coordinate.
  const pitch = (TILE_SIZE + TILE_GAP) * zoom;
  const visualGap = TILE_GAP * zoom;
  const tilesX = Math.max(3, Math.round((bodyWidth + visualGap) / pitch));
  const tilesY = Math.max(3, Math.round((bodyHeight + visualGap) / pitch));

  // Ensure odd numbers so the viewport has a stable center, then add equally
  // sized overscan on every side.
  const viewportW = tilesX % 2 === 0 ? tilesX - 1 : tilesX;
  const viewportH = tilesY % 2 === 0 ? tilesY - 1 : tilesY;
  const gridW = viewportW + (MAP_OVERSCAN_CELLS * 2);
  const gridH = viewportH + (MAP_OVERSCAN_CELLS * 2);
  const radiusX = (gridW - 1) / 2;
  const radiusY = (gridH - 1) / 2;

  const panX = normalizeMapPan(bodyEl.dataset && bodyEl.dataset.mapPanX);
  const panY = normalizeMapPan(bodyEl.dataset && bodyEl.dataset.mapPanY);
  const horizontalPan = splitMapPan(panX, pitch);
  const verticalPan = splitMapPan(panY, pitch);
  const cx = centerRoom.x - horizontalPan.cells;
  const cy = centerRoom.y - verticalPan.cells;
  const levelOffset = mapLevelOffset(bodyEl.dataset && bodyEl.dataset.mapLevel);
  const homeZ = centerRoom.z;
  const cz = homeZ + levelOffset;

  const areaRooms = source.getRoomsByArea(centerRoom.area);
  const levels = [...new Set(areaRooms.map((room) => room.z).filter(Number.isInteger))].sort((a, b) => a - b);
  state.lastView = {
    area: centerRoom.area, levels, viewZ: cz, homeZ, levelOffset,
    centerX: centerRoom.x, centerY: centerRoom.y, pitch,
  };
  // Viewing another floor, the player's own floor shows faintly beneath it.
  const ghostKeys = new Set();
  if (levelOffset !== 0) {
    for (const room of areaRooms) {
      if (room.z === homeZ && room.x !== null) ghostKeys.add(room.x + ',' + room.y);
    }
  }
  const pins = extras.pins && typeof extras.pins === 'object' ? extras.pins : null;

  if (state.lastZoom && zoom !== state.lastZoom && extras.zoomAnchor && !reducedMotion) {
    state.zoomGlide = { from: state.lastZoom / zoom, at: now, anchor: extras.zoomAnchor };
  }
  state.lastZoom = zoom;
  const zoomElapsed = state.zoomGlide ? now - state.zoomGlide.at : Infinity;
  const zoomGliding = zoomElapsed < ZOOM_GLIDE_MS;
  state.reveal = trackMapReveals(state.reveal, centerRoom.area, areaRooms, now, reducedMotion);
  const revealedAt = state.reveal.at;
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
  const viewportPixelWidth = (viewportW * TILE_SIZE)
    + (Math.max(0, viewportW - 1) * TILE_GAP);
  const viewportPixelHeight = (viewportH * TILE_SIZE)
    + (Math.max(0, viewportH - 1) * TILE_GAP);
  const overscanOffset = MAP_OVERSCAN_CELLS * (TILE_SIZE + TILE_GAP) * zoom;
  // Painted terrain: the rooms' land is painted on a canvas under them as
  // joined regions, and the room boxes become plates on it.
  const painted = !!(bodyEl.dataset && bodyEl.dataset.mapStyle === 'painted');
  const gridPixelWidth = (gridW * TILE_SIZE) + ((gridW - 1) * TILE_GAP);
  const gridPixelHeight = (gridH * TILE_SIZE) + ((gridH - 1) * TILE_GAP);
  const terrainCells = [];
  const placed = new Map();

  const cameraGliding = !!motion && motionElapsed < CAMERA_GLIDE_MS
    && (motion.cam.x !== 0 || motion.cam.y !== 0);
  let zoomStyle = '';
  if (zoomGliding) {
    const anchor = state.zoomGlide.anchor;
    zoomStyle = '--map-zoom-from:' + round2(state.zoomGlide.from) + ';transform-origin:'
      + round2((viewportPixelWidth * zoom) / 2 + (Number(anchor.x) || 0)) + 'px '
      + round2((viewportPixelHeight * zoom) / 2 + (Number(anchor.y) || 0)) + 'px;'
      + 'animation-delay:' + (cameraGliding ? '-' + Math.round(motionElapsed) + 'ms,' : '')
      + '-' + Math.round(zoomElapsed) + 'ms;';
  }
  let html = '<div class="map-grid-frame' + (cameraGliding ? ' map-camera-glide' : '')
    + (zoomGliding ? ' map-zoom-glide' : '')
    + '" style="width:' + (viewportPixelWidth * zoom)
    + 'px;height:' + (viewportPixelHeight * zoom) + 'px;transform:translate('
    + horizontalPan.offset + 'px,' + verticalPan.offset + 'px);'
    + (cameraGliding ? glideStyle('cam', motion.cam, pitch, motionElapsed) : '') + zoomStyle + '"'
    + ' data-map-pitch="' + pitch + '"'
    + ' data-map-pan-offset-x="' + horizontalPan.offset + '"'
    + ' data-map-pan-offset-y="' + verticalPan.offset + '">'
    + '<div class="map-grid" style="left:-' + overscanOffset
    + 'px;top:-' + overscanOffset + 'px;gap:' + TILE_GAP + 'px;'
    + 'grid-template-columns:repeat(' + gridW + ',' + TILE_SIZE + 'px);'
    + 'grid-template-rows:repeat(' + gridH + ',' + TILE_SIZE + 'px);'
    + 'transform:scale(' + zoom + ')"'
    + (painted ? ' data-map-style="painted"' : '') + '>'
    + (painted
      ? '<canvas class="map-terrain" aria-hidden="true" style="grid-column:1 / -1;grid-row:1 / -1;width:'
        + gridPixelWidth + 'px;height:' + gridPixelHeight + 'px"></canvas>'
      : '');

  let markerCell = null;
  const living = !!extras.living && !reducedMotion;
  const torchlight = living && !!(extras.ambience && extras.ambience.light);
  let livingHtml = '';
  for (let ry = 0; ry < gridH; ry++) {
    for (let rx = 0; rx < gridW; rx++) {
      const worldX = cx - radiusX + rx;
      const worldY = cy - radiusY + ry;
      const bucket = buckets.get(worldX + ',' + worldY) || [];
      const room = chooseRoomForTile(bucket, playerId, distances, connectedVisibleCount);

      if (!room) {
        html += ghostKeys.has(worldX + ',' + worldY)
          ? '<div class="map-tile map-tile-ghost"></div>'
          : '<div class="map-tile' + fogClass(worldX, worldY, buckets, source) + '"></div>';
        continue;
      }
      const isPlayer = room.id === playerId;
      if (isPlayer) markerCell = { column: rx + 1, row: ry + 1 };
      const terrain = getTerrainName(room.environment);
      if (living && room.observed !== false) {
        livingHtml += livingTerrainHtml(terrain, rx + 1, ry + 1, worldX, worldY, torchlight);
      }
      if (painted) {
        terrainCells.push({
          col: rx, row: ry, terrain, unseen: room.observed === false, water: namedWater(room.environment),
        });
        placed.set(room.id, { col: rx, row: ry, room });
      }
      const trustClass = room.layoutState ? ' map-layout-' + room.layoutState : '';
      const lastPos = !isPlayer && pending && room.id === centerRoom.id ? ' map-tile-lastpos' : '';
      const unseen = room.observed === false ? ' map-tile-unseen' : '';
      const revealAt = revealedAt.get(room.id);
      const revealElapsed = revealAt === undefined ? Infinity : now - revealAt;
      const revealing = revealElapsed < REVEAL_MS;
      const pin = pins && pins[room.id] ? pins[room.id] : null;
      html += '<div class="map-tile map-tile-room map-tile-' + terrain
        + (isPlayer ? ' map-tile-player' : '') + trustClass + conflictClass(bucket)
        + lastPos + unseen + (revealing ? ' map-tile-revealed' : '') + (pin ? ' map-tile-pinned' : '')
        + '"' + (revealing ? ' style="animation-delay:-' + Math.round(revealElapsed) + 'ms"' : '')
        + ' title="' + escAttr(tileTitle(room, bucket, source, pin)) + '"'
        + ' data-room-id="' + escAttr(room.id) + '"'
        + conflictAttr(bucket) + '>'
        + buildExitSpans(room, cz, source)
        + (pin ? '<span class="map-pin map-pin-' + escAttr(pin.kind) + '">' + mapPinIconSvg(pin.kind) + '</span>' : '')
        + '</div>';
    }
  }

  html += livingHtml;
  if (markerCell) html += playerMarkerHtml(markerCell, motion, motionElapsed, extras.ambience);
  // On another floor, a ghost of the marker shows where the player is, and
  // which way: below this floor or above it.
  if (levelOffset !== 0 && playerRoom) {
    const column = playerRoom.x - (cx - radiusX) + 1;
    const row = playerRoom.y - (cy - radiusY) + 1;
    if (column >= 1 && column <= gridW && row >= 1 && row <= gridH) {
      const below = levelOffset > 0;
      html += '<div class="map-player-ghost" style="grid-column:' + column + ' / span 1;grid-row:'
        + row + ' / span 1" title="You are ' + Math.abs(levelOffset)
        + (Math.abs(levelOffset) === 1 ? ' level ' : ' levels ') + (below ? 'below' : 'above') + '">'
        + '<span class="map-player-ghost-arrow" aria-hidden="true">' + (below ? '&#x25BC;' : '&#x25B2;')
        + '</span></div>';
    }
  }

  html += '</div></div>';

  // Z-level indicator overlay. Reflects the room the player is in when known,
  // otherwise the parked center room.
  const zRoom = playerRoom || centerRoom;
  const hasUp = zRoom.exits && zRoom.exits.up !== undefined;
  const hasDown = zRoom.exits && zRoom.exits.down !== undefined;
  if (hasUp || hasDown || cz !== 0 || levelOffset !== 0) {
    html += '<div class="map-zlevel' + (levelOffset !== 0 ? ' map-zlevel-away' : '') + '">';
    if (hasUp && levelOffset === 0) html += '<span class="map-zlevel-arrow">&#x25B2;</span> ';
    html += 'Z:' + cz;
    if (levelOffset !== 0) html += ' <span class="map-zlevel-home">(you: ' + homeZ + ')</span>';
    if (hasDown && levelOffset === 0) html += ' <span class="map-zlevel-arrow">&#x25BC;</span>';
    html += '</div>';
  }

  // Area name on top (updates as you cross areas); the raw area key is the
  // tooltip to aid map-data troubleshooting. Below it, in live mode, the name of
  // the room you are actually in.
  const titleRoom = currentRoom || centerRoom;
  const areaKey = titleRoom.area || '';
  const areaName = (source.getAreaName && source.getAreaName()) || areaKey;
  if (areaName) {
    html += '<div class="map-areaname" title="' + escAttr(areaKey) + '">'
      + escAttr(areaName) + '</div>';
  }
  if (!browse && source.getAuthority) {
    const authority = source.getAuthority();
    html += '<div class="map-authority map-authority-' + escAttr(authority)
      + '" title="' + (authority === 'authoritative'
        ? 'Server-authoritative map data' : 'Locally learned map data') + '">'
      + (authority === 'authoritative' ? 'Server' : 'Learned') + '</div>';
  }
  if (!browse) {
    html += '<div class="map-roomname">' + escAttr(titleRoom.name) + '</div>';
  }
  html += '<div class="map-compass">N&#x2191;</div>';
  if (browse) {
    // No player marker, pending banner, or Resync for a read-only browse view.
  } else if (pending) {
    html += '<div class="map-pending">&#x25C9; Locating you...</div>';
  } else {
    const status = source.getMapStatus();
    if (status) html += '<div class="map-status">' + escAttr(status) + '</div>';
  }
  if (!browse) {
    const clearLabel = source.getClearMapActionLabel ? source.getClearMapActionLabel() : 'Resync';
    const clearTitle = source.getClearMapActionTitle
      ? source.getClearMapActionTitle()
      : 'Clear and resync map for this area';
    html += '<button class="map-resync-btn" title="' + escAttr(clearTitle) + '">'
      + escAttr(clearLabel) + '</button>';
  }

  bodyEl.innerHTML = html;

  if (painted) {
    paintTerrainLayer(bodyEl, state, planTerrain(terrainCells, terrainLinks(placed)), {
      worldX: cx - radiusX,
      worldY: cy - radiusY,
      width: gridPixelWidth,
      height: gridPixelHeight,
      zoom,
      dpr: typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1,
    });
  } else {
    state.lastTerrain = null;
  }

  const resyncBtn = bodyEl.querySelector('.map-resync-btn');
  if (resyncBtn) {
    resyncBtn.addEventListener('click', () => {
      const area = (currentRoom || centerRoom).area;
      if (area) source.clearMapDataForArea(area);
    });
  }

  state.lastRenderDebug = {
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
    zoom,
    pan: { x: panX, y: panY },
    viewCenter: { x: cx, y: cy, z: cz },
    viewport: { width: viewportW, height: viewportH },
    grid: { width: gridW, height: gridH },
  };
}

// Exits between rooms drawn in neighbouring cells, for roads to follow.
function terrainLinks(placed) {
  const links = [];
  for (const { col, row, room } of placed.values()) {
    if (!room.exits) continue;
    for (const [dir] of COMPASS_DIRS) {
      const dest = placed.get(room.exits[dir]);
      if (dest && Math.abs(dest.col - col) <= 1 && Math.abs(dest.row - row) <= 1) {
        links.push({ from: { col, row }, to: { col: dest.col, row: dest.row } });
      }
    }
  }
  return links;
}

function paintTerrainLayer(bodyEl, state, plan, view) {
  const canvas = typeof bodyEl.querySelector === 'function'
    ? bodyEl.querySelector('canvas.map-terrain') : null;
  if (!canvas || typeof canvas.getContext !== 'function') return;
  if (!state.painter) {
    // A texture arriving after the paint repaints whatever is showing now.
    state.painter = createTerrainPainter({
      onTexturesChanged() {
        const last = state.lastTerrain;
        if (last && last.canvas.isConnected) state.painter.paint(last.canvas, last.plan, last.view);
      },
    });
  }
  state.lastTerrain = { canvas, plan, view };
  state.painter.paint(canvas, plan, view);
}

// The player's marker sits over the player's cell as its own layer, so it
// can step between rooms while the camera follows. It also carries the time
// of day: a tint over the whole map, with a pool of light around the player
// at night.
function playerMarkerHtml(cell, motion, elapsed, ambience) {
  const stepping = !!motion && elapsed < MARKER_STEP_MS
    && (motion.marker.x !== 0 || motion.marker.y !== 0);
  const tinted = ambience && typeof ambience.color === 'string'
    && /^#[0-9a-f]{3,8}$/i.test(ambience.color) && Number(ambience.alpha) > 0;
  // An absolutely placed grid item with only a start line would stretch to
  // the grid's far edge, so the marker spans exactly its one cell.
  let style = 'grid-column:' + cell.column + ' / span 1;grid-row:' + cell.row + ' / span 1;';
  if (stepping) {
    style += glideStyle('marker', { x: -motion.marker.x, y: -motion.marker.y },
      TILE_SIZE + TILE_GAP, elapsed);
  }
  if (tinted) {
    style += '--map-tint:' + ambience.color + ';--map-tint-alpha:'
      + round2(Math.min(0.9, Number(ambience.alpha))) + ';';
  }
  return '<div class="map-player-marker' + (stepping ? ' map-marker-step' : '')
    + (tinted ? ' map-tinted' : '') + (tinted && ambience.light ? ' map-lit' : '')
    + '" style="' + style + '" aria-hidden="true">'
    + '<span class="map-player-ring"></span></div>';
}

// Empty cells next to explored rooms are the edge of the known world, drawn
// as mist; a cell an unexplored exit leads into gets a brighter wisp.
const FOG_NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

function fogClass(x, y, buckets, source) {
  let near = false;
  for (const [ox, oy] of FOG_NEIGHBOURS) {
    const neighbours = buckets.get((x + ox) + ',' + (y + oy));
    if (!neighbours || !neighbours.length) continue;
    near = true;
    if (leadsHere(neighbours, -ox, -oy, source)) return ' map-tile-fog map-tile-fog-lead';
  }
  return near ? ' map-tile-fog' : '';
}

function leadsHere(rooms, dx, dy, source) {
  const offsets = source.DIR_OFFSETS || {};
  for (const [dir] of COMPASS_DIRS) {
    const offset = offsets[dir];
    if (!offset || offset.dx !== dx || offset.dy !== dy) continue;
    for (const room of rooms) {
      const destId = room.exits && room.exits[dir];
      if (!destId) continue;
      const dest = source.getRoom(destId);
      if (!dest || (dest.x === null && dest.area === room.area)) return true;
    }
  }
  return false;
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

  if (bucket.length === 1) return bucket[0];
  if (!bucket.length) return null;
  // Conflicts remain visible, but selection is stable and confidence-aware.
  // Never let mapping iteration order decide what the player sees.
  return bucket.slice().sort((a, b) => {
    const aRank = a.layoutState === 'verified' ? 0 : a.observed ? 1 : 2;
    const bRank = b.layoutState === 'verified' ? 0 : b.observed ? 1 : 2;
    return aRank - bRank || String(a.id).localeCompare(String(b.id));
  })[0];
}

function conflictClass(bucket) {
  return bucket.length > 1 ? ' map-tile-conflict' : '';
}

// Stack count for the conflict corner badge (CSS reads it via attr()).
function conflictAttr(bucket) {
  return bucket.length > 1 ? ' data-stack="' + bucket.length + '"' : '';
}

const WATER_WORDS = ['sea', 'lake', 'river'];

// The water a room's description names (a bridge's river, say), or null.
function namedWater(environment) {
  return extractTerrainTokens(environment).find((token) => WATER_WORDS.includes(token)) || null;
}

// A stable 0..1 value for a world cell, so each cell's animation starts at
// its own point in the cycle and neighbours do not pulse in step.
export function cellPhase(x, y, salt = 0) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) + salt * 0x27d4eb2d, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const LIVING_CYCLE_MS = { water: 7000, river: 3200, mist: 11000, torch: 1700 };

// Living terrain: a soft animated layer over one room's cell. Water shimmers
// (a river runs faster), swamp mist drifts, and at night town torchlight
// flickers at a spot of its own in each cell.
function livingTerrainHtml(terrain, column, row, x, y, torchlight) {
  let kind = null;
  if (terrain === 'river') kind = 'river';
  else if (terrain === 'sea' || terrain === 'lake') kind = 'water';
  else if (terrain === 'swamp') kind = 'mist';
  else if (terrain === 'city' && torchlight) kind = 'torch';
  if (!kind) return '';
  const delay = Math.round(cellPhase(x, y) * LIVING_CYCLE_MS[kind]);
  let style = 'grid-column:' + column + ' / span 1;grid-row:' + row + ' / span 1;animation-delay:-' + delay + 'ms;';
  if (kind === 'torch') {
    style += '--torch-x:' + Math.round(25 + cellPhase(x, y, 1) * 50) + '%;--torch-y:'
      + Math.round(25 + cellPhase(x, y, 2) * 50) + '%;';
  }
  return '<div class="map-live map-live-' + kind + '" style="' + style + '" aria-hidden="true"></div>';
}

// The floor offset a map body asks to see, as a whole number of levels.
export function mapLevelOffset(value) {
  const offset = Math.trunc(Number(value));
  return Number.isFinite(offset) ? Math.max(-50, Math.min(50, offset)) : 0;
}

function tileTitle(room, bucket, source, pin) {
  let title = room.name;
  if (pin) title += '\nPinned: ' + mapPinLabel(pin.kind) + (pin.note ? ' - ' + pin.note : '');
  if (bucket.length > 1) {
    const names = bucket.slice(0, 6).map((entry) => entry.name || 'Unknown');
    const suffix = bucket.length > names.length ? '\n+' + (bucket.length - names.length) + ' more' : '';
    title += '\n' + bucket.length + ' mapped rooms share this coordinate:\n'
      + names.join('\n') + suffix;
  }
  const boundaries = boundaryExitLines(room, source);
  if (boundaries.length) title += '\n' + boundaries.join('\n');
  if (room.details && room.details.length) {
    title += '\n[' + room.details.join(', ') + ']';
  }
  return title;
}

// "east -> darkwind.forest" lines for exits that lead to another zone, so the
// amber boundary stubs are explained on hover.
function boundaryExitLines(room, source) {
  if (!room || !room.exits || !source) return [];
  const lines = [];
  for (const [dir, destId] of Object.entries(room.exits)) {
    if (!MAP_DIRECTIONS.has(dir)) continue;
    const dest = source.getRoom(destId);
    if (dest && dest.area && room.area && dest.area !== room.area) {
      lines.push(dir + ' -> ' + dest.area);
    }
  }
  return lines;
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

/** Creates a renderer whose remembered centers and debug snapshot are private. */
export function createMapRenderer(options = {}) {
  const state = createRendererState(options);
  return {
    render(bodyEl, source, extras) {
      return renderMap(bodyEl, source, state, extras);
    },
    getDebug() {
      return state.lastRenderDebug;
    },
    /**
     * What the last render showed, or null: { area, levels, viewZ, homeZ,
     * levelOffset, centerX, centerY, pitch }. The pan is relative to the centre
     * room at (centerX, centerY), and pitch is one cell in pixels.
     */
    getView() {
      return state.lastView;
    },
    dispose() {
      state.lastCenterByArea.clear();
      state.lastRenderDebug = null;
      state.motion = null;
      state.reveal = null;
      state.zoomGlide = null;
      state.lastView = null;
      if (state.painter) state.painter.dispose();
      state.painter = null;
      state.lastTerrain = null;
    },
    terrainPaintMs() {
      return state.painter ? state.painter.lastPaintMs() : 0;
    },
  };
}
