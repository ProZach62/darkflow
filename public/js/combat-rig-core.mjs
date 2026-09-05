// Procedural fighter rig for the canvas combat stage. Pure math: figures,
// poses, and joint geometry, with no drawing and no DOM. combat-stage.mjs
// renders what figureGeometry() returns.
//
// A figure is a stick-and-capsule body whose head is the portrait disc the
// stage already draws. Guild picks the weapon, race picks the scale, and NPC
// targets get a hunched beast variant. Pose names are the seam for later
// sprite sheets: whatever replaces the strokes only has to honor the same
// names and blend weights.

const HUMANOID = Object.freeze({
  kind: 'humanoid',
  torso: 0.78,
  neck: 0.14,
  head: 0.4,
  upperArm: 0.42,
  forearm: 0.4,
  thigh: 0.52,
  shin: 0.5,
  hipHeight: 1.02,
  limbWidth: 0.16,
  torsoWidth: 0.34,
  baseLean: 0,
});

const BEAST = Object.freeze({
  kind: 'beast',
  torso: 0.7,
  neck: 0.1,
  head: 0.42,
  upperArm: 0.5,
  forearm: 0.46,
  thigh: 0.42,
  shin: 0.42,
  hipHeight: 0.84,
  limbWidth: 0.2,
  torsoWidth: 0.46,
  baseLean: 0.55,
});

const WEAPON_BY_GUILD = Object.freeze({
  fighter: 'blade',
  berserker: 'blade',
  swashbuckler: 'blade',
  'street-samurai': 'blade',
  ninja: 'blade',
  thief: 'blade',
  charlatan: 'blade',
  bard: 'blade',
  mage: 'staff',
  acolyte: 'staff',
  druid: 'staff',
  artificer: 'staff',
  psionicist: 'staff',
  ranger: 'bow',
  monk: 'claws',
  garou: 'claws',
  vampire: 'claws',
  morpher: 'claws',
  dragon: 'claws',
});

const SCALE_BY_RACE = Object.freeze({
  pixie: 0.72,
  faerie: 0.76,
  sylph: 0.82,
  kender: 0.84,
  halfling: 0.84,
  'crannian-gnome': 0.84,
  'hyperborean-gnome': 0.84,
  'desert-dwarf': 0.9,
  'stone-dwarf': 0.9,
  'rift-duergar': 0.9,
  barbarian: 1.08,
  northman: 1.05,
  uruk: 1.12,
  scro: 1.1,
  'ice-gnoll': 1.12,
  'ice-ogre': 1.22,
  'swamp-troll': 1.2,
  yugoloth: 1.18,
  dragon: 1.25,
});

export const WEAPONS = Object.freeze(['blade', 'knife', 'axe', 'blunt', 'polearm', 'staff', 'bow', 'claws']);

function slug(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The equipment profile (from Char.Items) outranks guild: a wielded item
// with a recognized kind sets the weapon, an inventory with nothing wielded
// means bare hands, and an unrecognized name keeps the guild weapon.
function weaponFromEquipment(equipment, guildWeapon) {
  if (!equipment) return { weapon: guildWeapon, offKind: '' };
  const main = equipment.mainHand;
  const off = equipment.offHand;
  let weapon = guildWeapon;
  if (!main) weapon = 'claws';
  else if (main.kind && WEAPONS.includes(main.kind)) weapon = main.kind;
  const offKind = off && off.kind && WEAPONS.includes(off.kind) ? off.kind : '';
  return { weapon, offKind };
}

export function resolveFigure(combatant = {}, side = 'player') {
  const isBeast = side === 'target' && !!combatant.isNpc;
  const guild = slug(combatant.guild);
  const race = slug(combatant.race);
  const equipment = isBeast ? null : (combatant.equipment || null);
  const held = isBeast
    ? { weapon: 'claws', offKind: '' }
    : weaponFromEquipment(equipment, WEAPON_BY_GUILD[guild] || 'blade');
  return {
    kind: isBeast ? 'beast' : 'humanoid',
    proportions: isBeast ? BEAST : HUMANOID,
    weapon: held.weapon,
    offKind: held.offKind,
    shield: !!(equipment && equipment.shield),
    helmet: !!(equipment && equipment.helmet),
    armor: !!(equipment && equipment.bodyArmor),
    twoHanded: !!(equipment && equipment.twoHanded),
    scale: isBeast ? 1.08 : (SCALE_BY_RACE[race] || 1),
    facing: side === 'player' ? 1 : -1,
  };
}

// Joint angles in radians. Shoulders and hips measure from straight down,
// positive toward the facing direction. Elbows and knees are relative to the
// parent limb. `lean` rotates the torso forward about the hip; `hop` lifts
// the whole body in body units.
const REST = Object.freeze({
  lean: 0,
  hop: 0,
  headTilt: 0,
  rShoulder: 0.2,
  rElbow: -0.45,
  lShoulder: -0.15,
  lElbow: -0.35,
  rHip: 0.12,
  rKnee: -0.1,
  lHip: -0.12,
  lKnee: -0.1,
  weapon: 0.35,
});

function pose(overrides) {
  return Object.freeze({ ...REST, ...overrides });
}

export const POSES = Object.freeze({
  idle: REST,
  windup: pose({ lean: -0.18, rShoulder: -1.5, rElbow: -1.3, lShoulder: 0.5, lElbow: -0.6, rHip: -0.2, lHip: 0.25, weapon: -0.4 }),
  strike: pose({ lean: 0.38, hop: 0.04, rShoulder: 1.65, rElbow: 0.15, lShoulder: -0.6, lElbow: -0.3, rHip: 0.7, rKnee: -0.5, lHip: -0.55, lKnee: -0.25, weapon: 0.55 }),
  thrust: pose({ lean: 0.3, rShoulder: 1.5, rElbow: 0.05, lShoulder: -0.7, rHip: 0.75, rKnee: -0.5, lHip: -0.5, weapon: -0.1 }),
  cast: pose({ lean: 0.08, rShoulder: 1.25, rElbow: 0.35, lShoulder: 1.05, lElbow: 0.25, rHip: 0.35, lHip: -0.3, weapon: -1.2 }),
  draw: pose({ lean: 0.05, rShoulder: 0.95, rElbow: -2.3, lShoulder: 1.5, lElbow: 0.05, rHip: 0.3, lHip: -0.3, weapon: 0 }),
  loose: pose({ lean: 0.12, rShoulder: 0.6, rElbow: -0.6, lShoulder: 1.5, lElbow: 0.05, rHip: 0.35, lHip: -0.3, weapon: 0 }),
  maul: pose({ lean: 0.5, hop: 0.08, rShoulder: 1.35, rElbow: 0.5, lShoulder: 1.15, lElbow: 0.45, rHip: 0.7, rKnee: -0.6, lHip: -0.5, lKnee: -0.3, weapon: 0.4 }),
  whiff: pose({ lean: 0.55, hop: 0.02, rShoulder: 1.9, rElbow: 0.25, lShoulder: -0.8, rHip: 0.8, rKnee: -0.4, lHip: -0.6, weapon: 0.7 }),
  recoil: pose({ lean: -0.5, hop: 0.1, headTilt: -0.35, rShoulder: 0.95, rElbow: -1.7, lShoulder: 0.8, lElbow: -1.6, rHip: -0.4, rKnee: -0.45, lHip: 0.35, lKnee: -0.35, weapon: 0.9 }),
  dodge: pose({ lean: -0.65, hop: 0.36, headTilt: -0.2, rShoulder: 0.6, rElbow: -1.2, lShoulder: 0.4, lElbow: -1.0, rHip: 0.95, rKnee: -1.5, lHip: 0.85, lKnee: -1.45, weapon: 0.6 }),
  guard: pose({ lean: -0.12, rShoulder: 1.15, rElbow: -2.05, lShoulder: 1.05, lElbow: -2.0, rHip: 0.25, lHip: -0.2, weapon: 1.3 }),
  raise: pose({ lean: -0.22, rShoulder: -2.7, rElbow: -0.4, lShoulder: 0.4, lElbow: -0.5, rHip: -0.2, lHip: 0.25, weapon: 0.2 }),
  chop: pose({ lean: 0.48, hop: 0.05, rShoulder: 1.15, rElbow: 0.3, lShoulder: -0.5, lElbow: -0.3, rHip: 0.75, rKnee: -0.5, lHip: -0.55, lKnee: -0.25, weapon: 0.95 }),
});

export const STRIKE_POSE_BY_WEAPON = Object.freeze({
  blade: 'strike',
  knife: 'thrust',
  axe: 'chop',
  blunt: 'chop',
  polearm: 'thrust',
  staff: 'cast',
  bow: 'loose',
  claws: 'maul',
});

const WINDUP_POSE_BY_WEAPON = Object.freeze({
  blade: 'windup',
  knife: 'windup',
  axe: 'raise',
  blunt: 'raise',
  polearm: 'windup',
  staff: 'windup',
  bow: 'draw',
  claws: 'windup',
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function easeInOut(t) {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function lerp(a, b, t) {
  // Exact endpoints so a finished blend lands on the pose, not a float near it.
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

// Which poses a side is blending between at `progress` of an action, given
// its role in that action. Returns null when the side just idles.
export function posePhase(role, action, progress, weapon = 'blade') {
  const p = clamp01(progress);
  const contact = 0.16;
  if (role === 'actor') {
    const windup = WINDUP_POSE_BY_WEAPON[weapon] || 'windup';
    const strike = action.result === 'miss'
      ? 'whiff'
      : (STRIKE_POSE_BY_WEAPON[weapon] || 'strike');
    if (p < 0.1) return { from: 'idle', to: windup, t: p / 0.1 };
    if (p < 0.2) return { from: windup, to: strike, t: (p - 0.1) / 0.1 };
    if (p < 0.6) return { from: strike, to: 'idle', t: (p - 0.2) / 0.4 };
    return null;
  }
  if (role === 'impact') {
    if (action.landed) {
      if (p < contact) return null;
      if (p < 0.3) return { from: 'idle', to: 'recoil', t: (p - contact) / (0.3 - contact) };
      if (p < 0.72) return { from: 'recoil', to: 'idle', t: (p - 0.3) / 0.42 };
      return null;
    }
    if (action.result === 'dodge') {
      if (p < 0.08) return null;
      if (p < 0.26) return { from: 'idle', to: 'dodge', t: (p - 0.08) / 0.18 };
      if (p < 0.66) return { from: 'dodge', to: 'idle', t: (p - 0.26) / 0.4 };
      return null;
    }
    if (action.result === 'absorb') {
      if (p < 0.08) return null;
      if (p < 0.22) return { from: 'idle', to: 'guard', t: (p - 0.08) / 0.14 };
      if (p < 0.5) return { from: 'guard', to: 'guard', t: 1 };
      if (p < 0.78) return { from: 'guard', to: 'idle', t: (p - 0.5) / 0.28 };
      return null;
    }
  }
  return null;
}

// Concrete joint parameters for a phase, blended with an idle breath.
export function resolvePose(phase, now = 0, options = {}) {
  const reduced = !!options.reducedMotion;
  const from = POSES[phase && phase.from] || REST;
  const to = POSES[phase && phase.to] || from;
  const t = phase ? easeInOut(phase.t) : 0;
  const out = {};
  for (const key of Object.keys(REST)) out[key] = lerp(from[key], to[key], t);
  if (!reduced) {
    const breath = Math.sin(now / 900 + (options.phaseOffset || 0));
    out.lean += breath * 0.03;
    out.rShoulder += breath * 0.03;
    out.lShoulder -= breath * 0.03;
  }
  return out;
}

function limb(origin, length, angle, facing) {
  // Angle measured from straight down, positive toward facing.
  return {
    x: origin.x + Math.sin(angle) * length * facing,
    y: origin.y + Math.cos(angle) * length,
  };
}

// Joint positions in canvas pixels. `unit` is the body unit in pixels,
// `groundY` the line the feet stand on, `x` the hip x position.
export function figureGeometry(figure, joints, x, groundY, unit) {
  const p = figure.proportions;
  const u = unit * figure.scale;
  const facing = figure.facing;
  const lean = p.baseLean + joints.lean;
  const hip = { x, y: groundY - (p.hipHeight - joints.hop) * u };
  // Torso rotates about the hip; "up" is -y so a forward lean moves the
  // shoulder toward the facing direction.
  const shoulder = {
    x: hip.x + Math.sin(lean) * p.torso * u * facing,
    y: hip.y - Math.cos(lean) * p.torso * u,
  };
  const headTilt = lean * 0.6 + joints.headTilt;
  const neckLength = (p.neck + p.head) * u;
  const head = {
    x: shoulder.x + Math.sin(headTilt) * neckLength * facing,
    y: shoulder.y - Math.cos(headTilt) * neckLength,
    r: p.head * u,
  };
  const rElbowPos = limb(shoulder, p.upperArm * u, joints.rShoulder + lean, facing);
  const rHand = limb(rElbowPos, p.forearm * u, joints.rShoulder + lean + joints.rElbow, facing);
  const lElbowPos = limb(shoulder, p.upperArm * u, joints.lShoulder + lean, facing);
  const lHand = limb(lElbowPos, p.forearm * u, joints.lShoulder + lean + joints.lElbow, facing);
  const rKneePos = limb(hip, p.thigh * u, joints.rHip, facing);
  const rFoot = limb(rKneePos, p.shin * u, joints.rHip + joints.rKnee, facing);
  const lKneePos = limb(hip, p.thigh * u, joints.lHip, facing);
  const lFoot = limb(lKneePos, p.shin * u, joints.lHip + joints.lKnee, facing);
  const weaponAngle = joints.rShoulder + lean + joints.rElbow + joints.weapon;
  const offAngle = joints.lShoulder + lean + joints.lElbow + joints.weapon;
  return {
    unit: u,
    facing,
    hip,
    shoulder,
    head,
    arms: {
      right: { shoulder, elbow: rElbowPos, hand: rHand },
      left: { shoulder, elbow: lElbowPos, hand: lHand },
    },
    legs: {
      right: { hip, knee: rKneePos, foot: rFoot },
      left: { hip, knee: lKneePos, foot: lFoot },
    },
    weapon: {
      kind: figure.weapon,
      hand: rHand,
      offHand: lHand,
      // Direction the weapon points, as a unit vector.
      dx: Math.sin(weaponAngle) * facing,
      dy: Math.cos(weaponAngle),
      offKind: figure.offKind || '',
      offDx: Math.sin(offAngle) * facing,
      offDy: Math.cos(offAngle),
    },
    shield: !!figure.shield,
    helmet: !!figure.helmet,
    armor: !!figure.armor,
    twoHanded: !!figure.twoHanded,
    limbWidth: p.limbWidth * u,
    torsoWidth: p.torsoWidth * u * (figure.armor ? 1.25 : 1),
  };
}

// Height of the standing figure above the ground line, in pixels, so the
// stage can budget vertical space.
export function figureHeight(figure, unit) {
  const p = figure.proportions;
  return (p.hipHeight + p.torso + p.neck + p.head * 2) * unit * figure.scale;
}
