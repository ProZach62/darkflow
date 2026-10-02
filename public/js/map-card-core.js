// The card shown over a room the pointer or keyboard focus is on: what the
// room is, what it offers, where its exits lead, which other rooms share its
// cell, and the player's pin on it. Built when a room is hovered rather than
// written into every tile on every render.
import { extractTerrainTokens } from './terrain-semantics.mjs';
import { mapPinLabel } from './map-pins-core.js';

const SERVICE_NAMES = { shop: 'Shop', bank: 'Bank', guild: 'Guild', pub: 'Pub', post: 'Post office' };
const EXIT_ORDER = [
  'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'up', 'down',
];
const MAX_EXITS = 10;
const MAX_STACK = 6;

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A room detail as the legend names it ("post" is "Post office"). */
export function mapServiceName(detail) {
  const key = String(detail);
  return SERVICE_NAMES[key] || capitalize(key);
}

// exitDoors holds 1 for open, 2 for closed, and 3 for locked.
function doorState(value) {
  return value === 3 ? 'locked' : value === 2 ? 'closed' : value ? 'open' : null;
}

function exitRank(dir) {
  const index = EXIT_ORDER.indexOf(dir);
  return index === -1 ? EXIT_ORDER.length : index;
}

/**
 * What the card shows for room, or null: { name, terrain, services,
 * exits: [{ dir, to, area, door }], moreExits, stack, moreStack, pin }. An
 * exit's to is the name of the room it leads to when that room is mapped,
 * its area is set when that room is in another area, and its door is
 * 'open', 'closed', 'locked', or null. A door with no exit through it (the
 * server leaves out exits behind closed doors) is listed too. stack names
 * the other rooms mapped to the same cell. pin is { kind, label, note } or
 * null.
 */
export function mapRoomCard(room, source, pin = null) {
  if (!room) return null;
  const tokens = extractTerrainTokens(room.environment);
  const terrainWords = tokens.length > 1 ? tokens.filter((token) => token !== 'outside') : tokens;
  const terrain = terrainWords.length ? capitalize(terrainWords.slice(0, 3).join(', ')) : '';
  const services = Array.isArray(room.details) ? room.details.map(mapServiceName) : [];

  const doors = room.exitDoors || {};
  const dirs = new Set([...Object.keys(room.exits || {}), ...Object.keys(doors).filter((dir) => doors[dir])]);
  const exits = [...dirs]
    .sort((a, b) => exitRank(a) - exitRank(b) || a.localeCompare(b))
    .map((dir) => {
      const destId = room.exits ? room.exits[dir] : undefined;
      const dest = destId !== undefined && source && typeof source.getRoom === 'function' ? source.getRoom(destId) : null;
      const area = dest && dest.area && room.area && dest.area !== room.area ? String(dest.area) : null;
      return { dir, to: dest && dest.name ? String(dest.name) : null, area, door: doorState(doors[dir]) };
    });

  const stack = [];
  if (source && typeof source.getRoomsByArea === 'function' && room.x !== null && room.x !== undefined) {
    for (const other of source.getRoomsByArea(room.area)) {
      if (other.id !== room.id && other.x === room.x && other.y === room.y && other.z === room.z) {
        stack.push(String(other.name || 'Unknown'));
      }
    }
  }

  return {
    name: String(room.name || 'Mapped room'),
    terrain,
    services,
    exits: exits.slice(0, MAX_EXITS),
    moreExits: Math.max(0, exits.length - MAX_EXITS),
    stack: stack.slice(0, MAX_STACK),
    moreStack: Math.max(0, stack.length - MAX_STACK),
    pin: pin ? { kind: String(pin.kind), label: mapPinLabel(pin.kind), note: String(pin.note || '') } : null,
  };
}
