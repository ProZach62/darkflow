export const VISUAL_EFFECT_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'planetAmbience',
    label: 'Planet ambience',
    description: 'Show planet-specific edge lighting and atmosphere.',
    serverFed: true,
  }),
  Object.freeze({
    key: 'terrainAmbience',
    label: 'Terrain ambience',
    description: 'Show environmental overlays for forests, deserts, cities, and other terrain.',
    serverFed: true,
  }),
  Object.freeze({
    key: 'worldTransitions',
    label: 'Wayshard transitions',
    description: 'Show the full-screen transition when wayshard travel completes.',
    serverFed: true,
  }),
  Object.freeze({
    key: 'lowHealth',
    label: 'Low-health pulse',
    description: 'Pulse red while you are alive at 40% health or less.',
    serverFed: false,
  }),
  Object.freeze({
    key: 'incomingDamage',
    label: 'Incoming damage',
    description: 'Show impact feedback when an attack damages you.',
    serverFed: true,
  }),
  Object.freeze({
    key: 'outgoingDamage',
    label: 'Outgoing damage',
    description: 'Show attack feedback when you damage an opponent.',
    serverFed: true,
  }),
  Object.freeze({
    key: 'spellCasts',
    label: 'Spell effects',
    description: 'Show visual feedback for elemental and magical spell casts.',
    serverFed: true,
  }),
]);

export const VISUAL_EFFECT_KEYS = Object.freeze(
  VISUAL_EFFECT_OPTIONS.map((option) => option.key),
);

export function createDefaultVisualEffectPreferences() {
  return Object.fromEntries(VISUAL_EFFECT_KEYS.map((key) => [key, true]));
}

export function normalizeVisualEffectPreferences(preferences) {
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  return Object.fromEntries(VISUAL_EFFECT_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] !== false : true,
  ]));
}

export function visualEffectEnabled(settings, key) {
  if (!settings || !settings.visualEffectsEnabled || !VISUAL_EFFECT_KEYS.includes(key)) {
    return false;
  }
  return normalizeVisualEffectPreferences(settings.visualEffectPreferences)[key];
}

export function visualEffectsSubscriptionEnabled(settings) {
  if (!settings || !settings.visualEffectsEnabled) return false;
  const preferences = normalizeVisualEffectPreferences(settings.visualEffectPreferences);
  return VISUAL_EFFECT_OPTIONS.some((option) => option.serverFed && preferences[option.key]);
}
