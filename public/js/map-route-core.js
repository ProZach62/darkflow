// What a walking route looks like on the map: the rooms it passes through, in
// order, and the connectors between them, drawn from both rooms' sides since
// each room draws its own half of a shared connector.
const DIRECTION_ABBR = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

const REVERSE_DIRECTION = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
};

/**
 * Marks for a route of findPath steps ([{ dir, destId }]) starting at fromId:
 * { rooms: [{ id, order }], links: [{ id, abbr }], targetId, steps }, or null
 * when there is no route to draw.
 */
export function mapRouteMarks(fromId, steps) {
  if (!fromId || !Array.isArray(steps) || !steps.length) return null;
  const rooms = [];
  const links = [];
  let previous = String(fromId);
  steps.forEach((step, index) => {
    const destId = String(step.destId);
    const abbr = DIRECTION_ABBR[step.dir];
    if (abbr) {
      links.push({ id: previous, abbr });
      links.push({ id: destId, abbr: DIRECTION_ABBR[REVERSE_DIRECTION[step.dir]] });
    }
    rooms.push({ id: destId, order: index + 1 });
    previous = destId;
  });
  return { rooms, links, targetId: previous, steps: steps.length };
}
