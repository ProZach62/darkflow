export const NO_BACKGROUND_KEY = 'none';
export const DEFAULT_BACKGROUND_KEY = 'twilight-citadel';

export const BACKGROUND_PRESETS = Object.freeze([
  Object.freeze({
    key: NO_BACKGROUND_KEY,
    label: 'None',
    description: 'Use the solid color from the active theme.',
    image: '',
    thumbnail: '',
    position: 'center center',
    dim: 0,
    terminalAlpha: 1,
  }),
  Object.freeze({
    key: 'twilight-citadel',
    label: 'Twilight Citadel',
    description: 'A distant city beneath a violet storm.',
    image: '/assets/backgrounds/twilight-citadel.jpg',
    thumbnail: '/assets/backgrounds/thumbs/twilight-citadel.jpg',
    position: 'center center',
    dim: 0.3,
    terminalAlpha: 0.58,
  }),
  Object.freeze({
    key: 'moonlit-forest',
    label: 'Moonlit Forest',
    description: 'Ancient trees, cold mist, and ruined stone.',
    image: '/assets/backgrounds/moonlit-forest.jpg',
    thumbnail: '/assets/backgrounds/thumbs/moonlit-forest.jpg',
    position: 'center center',
    dim: 0.34,
    terminalAlpha: 0.6,
  }),
  Object.freeze({
    key: 'deep-halls',
    label: 'The Deep Halls',
    description: 'A forgotten city beneath the mountain.',
    image: '/assets/backgrounds/deep-halls.jpg',
    thumbnail: '/assets/backgrounds/thumbs/deep-halls.jpg',
    position: 'center center',
    dim: 0.32,
    terminalAlpha: 0.6,
  }),
  Object.freeze({
    key: 'storm-coast',
    label: 'Storm Coast',
    description: 'Black cliffs and watchtowers above a restless sea.',
    image: '/assets/backgrounds/storm-coast.jpg',
    thumbnail: '/assets/backgrounds/thumbs/storm-coast.jpg',
    position: 'center center',
    dim: 0.28,
    terminalAlpha: 0.56,
  }),
  Object.freeze({
    key: 'neon-city',
    label: 'Neon City',
    description: 'Rain and neon above a sleepless megacity.',
    image: '/assets/backgrounds/neon-city.jpg',
    thumbnail: '/assets/backgrounds/thumbs/neon-city.jpg',
    position: 'center center',
    dim: 0.24,
    terminalAlpha: 0.56,
  }),
  Object.freeze({
    key: 'arcane-observatory',
    label: 'Arcane Observatory',
    description: 'An open-air sanctum of spellcraft and starlight.',
    image: '/assets/backgrounds/arcane-observatory.jpg',
    thumbnail: '/assets/backgrounds/thumbs/arcane-observatory.jpg',
    position: 'center center',
    dim: 0.32,
    terminalAlpha: 0.6,
  }),
  Object.freeze({
    key: 'berserker-hold',
    label: 'Berserker Hold',
    description: 'A firelit northern stronghold beneath a red dawn.',
    image: '/assets/backgrounds/berserker-hold.jpg',
    thumbnail: '/assets/backgrounds/thumbs/berserker-hold.jpg',
    position: 'center center',
    dim: 0.26,
    terminalAlpha: 0.58,
  }),
  Object.freeze({
    key: 'outback-night',
    label: 'Outback Night',
    description: 'Red ranges and gum trees beneath the Southern Cross.',
    image: '/assets/backgrounds/outback-night.jpg',
    thumbnail: '/assets/backgrounds/thumbs/outback-night.jpg',
    position: 'center center',
    dim: 0.28,
    terminalAlpha: 0.58,
  }),
]);

const PRESETS_BY_KEY = new Map(BACKGROUND_PRESETS.map((preset) => [preset.key, preset]));

export function normalizeBackgroundKey(key, fallback = NO_BACKGROUND_KEY) {
  if (typeof key === 'string' && PRESETS_BY_KEY.has(key)) return key;
  return PRESETS_BY_KEY.has(fallback) ? fallback : NO_BACKGROUND_KEY;
}

export function getBackgroundPreset(key) {
  return PRESETS_BY_KEY.get(normalizeBackgroundKey(key)) || PRESETS_BY_KEY.get(NO_BACKGROUND_KEY);
}

export function applyBackground(key, doc = typeof document !== 'undefined' ? document : null) {
  const preset = getBackgroundPreset(key);
  const root = doc && doc.documentElement;
  if (!root || !root.style || !root.dataset) return preset;

  root.dataset.background = preset.key;
  if (!preset.image) {
    delete root.dataset.backgroundActive;
    root.style.removeProperty('--df-background-image');
    root.style.removeProperty('--df-background-position');
    root.style.removeProperty('--df-background-dim');
    root.style.removeProperty('--df-terminal-background-alpha');
    return preset;
  }

  root.dataset.backgroundActive = 'true';
  root.style.setProperty('--df-background-image', `url("${preset.image}")`);
  root.style.setProperty('--df-background-position', preset.position);
  root.style.setProperty('--df-background-dim', String(preset.dim));
  root.style.setProperty('--df-terminal-background-alpha', String(preset.terminalAlpha));
  return preset;
}
