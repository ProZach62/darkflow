// Map pins: a player's own marks on rooms (a quest giver, a danger, loot, a
// note, home), each with an optional note, kept per character. Pure state
// helpers; the map panel stores the state and the renderer draws the pins.

export const MAP_PIN_STORAGE_PREFIX = 'darkflow-map-pins:';
export const MAX_MAP_PINS = 500;
export const MAX_PIN_NOTE = 200;

const PIN_ICONS = {
  note: '<path d="M6 1a3 3 0 0 1 3 3c0 2.2-3 7-3 7S3 6.2 3 4a3 3 0 0 1 3-3z"/><circle cx="6" cy="4" r="1.2" fill="#1b1b1b"/>',
  quest: '<path d="M6 .8 11.2 6 6 11.2.8 6z"/><path d="M5.3 3h1.4l-.2 4H5.5zM5.4 8h1.2v1.2H5.4z" fill="#1b1b1b"/>',
  danger: '<path d="M6 1 11.5 11h-11z"/><path d="M5.35 4.2h1.3l-.2 3.6h-.9zM5.4 8.6h1.2v1.2H5.4z" fill="#1b1b1b"/>',
  loot: '<path d="M3 1.5h6L11 4.5 6 11 1 4.5z"/><path d="M1 4.5h10M4 1.5 3.4 4.5 6 11M8 1.5l.6 3L6 11" fill="none" stroke="#1b1b1b" stroke-width=".6"/>',
  home: '<path d="M6 1 11 5.5H9.5V11h-2.2V7.6H4.7V11H2.5V5.5H1z"/>',
};

/** The kinds of pin, in the order the editor offers them. */
export const MAP_PIN_KINDS = Object.freeze([
  { kind: 'note', label: 'Note', color: '#e9e3cf' },
  { kind: 'quest', label: 'Quest', color: '#f6c445' },
  { kind: 'danger', label: 'Danger', color: '#ef5b4f' },
  { kind: 'loot', label: 'Loot', color: '#5cc8f2' },
  { kind: 'home', label: 'Home', color: '#7fd47a' },
]);
const KIND_NAMES = new Set(MAP_PIN_KINDS.map((entry) => entry.kind));

export function mapPinStorageKey(characterProfileId) {
  return MAP_PIN_STORAGE_PREFIX + String(characterProfileId || 'default');
}

/** The inline icon for a pin kind; unknown kinds draw as a note. */
export function mapPinIconSvg(kind) {
  const paths = PIN_ICONS[kind] || PIN_ICONS.note;
  return '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">' + paths + '</svg>';
}

export function mapPinLabel(kind) {
  const entry = MAP_PIN_KINDS.find((item) => item.kind === kind);
  return entry ? entry.label : 'Note';
}

function cleanText(value, limit) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanPin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    kind: KIND_NAMES.has(raw.kind) ? raw.kind : 'note',
    note: cleanText(raw.note, MAX_PIN_NOTE),
    name: cleanText(raw.name, 120),
    area: cleanText(raw.area, 120),
    z: Number.isInteger(raw.z) ? raw.z : 0,
    at: Number.isFinite(raw.at) ? raw.at : 0,
  };
}

/** Saved pins as { version, pins: { roomId: pin } }; anything damaged is dropped. */
export function normalizeMapPins(raw) {
  const pins = {};
  const source = raw && typeof raw === 'object' && raw.pins && typeof raw.pins === 'object' ? raw.pins : {};
  const entries = Object.entries(source)
    .map(([id, pin]) => [String(id).slice(0, 120), cleanPin(pin)])
    .filter(([id, pin]) => id && pin)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_MAP_PINS);
  for (const [id, pin] of entries) pins[id] = pin;
  return { version: 1, pins };
}

/** Pins room with kind and note; at the cap, the oldest pin makes room. */
export function setMapPin(state, room, kind, note, now = Date.now()) {
  const current = normalizeMapPins(state);
  const id = room && room.id !== undefined && room.id !== null ? String(room.id) : '';
  if (!id) return current;
  const pins = { ...current.pins };
  pins[id] = cleanPin({ kind, note, name: room.name, area: room.area, z: room.z, at: now });
  return normalizeMapPins({ pins });
}

export function removeMapPin(state, roomId) {
  const current = normalizeMapPins(state);
  const pins = { ...current.pins };
  delete pins[String(roomId)];
  return { version: 1, pins };
}
