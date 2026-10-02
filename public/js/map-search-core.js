// Map search: finds rooms in the area by name, by the services they offer,
// and by the player's pins and notes on them.

const SERVICE_WORDS = {
  shop: ['shop', 'store', 'buy', 'sell'],
  bank: ['bank', 'money', 'gold'],
  guild: ['guild'],
  pub: ['pub', 'tavern', 'inn', 'bar', 'drink'],
  post: ['post', 'mail', 'letter'],
};

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
}

// How well one query term matches a room: 3 for the start of the name, 2 for
// the start of any word, 1 for anywhere, 0 for not at all.
function termScore(term, name, extras) {
  const lower = name.toLowerCase();
  if (lower.startsWith(term)) return 3;
  if (words(name).some((word) => word.startsWith(term))) return 2;
  if (extras.some((word) => word.startsWith(term))) return 2;
  if (lower.includes(term) || extras.some((word) => word.includes(term))) return 1;
  return 0;
}

/**
 * The rooms that match every word of query, best first:
 * [{ id, name, z, details, pin, score }]. pins is { roomId: pin }.
 */
export function searchMapRooms(rooms, query, pins = {}, limit = 8) {
  const terms = words(query);
  if (!terms.length) return [];
  const results = [];
  for (const room of rooms || []) {
    if (!room || room.id === undefined || room.id === null) continue;
    const id = String(room.id);
    const name = String(room.name || '');
    const details = Array.isArray(room.details) ? room.details.map(String) : [];
    const pin = pins && pins[id] ? pins[id] : null;
    const extras = [
      ...details.flatMap((detail) => [detail.toLowerCase(), ...(SERVICE_WORDS[detail] || [])]),
      ...(pin ? [pin.kind, ...words(pin.note)] : []),
    ];
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const termMatch = termScore(term, name, extras);
      if (!termMatch) {
        matched = false;
        break;
      }
      score += termMatch;
    }
    if (!matched) continue;
    results.push({ id, name, z: Number.isInteger(room.z) ? room.z : 0, details, pin, score });
  }
  results.sort((a, b) => b.score - a.score || a.name.length - b.name.length
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return results.slice(0, Math.max(1, limit));
}

/** The pinned rooms of one area, newest first, for the search box at rest. */
export function pinnedRoomsInArea(pins, area) {
  return Object.entries(pins || {})
    .filter(([, pin]) => pin && pin.area === area)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .map(([id, pin]) => ({ id, name: pin.name || 'Pinned room', z: pin.z || 0, details: [], pin, score: 0 }));
}
