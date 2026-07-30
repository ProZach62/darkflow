import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createDefaultVisualEffectPreferences,
  normalizeVisualEffectPreferences,
  visualEffectEnabled,
  VISUAL_EFFECT_OPTIONS,
  visualEffectsSubscriptionEnabled,
} from '../public/js/visual-effects-settings.mjs';

test('visual effect preferences migrate safely and preserve explicit choices', () => {
  const defaults = createDefaultVisualEffectPreferences();
  assert.equal(VISUAL_EFFECT_OPTIONS.length, 7);
  assert.equal(Object.values(defaults).every(Boolean), true);
  assert.deepEqual(normalizeVisualEffectPreferences(), defaults);

  const normalized = normalizeVisualEffectPreferences({
    incomingDamage: false,
    spellCasts: true,
    unknownEffect: false,
  });
  assert.equal(normalized.incomingDamage, false);
  assert.equal(normalized.spellCasts, true);
  assert.equal(normalized.planetAmbience, true);
  assert.equal(Object.hasOwn(normalized, 'unknownEffect'), false);

  const settings = {
    visualEffectsEnabled: true,
    visualEffectPreferences: normalized,
  };
  assert.equal(visualEffectEnabled(settings, 'incomingDamage'), false);
  assert.equal(visualEffectEnabled(settings, 'terrainAmbience'), true);
  assert.equal(visualEffectEnabled({ ...settings, visualEffectsEnabled: false }, 'terrainAmbience'), false);
});

test('the visual effects subscription follows server-fed selections', () => {
  const disabled = Object.fromEntries(
    VISUAL_EFFECT_OPTIONS.map((option) => [option.key, false])
  );
  assert.equal(visualEffectsSubscriptionEnabled({
    visualEffectsEnabled: true,
    visualEffectPreferences: { ...disabled, lowHealth: true },
  }), false);
  assert.equal(visualEffectsSubscriptionEnabled({
    visualEffectsEnabled: true,
    visualEffectPreferences: { ...disabled, spellCasts: true },
  }), true);
  assert.equal(visualEffectsSubscriptionEnabled({
    visualEffectsEnabled: false,
    visualEffectPreferences: createDefaultVisualEffectPreferences(),
  }), false);
});

test('appearance settings expose a collapsed individual-effects disclosure', () => {
  const settingsSource = readFileSync(
    new URL('../public/js/settings-manager.js', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../public/css/main.css', import.meta.url),
    'utf8',
  );

  assert.match(settingsSource, /_createVisualEffectsSettings\(\)/);
  assert.match(settingsSource, /document\.createElement\('details'\)/);
  assert.match(settingsSource, /Individual effects/);
  assert.match(settingsSource, /VISUAL_EFFECT_OPTIONS/);
  assert.match(css, /\.settings-visual-effects-details\s*\{/);
  assert.match(css, /\.settings-visual-effects-summary:focus-visible\s*\{/);
});
