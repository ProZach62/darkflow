// Sprite sheets for the combat stage figures.
//
// A sheet replaces the procedural body of one figure kind (humanoid, beast)
// with one image frame per pose name from combat-rig-core.mjs. Weapons,
// shield, and the portrait head keep drawing on top, so equipment
// and identity still work with any art. See docs/combat-sprites.md for the
// manifest format an artist authors against.
//
// The pure parts (manifest normalization, frame selection, placement math)
// live here so they can be tested without a canvas; the loader takes fetch
// and Image constructors as parameters for the same reason.

import { POSES } from './combat-rig-core.mjs';
import { bossKey } from './combat-stage-core.mjs';

export const SPRITE_MANIFEST_VERSION = 1;
export const SPRITE_KINDS = Object.freeze(['humanoid', 'beast']);
// A sheet key is a path fragment under the sprites folder: a body kind
// (`humanoid`), a gender and race pair (`male-scro`), or a character
// (`characters/elyndar`). Only these shapes become URLs.
const SHEET_KEY_PATTERN = /^(?:(?:characters|enemies)\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function spriteSlug(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isSheetKey(key) {
  return typeof key === 'string' && key.length <= 80 && SHEET_KEY_PATTERN.test(key);
}

// Races that share one body and can share one sheet. A race without its own
// sheet falls through to `<gender>-<family>` before the body kind, so one
// painted human serves every human culture, one elf every elven kind, and
// one dwarf every dwarven kind. A family may also be a race whose sheet
// another race borrows: Uruk draw the Scro sheet.
export const SPRITE_RACE_FAMILIES = Object.freeze({
  'barbarian': 'human',
  'crannian-gnome': 'dwarf',
  'crinos': 'ursavar',
  'darkwinder': 'human',
  'desert-nomad': 'human',
  'dragon': 'arthok',
  'faerie': 'elf',
  'glavian': 'human',
  'gypsy': 'human',
  'halfling': 'human',
  'hyperborean-gnome': 'dwarf',
  'ice-gnoll': 'ursavar',
  'ice-ogre': 'scro',
  'kender': 'human',
  'northman': 'human',
  'orc': 'scro',
  'pixie': 'elf',
  'sidhe': 'elf',
  'souvraeli': 'human',
  'swamp-troll': 'arthok',
  'sylph': 'elf',
  'thraxian': 'scro',
  'yugoloth': 'arthok',
  'arctic-elf': 'elf',
  'high-elf': 'elf',
  'shel-zaranite': 'elf',
  'silver-elf': 'elf',
  'wayfarian': 'elf',
  'desert-dwarf': 'dwarf',
  'rift-duergar': 'dwarf',
  'stone-dwarf': 'dwarf',
  'uruk': 'scro',
});

export function spriteRaceFamily(race) {
  return SPRITE_RACE_FAMILIES[spriteSlug(race)] || '';
}

// Dedicated body art shared by every gender, before broader family sheets.
const NEUTRAL_RACE_SPRITES = Object.freeze([
  'crannian-gnome', 'hyperborean-gnome', 'ice-gnoll', 'thraxian', 'vaelkar',
  'crinos', 'reedstalker', 'boneback', 'miura', 'zymari',
]);

// Catalogue titles and visible actor names differ (notably Languish).
// Exact public labels plus race select artwork, never establish hidden identity.
const BOSS_SPRITES = Object.freeze([
  { key: 'ilyrra', race: 'dragon', names: ['ilyrra', 'ilyrra still-wing'] },
  { key: 'orryx', race: 'dragon', names: ['orryx', 'orryx, root of thunder'] },
  { key: 'lord-blackbriar', race: 'spirit', names: ['lord blackbriar', 'lord blackbriar, the sole heir'] },
  { key: 'languish', race: 'undead', names: ['languish', 'smooth priest'] },
  { key: 'gravewatch-penitent', race: 'undead', names: ['gravewatch penitent'] },
  { key: 'vaelkor', race: 'dragon', names: ['vaelkor', 'vaelkor, the ash regent', 'vaelkor the ash regent'] },
  { key: 'unarrived', race: 'dragon', names: ['unarrived'] },
  { key: 'swamp-wyrm', race: 'dragon', names: ['swamp wyrm'] },
  { key: 'bandit-king', race: 'human', names: ['bandit king'] },
  { key: 'tidemother', race: 'beast', names: ['tidemother'] },
  { key: 'carrion-queen', race: 'bird', names: ['carrion queen', 'carrion queen of the black boughs'] },
  { key: 'drowned-dryad', race: 'spirit', names: ['drowned dryad', 'drowned dryad of the root-ford'] },
  { key: 'furnace-king', race: 'elemental', names: ['furnace king'] },
  { key: 'thaloryn', race: 'beast', names: ['thaloryn', 'thaloryn, the unmoored leviathan'] },
  { key: 'greg-director', race: 'human', names: ['greg, director of security'] },
  { key: 'aralith', race: 'gargoyle', names: ['aralith', 'aralith the nature mage'] },
  { key: 'sayf-al-murr', race: 'human', names: ['sayf al-murr', 'sayf al-murr, the salt baron'] },
  { key: 'waternix', race: 'faerie', names: ['waternix', 'each-uisge'] },
  { key: 'gaean-warden', race: 'spirit', names: ['gaean warden', "warden of gaea's vigil"] },
  { key: 'astral-colossus', race: 'construct', names: ['astral colossus'] },
  { key: 'splintermaw', race: 'reptile', names: ['splintermaw'] },
  { key: 'ironheart-treant', race: 'treant', names: ['ironheart treant'] },
  { key: 'sablehorn', race: 'dragon', names: ['sablehorn', 'sablehorn moltwyrm'] },
  { key: 'vorrak', race: 'dragon', names: ['vorrak', 'vorrak the acid coil'] },
  { key: 'lower-jaw-alpha', race: 'reptile', names: ['lower jaw alpha'] },
  { key: 'qitar', race: 'demon', names: ['qitar', 'qitar, the unbound'] },
  { key: 'mawspike', race: 'reptile', names: ['mawspike', 'mawspike the burrower'] },
  { key: 'uncolored-one', race: 'spirit', names: ['uncolored one'] },
  { key: 'warden-post-golem', race: 'golem', names: ['warden post golem'] },
  { key: 'defiler', race: 'fiend', names: ['defiler', 'daemon of defilement'] },
  { key: 'white-shark', race: 'fish', names: ['white shark'] },
  { key: 'ruby-dragon', race: 'dragon', names: ['ruby dragon', 'dragon of ruby'] },
  { key: 'regrowth-mass', race: 'reptile', names: ['regrowth mass'] },
  { key: 'bankbreaker', race: 'animal', names: ['bankbreaker', 'bankbreaker, the root-burrowing beast'] },
  { key: 'nhal-serev', race: 'undead', names: ['nhal serev', 'nhal serev, the rimebound archlich'] },
  { key: 'rabbit-of-caerbannog', race: 'fiend', names: ['rabbit of caerbannog'] },
  { key: 'volcano-heart', race: 'elemental', names: ['volcano heart'] },
  { key: 'gravemarch-span', race: 'golem', names: ['gravemarch span'] },
  { key: 'obsidian-thane', race: 'giant', names: ['obsidian thane'] },
  { key: 'parallax-queen', race: 'construct', names: ['parallax queen'] },
  { key: 'cragjaw', race: 'reptile', names: ['cragjaw', 'cragjaw, first hunger'] },
  { key: 'rattleback', race: 'reptile', names: ['rattleback', 'rattleback gnashmother'] },
  { key: 'echoing-drop-stalker', race: 'reptile', names: ['echoing drop stalker'] },
  { key: 'black-vent-ancient', race: 'dragon', names: ['black vent ancient'] },
  { key: 'hollow-antler', race: 'spirit', names: ['hollow antler'] },
  { key: 'warg-leader', race: 'dog', names: ['warg leader'] },
  { key: 'molten-rib-serpent', race: 'dragon', names: ['molten rib serpent'] },
  { key: 'crystalline-monarch', race: 'elemental', names: ['crystalline monarch'] },
  { key: 'jade-dragon', race: 'dragon', names: ['jade dragon', 'dragon of jade'] },
  { key: 'ghost-of-varg', race: 'ghost', names: ['ghost of varg', 'ghost of varg the grey'] },
  { key: 'red-scree-lurker', race: 'reptile', names: ['red scree lurker'] },
  { key: 'buried-mile-colossus', race: 'golem', names: ['buried mile colossus'] },
  { key: 'brood-cradle-matron', race: 'dragon', names: ['brood cradle matron'] },
  { key: 'deep-spine-wyrm', race: 'dragon', names: ['deep spine wyrm'] },
  { key: 'pale-furnace-wyrm', race: 'dragon', names: ['pale furnace wyrm'] },
  { key: 'crushed-arch-warden', race: 'golem', names: ['crushed arch warden'] },
  { key: 'ninth-mile-marker', race: 'golem', names: ['ninth mile marker'] },
  { key: 'sealed-descent-keeper', race: 'golem', names: ['sealed descent keeper'] },
  { key: 'last-chain-sentinel', race: 'giant', names: ['last chain sentinel'] },
  { key: 'last-breath-herald', race: 'reptile', names: ['last breath herald'] },
  { key: 'emerald-dragon', race: 'dragon', names: ['emerald dragon'] },
  { key: 'skeletal-dragon', race: 'dragon', names: ['skeletal dragon'] },
  { key: 'jeweled-dragon', race: 'dragon', names: ['jeweled dragon'] },
  { key: 'faerie-dragon', race: 'dragon', names: ['huge faerie dragon'] },
  { key: 'white-wyrm', race: 'dragon', names: ['white wyrm', 'huge white wyrm'] },
]);

const ENEMY_SPRITE_PATTERNS = Object.freeze([
  ['drake', /\b(?:dragon|drake|wyvern|wyrm|whelp)\b/],
  ['spider', /\b(?:spider|arachnid|scorpion)\b/],
  ['rat', /\b(?:rat|rodent|mouse)\b/],
  ['bat', /\bbat\b/],
  ['bear', /\bbear\b/],
  ['boar', /\bboar\b/],
  ['serpent', /\b(?:snake|serpent)\b/],
  ['crab', /\bcrab\b/],
  ['crocodile', /\b(?:crocodile|alligator)\b/],
  ['golem', /\bgolem\b/],
  ['goblin', /\bgoblin\b/],
  ['kobold', /\bkobold\b/],
  ['minotaur', /\bminotaur\b/],
  ['gargoyle', /\bgargoyle\b/],
  ['undead', /\b(?:skeleton|skeletal|zombie|undead|ghoul|wight|lich)\b/],
  ['troll', /\b(?:troll|ogre|giant)\b/],
]);

export function enemySpriteKey(name) {
  const text = String(name || '').toLowerCase();
  const match = ENEMY_SPRITE_PATTERNS.find(([, pattern]) => pattern.test(text));
  return match ? 'enemies/' + match[0] : '';
}

// Public appearance selects race art for any fighter. Character-name art
// remains a recipient-only legacy fallback, never a replacement for redaction.
export function spriteKeysFor(combatant, figure, side) {
  const keys = [];
  const own = side === 'player' && combatant && !combatant.observed;
  if (combatant && (own || combatant.appearanceKnown)) {
    const race = spriteSlug(combatant.race);
    if (combatant.appearanceKnown && !spriteSlug(combatant.form)) {
      const name = bossKey(combatant.name);
      const boss = BOSS_SPRITES.find((entry) => entry.race === race && entry.names.includes(name));
      if (boss) keys.push('enemies/' + boss.key);
    }
    if (figure && figure.archetype) {
      keys.push(figure.archetype === 'wolf' ? 'wolf' : 'enemies/' + figure.archetype);
    } else {
      const name = spriteSlug(combatant.name);
      if (own && name && !combatant.appearanceKnown) keys.push('characters/' + name);
      const form = spriteSlug(combatant.form);
      if (figure && figure.kind === 'humanoid' && (!form || form === 'humanoid')) {
        // A visual fallback only: this does not invent a public gender hint.
        const declaredGender = spriteSlug(combatant.gender);
        const gender = declaredGender === 'female' ? 'female' : 'male';
        if (race) keys.push(gender + '-' + race);
        if (NEUTRAL_RACE_SPRITES.includes(race)) keys.push(race);
        const family = spriteSlug(combatant.family);
        // A race's curated art family outranks its broader biological family.
        const shared = spriteRaceFamily(race) || spriteRaceFamily(family);
        if (shared && shared !== race) keys.push(gender + '-' + shared);
        if (family && family !== race) keys.push(gender + '-' + family);
      }
    }
  }
  if (side === 'target' && combatant && combatant.isNpc && !combatant.appearanceKnown) {
    const enemy = enemySpriteKey(combatant.name);
    if (enemy) keys.push(enemy);
  }
  if (figure && SPRITE_KINDS.includes(figure.kind)) keys.push(figure.kind);
  return [...new Set(keys.filter(isSheetKey))];
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function point(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = { x, y };
  if (Number.isFinite(Number(value.r))) out.r = Number(value.r);
  return out;
}

// Validates a manifest object. Returns null when it cannot be used; every
// frame must name a known pose and sit inside the image grid so a bad file
// degrades to the procedural body instead of drawing garbage.
export function normalizeSpriteManifest(raw, kind) {
  if (!raw || typeof raw !== 'object') return null;
  if (finite(raw.version, 0) !== SPRITE_MANIFEST_VERSION) return null;
  if (kind && raw.kind && raw.kind !== kind) return null;
  // Optional cloak override: false hides the stage cloak (the art has its
  // own), a hex color recolors it.
  let cloak = true;
  if (raw.cloak === false) cloak = false;
  else if (typeof raw.cloak === 'string' && /^#[0-9a-f]{6}$/i.test(raw.cloak)) cloak = raw.cloak;
  const frameWidth = finite(raw.frameWidth, 0);
  const frameHeight = finite(raw.frameHeight, 0);
  const unit = finite(raw.unit, 0);
  const anchor = point(raw.anchor);
  const image = typeof raw.image === 'string' ? raw.image.trim() : '';
  if (frameWidth <= 0 || frameHeight <= 0 || unit <= 0 || !anchor || !image) return null;
  if (!/^(\/|https:\/\/)/.test(image)) return null;
  const frames = {};
  const source = raw.frames && typeof raw.frames === 'object' ? raw.frames : {};
  for (const name of Object.keys(source)) {
    if (!(name in POSES)) continue;
    const frame = source[name];
    if (!frame || typeof frame !== 'object') continue;
    const x = finite(frame.x, -1);
    const y = finite(frame.y, -1);
    if (x < 0 || y < 0) continue;
    const anchors = {};
    if (frame.anchors && typeof frame.anchors === 'object') {
      for (const key of ['head', 'neck', 'hand', 'offHand', 'offElbow', 'cloak']) {
        const p = point(frame.anchors[key]);
        if (p) anchors[key] = p;
      }
    }
    frames[name] = { x, y, anchors };
  }
  if (!frames.idle) return null;
  return {
    version: SPRITE_MANIFEST_VERSION,
    kind: raw.kind || kind || 'humanoid',
    image,
    frameWidth,
    frameHeight,
    unit,
    anchor,
    facing: raw.facing === 'left' ? -1 : 1,
    rigAligned: raw.rigAligned !== false,
    // Pixel-art sheets are drawn with image smoothing off so scaled pixels
    // stay square instead of blurring.
    pixelated: raw.pixelated === true,
    // The art already shows the character's weapons, so the stage must not
    // draw its own on top.
    weaponsInArt: raw.weaponsInArt === true,
    // Creature sheets can include their own complete head. Humanoid sheets
    // retain the portrait disc unless they explicitly opt out.
    portrait: raw.portrait !== false,
    // Complete creature art also owns its tail or cloak silhouette.
    secondary: raw.secondary !== false,
    cloak,
    frames,
  };
}

// Which frames to draw for a pose phase, with alphas. Sparse sheets carry
// one painted frame per pose, and two of them faded over each other read as
// a see-through ghost, so a blend cuts from one to the other halfway.
export function selectSpriteFrames(sheet, phase, easedT) {
  const idle = sheet.frames.idle;
  if (!phase) return [{ frame: idle, name: 'idle', alpha: 1 }];
  // A pose the sheet lacks falls back to the other pose of the blend, and
  // finally to idle; the reported name is the frame actually drawn.
  const fromName = sheet.frames[phase.from] ? phase.from : 'idle';
  const from = sheet.frames[fromName];
  const toName = sheet.frames[phase.to] ? phase.to : fromName;
  const to = sheet.frames[toName];
  const t = Math.max(0, Math.min(1, Number.isFinite(easedT) ? easedT : phase.t));
  if (from === to || t >= 0.5) return [{ frame: to, name: toName, alpha: 1 }];
  return [{ frame: from, name: fromName, alpha: 1 }];
}

// Destination rectangle for a frame so its ground anchor lands on
// (hipX, groundY) at the figure's scale, mirrored for left-facing figures.
// `stretch` scales vertically about the ground line.
export function placeSpriteFrame(sheet, unit, scale, hipX, groundY, facing, stretch = 1) {
  const s = (unit * scale) / sheet.unit;
  const width = sheet.frameWidth * s;
  const height = sheet.frameHeight * s * stretch;
  const anchorX = sheet.anchor.x * s;
  const anchorY = sheet.anchor.y * s * stretch;
  const mirrored = facing !== sheet.facing;
  return {
    scale: s,
    width,
    height,
    mirrored,
    // Top-left in stage space when not mirrored; when mirrored the caller
    // flips around hipX, so the left edge is measured from the flipped side.
    x: mirrored ? hipX - (width - anchorX) : hipX - anchorX,
    y: groundY - anchorY,
  };
}

// Converts a frame-space anchor (pixels inside one frame, unmirrored) into
// stage space using a placement from placeSpriteFrame().
export function anchorToStage(placement, anchor) {
  const localX = anchor.x * placement.scale;
  const localY = anchor.y * placement.scale;
  const out = {
    x: placement.mirrored
      ? placement.x + placement.width - localX
      : placement.x + localX,
    y: placement.y + localY,
  };
  if (Number.isFinite(anchor.r)) out.r = anchor.r * placement.scale;
  return out;
}

function manifestHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

// Loads manifests and images on demand. One entry per kind; failures are
// cached so a missing sheet costs one request, not one per frame.
export function createSpriteLibrary(options = {}) {
  const fetchImpl = options.fetch || null;
  const ImageCtor = options.Image || null;
  const basePath = options.basePath || '/assets/sprites/';
  const onReady = typeof options.onReady === 'function' ? options.onReady : () => {};
  const entries = new Map();

  function load(key) {
    if (!isSheetKey(key)) return null;
    if (entries.has(key)) return entries.get(key);
    const entry = { key, status: 'loading', sheet: null, image: null };
    entries.set(key, entry);
    if (!fetchImpl || !ImageCtor) {
      entry.status = 'unavailable';
      return entry;
    }
    let request;
    try {
      // Revalidate the manifest every load; a stale manifest against a new
      // image misplaces every anchor.
      request = fetchImpl(basePath + key + '.json', { cache: 'no-cache' });
    } catch (error) {
      entry.status = 'failed';
      return entry;
    }
    let manifestText = '';
    Promise.resolve(request)
      .then((response) => (response && response.ok ? response.text() : null))
      .then((text) => {
        if (typeof text !== 'string') return null;
        manifestText = text;
        try {
          return JSON.parse(text);
        } catch (error) {
          return null;
        }
      })
      .then((json) => {
        // A character or race sheet must still declare a body kind the
        // rig knows; the key itself does not carry one.
        const sheet = normalizeSpriteManifest(json, SPRITE_KINDS.includes(key) ? key : '');
        if (sheet && !SPRITE_KINDS.includes(sheet.kind)) {
          entry.status = 'failed';
          return;
        }
        if (!sheet) {
          entry.status = 'failed';
          return;
        }
        entry.sheet = sheet;
        const image = new ImageCtor();
        image.decoding = 'async';
        image.onload = () => {
          entry.image = image;
          entry.status = 'ready';
          onReady(key);
        };
        image.onerror = () => {
          entry.status = 'failed';
        };
        // Version the image by the manifest text so a re-baked sheet is never
        // paired with a cached image from the previous bake.
        image.src = sheet.image + (sheet.image.includes('?') ? '&' : '?') + 'v=' + manifestHash(manifestText);
      })
      .catch(() => {
        entry.status = 'failed';
      });
    return entry;
  }

  return {
    load,
    get(key) {
      const entry = load(key);
      return entry && entry.status === 'ready' ? entry : null;
    },
    // First ready sheet in preference order. Every key is requested, so a
    // more specific sheet that is still loading takes over on a later frame.
    pick(keys) {
      let best = null;
      for (const key of keys || []) {
        const entry = load(key);
        if (!best && entry && entry.status === 'ready') best = entry;
      }
      return best;
    },
    status(key) {
      const entry = entries.get(key);
      return entry ? entry.status : 'unloaded';
    },
    clear() {
      entries.clear();
    },
  };
}
