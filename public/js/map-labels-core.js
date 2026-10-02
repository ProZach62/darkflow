// Landmark labels for the zoomed-out map, where the rooms are too small for
// badges: pinned rooms and rooms with services are named, as many as fit
// without overlapping. Pins win over services, and rooms in view over rooms
// in the margin past it.

export const MAX_MAP_LABELS = 40;
const MAX_LABEL_CHARS = 24;
// The label's size on screen: an 11px monospace character, its padding,
// and its line.
const CHAR_PX = 6.6;
const PAD_PX = 10;
const LINE_PX = 16;
// Where a label sits within its room's cell, in cells: under the room's box
// (32 of the 40px pitch), centred on it.
const ROOM_SPAN = 0.8;

/** The text a label shows, cut to fit with an ellipsis. */
export function mapLabelText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_LABEL_CHARS ? clean.slice(0, MAX_LABEL_CHARS - 1).trimEnd() + '…' : clean;
}

/**
 * The labels to draw, best first, none overlapping another. candidates:
 * [{ id, x, y, text, pinned, inView }] in cells; pitch is one cell on
 * screen in pixels. Each label returned carries its cut text.
 */
export function pickMapLabels(candidates, pitch, limit = MAX_MAP_LABELS) {
  const cell = Number(pitch) > 0 ? Number(pitch) : 1;
  const ranked = candidates
    .map((candidate) => ({ ...candidate, text: mapLabelText(candidate.text) }))
    .filter((candidate) => candidate.text)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)
      || Number(!!b.inView) - Number(!!a.inView)
      || a.text.localeCompare(b.text)
      || String(a.id).localeCompare(String(b.id)));
  const placed = [];
  const boxes = [];
  for (const candidate of ranked) {
    if (placed.length >= limit) break;
    const halfWidth = ((candidate.text.length * CHAR_PX) + PAD_PX) / cell / 2;
    const middle = candidate.x + (ROOM_SPAN / 2);
    const box = {
      left: middle - halfWidth,
      right: middle + halfWidth,
      top: candidate.y + ROOM_SPAN,
      bottom: candidate.y + ROOM_SPAN + (LINE_PX / cell),
    };
    if (boxes.some((other) => box.left < other.right && other.left < box.right
      && box.top < other.bottom && other.top < box.bottom)) continue;
    boxes.push(box);
    placed.push(candidate);
  }
  return placed;
}
