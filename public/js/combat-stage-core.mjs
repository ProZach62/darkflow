// Pure scene math for the canvas combat stage. Nothing in this module touches
// the DOM or a drawing context, so the timeline that turns one
// Darkwind.Combat event into token motion, effects, and numbers can be tested
// deterministically in Node. combat-stage.mjs owns the canvas and draws what
// sampleAction() reports for a given moment.

import { getPrimaryTerrain } from './terrain-semantics.mjs';

export const STAGE_SIDES = Object.freeze(['player', 'target']);

// Terrain tiles already shipped for the map double as stage backdrops. Every
// canonical terrain token has a tile, so the lookup is a whitelist rather
// than string concatenation on server text.
const STAGE_BACKDROP_TILES = new Set([
  'arctic', 'barren', 'beach', 'canopy', 'city', 'desert', 'farm', 'forest',
  'hills', 'inside', 'jungle', 'lake', 'mountain', 'outside', 'path',
  'plains', 'river', 'road', 'sea', 'sky', 'swamp', 'underground',
  'underwater',
]);

const RESULT_TINTS = Object.freeze({
  hit: '#f0bd69',
  critical: '#ffd48a',
  miss: '#8fa3b3',
  dodge: '#7ee7df',
  absorb: '#b4abff',
});

export const ACTION_DURATION_MS = 900;
// Fraction of an action at which the blow lands. The sound cue fires here too.
export const ACTION_CONTACT_FRACTION = 0.16;

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutQuad(t) {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

// A lunge goes out fast and settles back: 0 at start, 1 at the apex, 0 at end.
export function lungeCurve(t) {
  const x = clamp01(t);
  if (x < 0.42) return easeOutCubic(x / 0.42);
  return 1 - easeInOutQuad((x - 0.42) / 0.58);
}

export function resultTint(result) {
  return RESULT_TINTS[result] || RESULT_TINTS.hit;
}

// Small deterministic generator so particle bursts are reproducible per
// event sequence. The stage never needs cryptographic randomness.
export function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeStageLayout(width, height) {
  const w = Math.max(1, Number(width) || 0);
  const h = Math.max(1, Number(height) || 0);
  const radius = Math.max(22, Math.min(w * 0.13, h * 0.3, 120));
  const groundY = h * 0.62;
  return {
    width: w,
    height: h,
    radius,
    groundY,
    player: { x: w * 0.27, y: groundY - radius * 0.1 },
    target: { x: w * 0.73, y: groundY - radius * 0.1 },
    compact: w < 360 || h < 170,
  };
}

// The stage is a scene between fights: the player alone in the room. With no
// opponent present the player stands at the centre; as one arrives the player
// steps to the duel position on the left. `duel` is the opponent's presence,
// 0 (absent) to 1 (fully on stage), and the shift follows it smoothly.
export function sceneLayout(layout, duel) {
  const k = Math.max(0, Math.min(1, Number(duel) || 0));
  const eased = k * k * (3 - 2 * k);
  const soloX = layout.width * 0.5;
  return {
    ...layout,
    duel: k,
    player: { ...layout.player, x: soloX + (layout.player.x - soloX) * eased },
  };
}

// How the opponent's token looks partway through its entrance (or exit):
// it drops in from above, growing and fading up to full presence. Reduced
// motion cuts straight between absent and present.
export function targetEntrance(presence, reducedMotion) {
  const p = Math.max(0, Math.min(1, Number(presence) || 0));
  if (reducedMotion) return { alpha: p > 0 ? 1 : 0, y: 0, scale: 1 };
  const eased = 1 - Math.pow(1 - p, 3);
  return {
    alpha: Math.min(1, p * 1.6),
    y: -(1 - eased) * 1.4 || 0,
    scale: 0.86 + 0.14 * eased,
  };
}

// Scene activities are short animations the player's figure plays between
// fights, driven by what the player does in the world: a look glances left
// and right and shades the eyes; a walk carries the figure in from the edge
// of the stage when the room changes, facing the way it travelled.
export const SCENE_ACTION_MS = Object.freeze({ look: 1500, walk: 900 });

export function buildSceneAction(activity, startedAt) {
  const kind = activity && typeof activity === 'object' ? String(activity.kind || '') : '';
  const duration = SCENE_ACTION_MS[kind];
  if (!duration) return null;
  return {
    kind,
    facing: Number(activity.facing) < 0 ? -1 : 1,
    seq: Number.isFinite(Number(activity.seq)) ? Number(activity.seq) : 0,
    startedAt: Number(startedAt) || 0,
    duration,
  };
}

const SCENE_REST = Object.freeze({ x: 0, y: 0, alpha: 1, facing: 0, phase: null });

// A half-sine hop of `height` spanning [at, at + width] of the progress.
function hop(progress, at, width, height) {
  const k = (progress - at) / width;
  if (k <= 0 || k >= 1) return 0;
  return Math.sin(k * Math.PI) * height;
}

// The figure's offsets (in stage radii), facing (0 keeps the default), and
// rig pose phase at time t. Reduced motion holds the figure still for the
// action's duration so the scene never jumps.
export function sampleSceneAction(action, t, options = {}) {
  const elapsed = t - action.startedAt;
  const progress = Math.max(0, Math.min(1, elapsed / action.duration));
  const done = elapsed >= action.duration;
  const base = { ...SCENE_REST, kind: action.kind, progress, active: !done };
  if (options.reducedMotion || done) return base;
  if (action.kind === 'look') {
    // Turn to glance left, hold, turn back, then shade the eyes for a beat.
    const facing = progress < 0.16 ? 0 : (progress < 0.5 ? -1 : 1);
    const y = hop(progress, 0.16, 0.14, 0.04) + hop(progress, 0.5, 0.14, 0.04);
    const shade = progress >= 0.56 ? Math.min(1, (progress - 0.56) / 0.12) : 0;
    const settle = progress >= 0.86 ? (progress - 0.86) / 0.14 : 0;
    let phase = null;
    if (settle > 0) phase = { from: 'look', to: 'idle', t: settle, ease: 'settle' };
    else if (shade > 0) phase = { from: 'idle', to: 'look', t: shade, ease: 'settle' };
    return { ...base, y, facing, phase };
  }
  // A walk: enter from the edge opposite the facing, striding, then settle.
  const dir = action.facing;
  const arrive = Math.min(1, progress / 0.82);
  const remaining = Math.pow(1 - arrive, 3);
  const settling = progress >= 0.82 ? (progress - 0.82) / 0.18 : 0;
  const stride = Math.abs(Math.sin(progress * Math.PI * 4)) * (1 - settling);
  const cycle = (progress * 4) % 1;
  let phase;
  if (settling > 0) phase = { from: 'stepA', to: 'idle', t: settling, ease: 'settle' };
  else if (cycle < 0.5) phase = { from: 'stepA', to: 'stepB', t: cycle * 2, ease: 'settle' };
  else phase = { from: 'stepB', to: 'stepA', t: (cycle - 0.5) * 2, ease: 'settle' };
  return {
    ...base,
    x: -dir * 1.9 * remaining,
    y: stride * 0.05,
    alpha: Math.min(1, progress / 0.2),
    facing: dir,
    phase,
  };
}

// A room image URL is only ever drawn, never read back, so the stage accepts
// any http(s) or root-relative address and lets the image element decide.
function stageImageUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 2048) return '';
  return /^(?:https?:\/\/|\/)[^\s]+$/i.test(text) ? text : '';
}

// The backdrop is the room's own image when the server has sent one, with
// the terrain tile behind it as the fallback and as the choice for rooms
// without art.
export function resolveStageBackdrop(room, image) {
  const environment = room && typeof room === 'object'
    ? [room.terrain, room.environment, room.env, room.type]
    : room;
  const terrain = getPrimaryTerrain(environment);
  const art = stageImageUrl(image && typeof image === 'object' ? image.url : image);
  if (!STAGE_BACKDROP_TILES.has(terrain)) {
    return { terrain: 'outside', tile: '/assets/tiles/outside.jpg', image: art };
  }
  return { terrain, tile: '/assets/tiles/' + terrain + '.jpg', image: art };
}

// Which token acts and which absorbs the outcome. Perspective is the
// recipient-safe source of truth; actor ids only matter for observed fights.
export function resolveActionSides(event, view) {
  if (!event) return { actor: '', impact: '' };
  const playerId = view && view.player ? view.player.id : 'self';
  const targetId = view && view.target ? view.target.id : '';
  if (event.perspective === 'outgoing') return { actor: 'player', impact: 'target' };
  if (event.perspective === 'incoming') return { actor: 'target', impact: 'player' };
  let actor = '';
  let impact = '';
  if (event.actorId === playerId) actor = 'player';
  else if (event.actorId === targetId) actor = 'target';
  if (event.targetId === playerId) impact = 'player';
  else if (event.targetId === targetId) impact = 'target';
  if (actor && !impact) impact = actor === 'player' ? 'target' : 'player';
  if (impact && !actor) actor = impact === 'player' ? 'target' : 'player';
  return { actor, impact };
}

function damageValue(event) {
  if (!event) return null;
  if (Object.prototype.hasOwnProperty.call(event, 'damage')) {
    const value = Number(event.damage);
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  return null;
}

function particleBurst(seed, count, spread) {
  const random = createSeededRandom(seed);
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = spread * (0.45 + random() * 0.55);
    particles.push({
      angle,
      speed,
      size: 1.5 + random() * 2.5,
      life: 0.55 + random() * 0.45,
    });
  }
  return particles;
}

// Build one self-contained action from an event. The action describes what
// happens over ACTION_DURATION_MS relative to startedAt; sampleAction() turns
// that into concrete offsets for a frame.
export function buildAction(event, view, startedAt = 0) {
  if (!event || !event.result) return null;
  const sides = resolveActionSides(event, view);
  if (!sides.actor || !sides.impact) return null;
  const result = String(event.result);
  const seq = Number(event.seq) || 0;
  const critical = result === 'critical';
  const landed = result === 'hit' || critical;
  const damage = damageValue(event);
  const burstCount = critical ? 26 : (landed ? 14 : 0);
  return {
    seq,
    result,
    perspective: event.perspective || '',
    actorSide: sides.actor,
    impactSide: sides.impact,
    startedAt,
    duration: ACTION_DURATION_MS,
    damage,
    critical,
    landed,
    tint: resultTint(result),
    particles: burstCount ? particleBurst(seq * 7919 + 17, burstCount, critical ? 1.6 : 1) : [],
  };
}

function zeroOffset() {
  return { x: 0, y: 0, scale: 1, alpha: 1, flash: 0 };
}

// Sample an action at absolute time `now`. Offsets are in units of the token
// radius so the drawing layer can scale them to the stage.
export function sampleAction(action, now, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const player = zeroOffset();
  const target = zeroOffset();
  const empty = {
    active: false,
    progress: 1,
    player,
    target,
    shake: 0,
    flash: 0,
    effects: [],
    number: null,
    badge: null,
  };
  if (!action) return empty;
  const elapsed = now - action.startedAt;
  if (elapsed < 0) return { ...empty, active: true, progress: 0 };
  const progress = clamp01(elapsed / action.duration);
  if (progress >= 1) return empty;

  const offsets = { player, target };
  const actor = offsets[action.actorSide];
  const victim = offsets[action.impactSide];
  const direction = action.actorSide === 'player' ? 1 : -1;
  const effects = [];
  let shake = 0;
  let flash = 0;

  // Timeline in normalized progress: lunge 0-0.36 (contact at 0.16),
  // outcome 0.16-0.7, numbers drift until the end.
  const contactAt = ACTION_CONTACT_FRACTION;
  const afterContact = clamp01((progress - contactAt) / (1 - contactAt));

  if (!reducedMotion) {
    const lunge = lungeCurve(progress / 0.36);
    // The strike pose steps the front foot forward, so the body itself only
    // needs a short lunge to close distance.
    actor.x = direction * lunge * 0.7;
    actor.y = -lunge * 0.18;
    actor.scale = 1 + lunge * 0.04;

    if (action.landed && progress >= contactAt) {
      const recoil = clamp01((progress - contactAt) / 0.34);
      const kick = (1 - easeOutCubic(recoil)) * (action.critical ? 0.55 : 0.32);
      victim.x = direction * kick;
      victim.flash = Math.max(0, 1 - recoil * 1.4);
      victim.scale = 1 - kick * 0.12;
      shake = (action.impactSide === 'player' ? 1 : 0.45)
        * (action.critical ? 1.4 : 1)
        * Math.max(0, 1 - recoil * 1.25);
      flash = action.impactSide === 'player' ? Math.max(0, 1 - recoil * 1.6) : 0;
    } else if (action.result === 'dodge' && progress >= contactAt * 0.6) {
      const t = clamp01((progress - contactAt * 0.6) / 0.5);
      const slip = Math.sin(t * Math.PI);
      // Slip far enough to read as a sidestep but stay inside a narrow pane.
      victim.x = direction * slip * 0.32;
      victim.y = -slip * 0.22;
      victim.alpha = 1 - slip * 0.45;
    } else if (action.result === 'absorb' && progress >= contactAt) {
      const t = clamp01((progress - contactAt) / 0.4);
      victim.scale = 1 + Math.sin(t * Math.PI) * 0.05;
    } else if (action.result === 'miss' && progress >= contactAt) {
      // The victim barely reacts; the whiff arc carries the story.
      victim.x = direction * Math.sin(afterContact * Math.PI) * 0.08;
    }
  }

  if (progress >= contactAt) {
    if (action.landed) {
      effects.push({
        type: 'slash',
        side: action.impactSide,
        direction,
        progress: clamp01((progress - contactAt) / 0.38),
        critical: action.critical,
        tint: action.tint,
      });
      effects.push({
        type: 'burst',
        side: action.impactSide,
        progress: clamp01((progress - contactAt) / 0.5),
        particles: reducedMotion ? [] : action.particles,
        critical: action.critical,
        tint: action.tint,
      });
    } else if (action.result === 'miss') {
      effects.push({
        type: 'whiff',
        side: action.impactSide,
        direction,
        progress: clamp01((progress - contactAt) / 0.42),
        tint: action.tint,
      });
    } else if (action.result === 'dodge') {
      effects.push({
        type: 'ghost',
        side: action.impactSide,
        direction,
        progress: clamp01((progress - contactAt) / 0.5),
        tint: action.tint,
      });
    } else if (action.result === 'absorb') {
      effects.push({
        type: 'shield',
        side: action.impactSide,
        progress: clamp01((progress - contactAt) / 0.55),
        tint: action.tint,
      });
    }
  }

  let number = null;
  if (action.damage !== null && progress >= contactAt) {
    number = {
      side: action.impactSide,
      value: action.damage,
      progress: afterContact,
      rise: reducedMotion ? 0 : easeOutCubic(afterContact) * 1.6,
      alpha: reducedMotion
        ? (afterContact > 0.85 ? 1 - (afterContact - 0.85) / 0.15 : 1)
        : (afterContact < 0.12 ? afterContact / 0.12 : 1 - Math.pow(afterContact, 3)),
      scale: reducedMotion ? 1 : 0.8 + easeOutCubic(Math.min(1, afterContact * 3)) * 0.25,
      critical: action.critical,
      tint: action.tint,
    };
  }

  const badge = progress >= contactAt
    ? {
      side: action.impactSide,
      result: action.result,
      progress: afterContact,
      alpha: afterContact > 0.78 ? 1 - (afterContact - 0.78) / 0.22 : 1,
      tint: action.tint,
    }
    : null;

  return {
    active: true,
    progress,
    player,
    target,
    shake: reducedMotion ? 0 : shake,
    flash: reducedMotion ? 0 : flash,
    effects,
    number,
    badge,
  };
}

// Idle breathing keeps the tokens alive between exchanges without motion
// that competes with an action. Reduced motion pins it flat.
export function idleOffset(side, now, reducedMotion) {
  if (reducedMotion) return { x: 0, y: 0 };
  const phase = side === 'player' ? 0 : Math.PI * 0.7;
  const t = (now / 1000) * Math.PI * 0.9 + phase;
  return { x: 0, y: Math.sin(t) * 0.05 };
}

// Other players in the room stand in a band behind the main figures on the
// idle scene: smaller, further back, and never on top of the player's spot.
// The band holds at most MAX_BYSTANDERS; the rest are counted in `overflow`.
export const MAX_BYSTANDERS = 6;
export const BYSTANDER_MS = { in: 360, out: 300 };

// `avoid` lists x positions already taken (the party's spots); candidate
// slots near them are passed over like the one the player stands in.
export function bystanderLayout(layout, count, avoid = []) {
  const wanted = Math.max(0, Math.min(MAX_BYSTANDERS, Math.trunc(Number(count)) || 0));
  const overflow = Math.max(0, (Math.trunc(Number(count)) || 0) - wanted);
  const scale = 0.62;
  const radius = layout.radius * scale;
  const groundY = layout.groundY - layout.radius * 0.55;
  const spots = [];
  if (wanted > 0) {
    const margin = radius * 1.4;
    const span = Math.max(0, layout.width - margin * 2);
    const keepOut = layout.radius * 1.15;
    // Spread candidate slots across the band, drop the ones the player
    // stands in front of, and widen the spread until enough remain.
    for (let slots = wanted; slots <= wanted + 6 && spots.length < wanted; slots += 1) {
      spots.length = 0;
      for (let index = 0; index < slots; index += 1) {
        const x = slots === 1 ? layout.width / 2 : margin + (span * index) / (slots - 1);
        if (Math.abs(x - layout.player.x) < keepOut) continue;
        if (avoid.some((taken) => Math.abs(x - taken) < radius * 1.3)) continue;
        spots.push({ x, y: groundY - radius * 0.1 });
      }
    }
    spots.length = Math.min(spots.length, wanted);
  }
  return { scale, radius, groundY, spots, overflow };
}

// How a bystander looks partway through arriving (or leaving): fading in
// while settling down onto the ground line.
export function bystanderPresence(presence, reducedMotion) {
  const p = Math.max(0, Math.min(1, Number(presence) || 0));
  if (reducedMotion) return { alpha: p > 0 ? 1 : 0, y: 0 };
  const eased = 1 - Math.pow(1 - p, 3);
  return { alpha: p, y: -(1 - eased) * 0.3 || 0 };
}

// --- Scene sound cues ---------------------------------------------------------
// The Scene names a sound for what it is about to show; the host decides
// whether to play it. Names are the client's own combat sounds.
const SOUND_BY_RESULT = Object.freeze({
  hit: 'hit',
  critical: 'critical',
  miss: 'miss',
  dodge: 'dodge',
  absorb: 'absorb',
});

// A fight the player is only watching is quieter than their own.
export function actionSoundCue(action) {
  if (!action) return null;
  const sound = SOUND_BY_RESULT[action.result];
  if (!sound) return null;
  const observed = action.perspective === 'observed';
  const volume = observed ? 0.45 : (action.critical ? 1 : 0.8);
  return { sound, volume, delayMs: Math.round(action.duration * ACTION_CONTACT_FRACTION) };
}

// Start, victory, and death, from the change between two encounter states
// ({ active, outcome }). A null previous state is the first look at a fight
// already under way, which gets no cue.
export function encounterSoundCue(previous, next) {
  if (!previous || !next) return null;
  if (!previous.active && next.active) return { sound: 'start', volume: 0.7, delayMs: 0 };
  if (previous.active && !next.active) {
    const outcome = String(next.outcome || '').toLowerCase();
    if (outcome === 'victory') return { sound: 'victory', volume: 0.8, delayMs: 0 };
    if (outcome === 'defeat' || outcome === 'death') return { sound: 'death', volume: 0.8, delayMs: 0 };
  }
  return null;
}

// --- Day and night ------------------------------------------------------------
// A multiply tint for the backdrop and a lighter one over the figures, from
// the sky's stage and how much moonlight there is. Daylight and rooms with no
// sky get none. The moonlight scale is not documented, so it is folded into
// 0..1 with a saturating curve: any scale gives a sensible lift.
const SKYLESS_TERRAINS = new Set(['inside', 'underground', 'underwater']);

export function sceneAmbience(sky, terrain) {
  if (!sky || typeof sky !== 'object' || SKYLESS_TERRAINS.has(terrain)) return null;
  const stage = String(sky.stage || '');
  if (stage === 'dawn') {
    return { key: 'dawn', color: '#ffb27a', backdrop: 0.3, figures: 0.08 };
  }
  if (stage === 'twilight') {
    return { key: 'twilight', color: '#8a62a8', backdrop: 0.4, figures: 0.12 };
  }
  if (stage === 'night') {
    const raw = Number(sky.moonLight);
    const moon = Number.isFinite(raw) && raw > 0 ? 1 - Math.exp(-raw / 4) : 0;
    const step = Math.round(moon * 5);
    return {
      key: 'night:' + step,
      color: '#22335f',
      backdrop: 0.54 - (step / 5) * 0.2,
      figures: 0.2 - (step / 5) * 0.08,
    };
  }
  return null;
}

// --- Group allies ---------------------------------------------------------------
// Party members who are in the room stand behind the player, on the player's
// side, through the fight as well as at rest.
export const MAX_ALLIES = 4;

function memberIsHere(here) {
  if (here === undefined || here === null || here === '') return true;
  if (here === true || here === 1) return true;
  return /^(yes|y|true|1)$/i.test(String(here).trim());
}

// The group's other members who are here, in party order: { name, key,
// leader, hpPct }. hpPct is 0..100, or null when the member's health is not
// known. The player's own entry is dropped.
export function partyAllies(group, selfName) {
  if (!group || typeof group !== 'object' || !Array.isArray(group.members)) return [];
  const self = String(selfName || '').trim().toLowerCase();
  const leader = String(group.leader || '').trim().toLowerCase();
  const seen = new Set();
  const allies = [];
  for (const member of group.members) {
    const name = member && typeof member.name === 'string' ? member.name.trim() : '';
    const key = name.toLowerCase();
    if (!name || key === self || seen.has(key)) continue;
    seen.add(key);
    const info = member.info && typeof member.info === 'object' ? member.info : {};
    if (!memberIsHere(info.here)) continue;
    const hp = Number(info.hp);
    const maxhp = Number(info.maxhp);
    const hpPct = Number.isFinite(hp) && maxhp > 0
      ? Math.max(0, Math.min(100, (hp / maxhp) * 100))
      : null;
    allies.push({ name, key, leader: !!leader && key === leader, hpPct });
  }
  return allies;
}

// Spots for the allies, behind the player. With room to spare (the idle scene,
// where the player stands mid-stage) they form a rank stepping away to the
// left at one size, and carry name captions. In a fight the player stands near
// the edge and there is no room, so the rank recedes diagonally instead: each
// ally a little further back, higher, and smaller than the last, with no
// captions to collide. Each spot carries its own scale, radius, and depth.
export function allyLayout(layout, count) {
  const total = Math.max(0, Math.trunc(Number(count)) || 0);
  const wanted = Math.min(MAX_ALLIES, total);
  const scale = 0.7;
  const radius = layout.radius * scale;
  const groundY = layout.groundY - layout.radius * 0.3;
  const margin = radius * 1.1;
  const nearest = layout.player.x - layout.radius * 1.3;
  const room = Math.max(0, nearest - margin);
  const tight = wanted > 0 && (nearest < margin || (wanted > 1 && room / (wanted - 1) < radius * 1.2));
  const spots = [];
  for (let index = 0; index < wanted; index += 1) {
    if (tight) {
      const spotScale = scale - 0.06 * index;
      const spotRadius = layout.radius * spotScale;
      spots.push({
        x: Math.max(spotRadius * 0.9, layout.player.x - layout.radius * (0.85 + 0.5 * index)),
        depth: layout.radius * (0.1 + 0.3 * index),
        scale: spotScale,
        radius: spotRadius,
      });
    } else {
      const gap = wanted > 1 ? Math.min(radius * 1.7, room / (wanted - 1)) : 0;
      spots.push({
        x: Math.max(margin, nearest - gap * index),
        depth: index % 2 ? radius * 0.24 : 0,
        scale,
        radius,
      });
    }
  }
  return { scale, radius, groundY, spots, overflow: total - wanted, tight, captions: !tight };
}

export function allyHealthColor(hpPct, palette) {
  if (hpPct <= 25) return palette.danger;
  if (hpPct <= 50) return '#d29922';
  return palette.accent;
}

// --- Buff and debuff auras ------------------------------------------------------
export const AURA_EXPIRING_SECONDS = 10;

// Counts of active buffs and debuffs, and whether a timed buff is in its last
// seconds. receivedAtFor(item) says when the entry arrived, since the server
// sends a countdown only once.
export function summarizeAuras(defences, receivedAtFor, nowMs) {
  let buffs = 0;
  let debuffs = 0;
  let expiring = false;
  for (const item of Array.isArray(defences) ? defences : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.kind === 'debuff') { debuffs += 1; continue; }
    if (item.kind === 'unknown') continue;
    buffs += 1;
    const duration = Number(item.duration) || 0;
    if (duration <= 0) continue;
    const sent = Number(item.remaining);
    const remaining = Number.isFinite(sent) ? sent : duration;
    const receivedAt = typeof receivedAtFor === 'function' ? Number(receivedAtFor(item)) : nowMs;
    const left = remaining - Math.max(0, (nowMs - (Number.isFinite(receivedAt) ? receivedAt : nowMs)) / 1000);
    if (left > 0 && left <= AURA_EXPIRING_SECONDS) expiring = true;
  }
  return { buffs, debuffs, expiring, key: buffs + ':' + debuffs + ':' + (expiring ? 1 : 0) };
}

// How strongly each aura shows at time t. More buffs glow brighter, up to four;
// the glow breathes slowly and flickers when a buff is about to lapse. With
// reduced motion both are steady and the lapse shows as a dashed ring instead.
export function auraLook(auras, t, reducedMotion) {
  const none = { buff: 0, debuff: 0, dashed: false };
  if (!auras || typeof auras !== 'object') return none;
  const buffs = Math.max(0, Math.min(4, Math.trunc(Number(auras.buffs)) || 0));
  const debuffs = Math.max(0, Math.min(3, Math.trunc(Number(auras.debuffs)) || 0));
  if (!buffs && !debuffs) return none;
  const breath = reducedMotion ? 1 : 0.86 + 0.14 * Math.sin(t / 900);
  const flicker = auras.expiring && !reducedMotion ? 0.5 + 0.5 * Math.abs(Math.sin(t / 140)) : 1;
  return {
    buff: buffs ? (0.16 + 0.07 * buffs) * breath * flicker : 0,
    debuff: debuffs ? (0.2 + 0.08 * debuffs) * breath : 0,
    dashed: !!auras.expiring,
  };
}

// --- Bosses -------------------------------------------------------------------
// The game appends "(BOSS)" to the name of every boss, as in "Aurora, Captain
// of the Dawnbound (BOSS)". That tag is the signal; nothing else in the data
// marks one. The player can also star an untagged enemy by hand. Marked names
// are compared without the tag, their article, case, or spacing, so "A swamp
// troll" and "the  Swamp Troll (BOSS)" are the same enemy.
export function hasBossTag(name) {
  return /\(\s*boss\s*\)/i.test(String(name || ''));
}

export function bossKey(name) {
  return String(name || '')
    .replace(/\(\s*boss\s*\)/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:an?|the|some)\s+/, '');
}

export function isBossName(name, keys) {
  const key = bossKey(name);
  if (!key || !keys) return false;
  return typeof keys.has === 'function' ? keys.has(key) : Array.isArray(keys) && keys.includes(key);
}

