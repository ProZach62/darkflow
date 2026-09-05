import test from 'node:test';
import assert from 'node:assert/strict';

const {
  POSES,
  STRIKE_POSE_BY_WEAPON,
  WEAPONS,
  figureGeometry,
  figureHeight,
  posePhase,
  resolveFigure,
  resolvePose,
} = await import('../public/js/combat-rig-core.mjs');

test('figures resolve weapon from guild, scale from race, and beast form for NPC targets', () => {
  assert.equal(resolveFigure({ guild: 'Mage', race: 'High Elf' }, 'player').weapon, 'staff');
  assert.equal(resolveFigure({ guild: 'Ranger' }, 'player').weapon, 'bow');
  assert.equal(resolveFigure({ guild: 'Monk' }, 'player').weapon, 'claws');
  assert.equal(resolveFigure({ guild: 'Street Samurai' }, 'player').weapon, 'blade');
  assert.equal(resolveFigure({ guild: 'unknown guild' }, 'player').weapon, 'blade');
  assert.equal(resolveFigure({}, 'player').weapon, 'blade');
  assert.ok(resolveFigure({ race: 'Pixie' }, 'player').scale < 1);
  assert.ok(resolveFigure({ race: 'Ice Ogre' }, 'player').scale > 1);
  assert.equal(resolveFigure({ race: 'Darkwinder' }, 'player').scale, 1);
  assert.equal(resolveFigure({}, 'player').facing, 1);

  const beast = resolveFigure({ isNpc: true, guild: 'Mage' }, 'target');
  assert.equal(beast.kind, 'beast');
  assert.equal(beast.weapon, 'claws', 'NPC targets ignore guild text');
  assert.equal(beast.facing, -1);
  const rival = resolveFigure({ isNpc: false, guild: 'Fighter' }, 'target');
  assert.equal(rival.kind, 'humanoid');
  assert.equal(rival.weapon, 'blade');
  for (const weapon of WEAPONS) assert.ok(STRIKE_POSE_BY_WEAPON[weapon] in POSES);
});

test('pose phases follow the action timeline for actor and victim', () => {
  const hit = { result: 'hit', landed: true };
  assert.deepEqual(posePhase('actor', hit, 0), { from: 'idle', to: 'windup', t: 0 });
  assert.equal(posePhase('actor', hit, 0.15).to, 'strike');
  assert.equal(posePhase('actor', hit, 0.15, 'staff').to, 'cast');
  assert.equal(posePhase('actor', hit, 0.15, 'bow').to, 'loose');
  assert.equal(posePhase('actor', hit, 0.05, 'bow').to, 'draw');
  assert.equal(posePhase('actor', hit, 0.15, 'claws').to, 'maul');
  assert.equal(posePhase('actor', { result: 'miss', landed: false }, 0.15).to, 'whiff');
  assert.equal(posePhase('actor', hit, 0.3).to, 'idle');
  assert.equal(posePhase('actor', hit, 0.7), null);

  assert.equal(posePhase('impact', hit, 0.1), null, 'victim waits for contact');
  assert.equal(posePhase('impact', hit, 0.2).to, 'recoil');
  assert.equal(posePhase('impact', hit, 0.5).from, 'recoil');
  assert.equal(posePhase('impact', { result: 'dodge', landed: false }, 0.2).to, 'dodge');
  assert.equal(posePhase('impact', { result: 'absorb', landed: false }, 0.3).to, 'guard');
  assert.equal(posePhase('impact', { result: 'miss', landed: false }, 0.3), null);
  assert.equal(posePhase('bystander', hit, 0.3), null);
});

test('resolvePose blends between poses and rests exactly on idle under reduced motion', () => {
  const idle = resolvePose(null, 0, { reducedMotion: true });
  assert.deepEqual(idle, { ...POSES.idle });
  const start = resolvePose({ from: 'idle', to: 'strike', t: 0 }, 0, { reducedMotion: true });
  assert.deepEqual(start, { ...POSES.idle });
  const end = resolvePose({ from: 'idle', to: 'strike', t: 1 }, 0, { reducedMotion: true });
  assert.deepEqual(end, { ...POSES.strike });
  const mid = resolvePose({ from: 'idle', to: 'strike', t: 0.5 }, 0, { reducedMotion: true });
  assert.ok(mid.rShoulder > POSES.idle.rShoulder && mid.rShoulder < POSES.strike.rShoulder);
  const breathing = resolvePose(null, 700, {});
  assert.notEqual(breathing.lean, POSES.idle.lean, 'idle breath moves the torso when motion is allowed');
});

test('geometry stands the figure on the ground line, faces the right way, and stays connected', () => {
  const figure = resolveFigure({ guild: 'Fighter' }, 'player');
  const joints = resolvePose(null, 0, { reducedMotion: true });
  const geo = figureGeometry(figure, joints, 100, 300, 40);
  assert.ok(Math.abs(geo.legs.right.foot.y - 300) < 40 * 0.2, 'feet rest near the ground line');
  assert.ok(geo.head.y < geo.shoulder.y && geo.shoulder.y < geo.hip.y, 'head above shoulders above hips');
  assert.ok(geo.head.y - geo.head.r > 300 - figureHeight(figure, 40) - 1, 'head fits within the figure height budget');
  assert.equal(geo.facing, 1);

  const strike = figureGeometry(figure, resolvePose({ from: 'idle', to: 'strike', t: 1 }, 0, { reducedMotion: true }), 100, 300, 40);
  assert.ok(strike.arms.right.hand.x > geo.arms.right.hand.x, 'a strike pushes the weapon hand forward');
  assert.ok(strike.weapon.dx > 0, 'the weapon points toward the target');

  const enemy = resolveFigure({ isNpc: true }, 'target');
  const enemyStrike = figureGeometry(enemy, resolvePose({ from: 'idle', to: 'maul', t: 1 }, 0, { reducedMotion: true }), 400, 300, 40);
  assert.ok(enemyStrike.arms.right.hand.x < enemyStrike.hip.x, 'the enemy strikes toward the left');
  assert.ok(enemyStrike.shoulder.x < enemyStrike.hip.x, 'a beast leans toward its prey');
});
