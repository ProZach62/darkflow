export const DEFAULT_MAP_ZOOM = 1;
export const MAP_ZOOM_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

export function normalizeMapZoom(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAP_ZOOM;
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return DEFAULT_MAP_ZOOM;

  return MAP_ZOOM_LEVELS.reduce((closest, candidate) => {
    return Math.abs(candidate - zoom) < Math.abs(closest - zoom)
      ? candidate
      : closest;
  }, DEFAULT_MAP_ZOOM);
}

export function stepMapZoom(value, direction) {
  const current = normalizeMapZoom(value);
  const index = MAP_ZOOM_LEVELS.indexOf(current);
  const nextIndex = Math.max(0, Math.min(
    MAP_ZOOM_LEVELS.length - 1,
    index + (direction < 0 ? -1 : 1)
  ));
  return MAP_ZOOM_LEVELS[nextIndex];
}

export function formatMapZoom(value) {
  return Math.round(normalizeMapZoom(value) * 100) + '%';
}
