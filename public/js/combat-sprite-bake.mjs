// Bakes a sprite sheet from the procedural rig. Development tool, reached
// from the console as window.combatDebug.bakeSpriteSheet('humanoid').
//
// The result is a stand-in sheet with the rig's own look, laid out in the
// exact format an artist replaces (docs/combat-sprites.md). Only the body
// is baked: weapons, shield, helmet, cloak, and the portrait head keep
// drawing procedurally on top, so the manifest records the anchors those
// overlays need.

import { POSES, figureGeometry, resolveFigure, resolvePose } from './combat-rig-core.mjs';
import { spriteStyleFor } from './combat-sprite-art.mjs';

export const BAKE_UNIT = 64;
export const BAKE_FRAME = 256;
export const BAKE_GROUND_Y = 232;
export const BAKE_HIP_X = 128;

// `key` selects a hand-authored style from combat-sprite-art.mjs (for
// example 'male-scro'); without one the rig's own body is baked. The sheet
// is written under that key, so a styled bake ships as its own file.
// `scale` bakes at a multiple of the base 256 px cell (4 gives 1024 px cells)
// for crisp control images; the manifest scales with it.
// `options.headSilhouette` paints a plain head disc in each frame. Shipped
// sheets leave the head empty because the portrait covers it, but a control
// image for an image model needs a head outline or the model invents one.
export function bakeSpriteSheet(stage, doc, kind = 'humanoid', key = '', scale = 1, options = {}) {
  const style = key ? spriteStyleFor(key) : null;
  if (key && !style) throw new Error('No sprite style registered for ' + key);
  if (style) kind = style.kind;
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const FRAME = BAKE_FRAME * factor;
  const UNIT = BAKE_UNIT * factor;
  const GROUND_Y = BAKE_GROUND_Y * factor;
  const HIP_X = BAKE_HIP_X * factor;
  const names = Object.keys(POSES);
  const columns = Math.ceil(Math.sqrt(names.length));
  const rows = Math.ceil(names.length / columns);
  const sheet = doc.createElement('canvas');
  sheet.width = columns * FRAME;
  sheet.height = rows * FRAME;
  const c = sheet.getContext('2d');
  const figure = resolveFigure(kind === 'beast' ? { isNpc: true } : { race: style ? key.split('-').slice(1).join('-') : '' }, kind === 'beast' ? 'target' : 'player');
  // Bake facing right regardless of side so the sheet has one facing.
  figure.facing = 1;
  const material = stage._materials(kind === 'beast' ? 'target' : 'player', figure);
  const frames = {};
  names.forEach((name, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * FRAME;
    const originY = row * FRAME;
    const joints = resolvePose({ from: name, to: name, t: 1 }, 0, { reducedMotion: true });
    const geo = figureGeometry(figure, joints, originX + HIP_X, originY + GROUND_Y, UNIT);
    c.save();
    c.beginPath();
    c.rect(originX, originY, FRAME, FRAME);
    c.clip();
    if (style) {
      style.draw(c, geo, material);
    } else {
      stage._drawLeg(c, geo, geo.legs.rear, material, 0.72);
      stage._drawArm(c, geo, geo.arms.left, material, 0.72);
      stage._drawTorso(c, geo, material);
      stage._drawLeg(c, geo, geo.legs.front, material, 1);
      stage._drawNeck(c, geo, material);
      stage._drawArm(c, geo, geo.arms.right, material, 1);
    }
    if (options.headSilhouette) {
      const skin = style && style.palette && style.palette.skin ? style.palette.skin : material.skin;
      const shade = style && style.palette && style.palette.skinShade ? style.palette.skinShade : material.skinShade;
      c.beginPath();
      c.arc(geo.head.x, geo.head.y, geo.head.r, 0, Math.PI * 2);
      c.fillStyle = skin;
      c.fill();
      c.lineWidth = Math.max(1.5, geo.head.r * 0.08);
      c.strokeStyle = '#0a0c0f';
      c.stroke();
      // Ear and jaw hint on the facing side so the model reads a profile.
      c.fillStyle = shade;
      c.beginPath();
      c.arc(geo.head.x - figure.facing * geo.head.r * 0.55, geo.head.y + geo.head.r * 0.05, geo.head.r * 0.22, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    frames[name] = {
      x: originX,
      y: originY,
      anchors: {
        head: { x: geo.head.x - originX, y: geo.head.y - originY, r: geo.head.r },
        neck: { x: geo.neck.x - originX, y: geo.neck.y - originY },
        hand: { x: geo.arms.right.hand.x - originX, y: geo.arms.right.hand.y - originY },
        offHand: { x: geo.arms.left.hand.x - originX, y: geo.arms.left.hand.y - originY },
        cloak: { x: geo.torso.shoulderBack.x - originX, y: geo.torso.shoulderBack.y - originY },
      },
    };
  });
  const manifest = {
    version: 1,
    kind,
    image: '/assets/sprites/' + (key || kind) + '.png',
    frameWidth: FRAME,
    frameHeight: FRAME,
    unit: UNIT,
    anchor: { x: HIP_X, y: GROUND_Y },
    facing: 'right',
    rigAligned: true,
    frames,
  };
  if (style && style.cloak !== undefined) manifest.cloak = style.cloak;
  return { png: sheet.toDataURL('image/png'), manifest, columns, rows, canvas: sheet, names, frame: FRAME };
}
