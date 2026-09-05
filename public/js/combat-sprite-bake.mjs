// Bakes a sprite sheet from the procedural rig. Development tool, reached
// from the console as window.combatDebug.bakeSpriteSheet('humanoid').
//
// The result is a stand-in sheet with the rig's own look, laid out in the
// exact format an artist replaces (docs/combat-sprites.md). Only the body
// is baked: weapons, shield, helmet, cloak, and the portrait head keep
// drawing procedurally on top, so the manifest records the anchors those
// overlays need.

import { POSES, figureGeometry, resolveFigure, resolvePose } from './combat-rig-core.mjs';

export const BAKE_UNIT = 64;
export const BAKE_FRAME = 256;
export const BAKE_GROUND_Y = 232;
export const BAKE_HIP_X = 128;

export function bakeSpriteSheet(stage, doc, kind = 'humanoid') {
  const names = Object.keys(POSES);
  const columns = Math.ceil(Math.sqrt(names.length));
  const rows = Math.ceil(names.length / columns);
  const sheet = doc.createElement('canvas');
  sheet.width = columns * BAKE_FRAME;
  sheet.height = rows * BAKE_FRAME;
  const c = sheet.getContext('2d');
  const figure = resolveFigure(kind === 'beast' ? { isNpc: true } : {}, kind === 'beast' ? 'target' : 'player');
  // Bake facing right regardless of side so the sheet has one facing.
  figure.facing = 1;
  const material = stage._materials(kind === 'beast' ? 'target' : 'player', figure);
  const frames = {};
  names.forEach((name, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * BAKE_FRAME;
    const originY = row * BAKE_FRAME;
    const joints = resolvePose({ from: name, to: name, t: 1 }, 0, { reducedMotion: true });
    const geo = figureGeometry(figure, joints, originX + BAKE_HIP_X, originY + BAKE_GROUND_Y, BAKE_UNIT);
    c.save();
    c.beginPath();
    c.rect(originX, originY, BAKE_FRAME, BAKE_FRAME);
    c.clip();
    stage._drawLeg(c, geo, geo.legs.rear, material, 0.72);
    stage._drawArm(c, geo, geo.arms.left, material, 0.72);
    stage._drawTorso(c, geo, material);
    stage._drawLeg(c, geo, geo.legs.front, material, 1);
    stage._drawNeck(c, geo, material);
    stage._drawArm(c, geo, geo.arms.right, material, 1);
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
    image: '/assets/sprites/' + kind + '.png',
    frameWidth: BAKE_FRAME,
    frameHeight: BAKE_FRAME,
    unit: BAKE_UNIT,
    anchor: { x: BAKE_HIP_X, y: BAKE_GROUND_Y },
    facing: 'right',
    rigAligned: true,
    frames,
  };
  return { png: sheet.toDataURL('image/png'), manifest, columns, rows };
}
