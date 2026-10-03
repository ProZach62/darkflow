// Generated transparent weapon art and the grip metadata needed to attach it
// to the procedural combat rig. The source paintings face right; the stage
// rotates them to the weapon vector for each pose.

const WEAPON_ROOT = '/assets/sprites/weapons/';

export const WEAPON_SPRITES = Object.freeze({
  sword: Object.freeze({ image: WEAPON_ROOT + 'sword.png', width: 388, height: 151, pivot: Object.freeze({ x: 70, y: 76 }), reach: 1.2 }),
  axe: Object.freeze({ image: WEAPON_ROOT + 'axe.png', width: 365, height: 193, pivot: Object.freeze({ x: 146, y: 72 }), reach: 1.05 }),
  hammer: Object.freeze({ image: WEAPON_ROOT + 'hammer.png', width: 396, height: 180, pivot: Object.freeze({ x: 154, y: 90 }), reach: 0.95 }),
  spear: Object.freeze({ image: WEAPON_ROOT + 'spear.png', width: 424, height: 41, pivot: Object.freeze({ x: 140, y: 21 }), reach: 1.8 }),
  'great-sword': Object.freeze({ image: WEAPON_ROOT + 'great-sword.png', width: 481, height: 188, pivot: Object.freeze({ x: 91, y: 94 }), reach: 1.65 }),
  'great-axe': Object.freeze({ image: WEAPON_ROOT + 'great-axe.png', width: 350, height: 245, pivot: Object.freeze({ x: 96, y: 123 }), reach: 1.42 }),
  maul: Object.freeze({ image: WEAPON_ROOT + 'maul.png', width: 413, height: 209, pivot: Object.freeze({ x: 190, y: 104 }), reach: 1.3 }),
  shield: Object.freeze({ image: WEAPON_ROOT + 'shield.png', width: 221, height: 365, pivot: Object.freeze({ x: 111, y: 183 }), heightUnits: 1.15 }),
});

const DEFAULT_STYLE = Object.freeze({
  blade: 'sword',
  axe: 'axe',
  blunt: 'hammer',
  polearm: 'spear',
});

export function weaponSpriteFor(kind, style = '') {
  const key = style && WEAPON_SPRITES[style] ? style : DEFAULT_STYLE[kind];
  return key ? WEAPON_SPRITES[key] || null : null;
}

export function placeWeaponSprite(sprite, hand, dx, dy, unit, size = 1) {
  if (!sprite || !hand || !(unit > 0)) return null;
  const magnitude = Math.hypot(dx, dy);
  if (!(magnitude > 0)) return null;
  const forwardPixels = Math.max(1, sprite.width - sprite.pivot.x);
  const scale = unit * size * sprite.reach / forwardPixels;
  return {
    x: hand.x,
    y: hand.y,
    angle: Math.atan2(dy, dx),
    width: sprite.width * scale,
    height: sprite.height * scale,
    offsetX: -sprite.pivot.x * scale,
    offsetY: -sprite.pivot.y * scale,
  };
}

export function placeShieldSprite(center, unit) {
  const sprite = WEAPON_SPRITES.shield;
  if (!center || !(unit > 0)) return null;
  const scale = unit * sprite.heightUnits / sprite.height;
  return {
    x: center.x,
    y: center.y,
    width: sprite.width * scale,
    height: sprite.height * scale,
    offsetX: -sprite.pivot.x * scale,
    offsetY: -sprite.pivot.y * scale,
  };
}
