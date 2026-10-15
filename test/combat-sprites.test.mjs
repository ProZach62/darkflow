import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolveFigure } from '../public/js/combat-rig-core.mjs';

const {
  anchorToStage,
  createSpriteLibrary,
  enemySpriteKey,
  isSheetKey,
  normalizeSpriteManifest,
  placeSpriteFrame,
  selectSpriteFrames,
  spriteKeysFor,
} = await import('../public/js/combat-sprites.mjs');

function manifest(overrides = {}) {
  return {
    version: 1,
    kind: 'humanoid',
    image: '/assets/sprites/humanoid.png',
    frameWidth: 256,
    frameHeight: 256,
    unit: 64,
    anchor: { x: 128, y: 232 },
    facing: 'right',
    frames: {
      idle: { x: 0, y: 0, anchors: { head: { x: 128, y: 60, r: 20 }, hand: { x: 150, y: 150 } } },
      strike: { x: 256, y: 0 },
      windup: { x: 512, y: 0 },
      bogus: { x: 768, y: 0 },
    },
    ...overrides,
  };
}

test('manifest normalization keeps known poses and rejects unusable files', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  assert.ok(sheet);
  assert.deepEqual(Object.keys(sheet.frames).sort(), ['idle', 'strike', 'windup']);
  assert.equal(sheet.facing, 1);
  assert.equal(sheet.rigAligned, true);
  assert.deepEqual(sheet.frames.idle.anchors.head, { x: 128, y: 60, r: 20 });
  assert.equal(normalizeSpriteManifest(manifest({ version: 2 }), 'humanoid'), null, 'unknown version');
  assert.equal(normalizeSpriteManifest(manifest({ kind: 'beast' }), 'humanoid'), null, 'kind mismatch');
  assert.equal(normalizeSpriteManifest(manifest({ frames: { strike: { x: 0, y: 0 } } }), 'humanoid'), null, 'idle is required');
  assert.equal(normalizeSpriteManifest(manifest({ image: 'javascript:alert(1)' }), 'humanoid'), null, 'image must be a path or https URL');
  assert.equal(normalizeSpriteManifest(manifest({ unit: 0 }), 'humanoid'), null);
  assert.equal(normalizeSpriteManifest(null, 'humanoid'), null);
  assert.equal(normalizeSpriteManifest(manifest({ facing: 'left' }), 'humanoid').facing, -1);
  assert.equal(normalizeSpriteManifest(manifest(), 'humanoid').pixelated, false);
  assert.equal(normalizeSpriteManifest(manifest({ pixelated: true }), 'humanoid').pixelated, true);
  assert.equal(normalizeSpriteManifest(manifest({ pixelated: 'yes' }), 'humanoid').pixelated, false, 'only a real true enables it');
  assert.equal(normalizeSpriteManifest(manifest(), 'humanoid').weaponsInArt, false);
  assert.equal(normalizeSpriteManifest(manifest({ weaponsInArt: true }), 'humanoid').weaponsInArt, true);
  assert.equal(normalizeSpriteManifest(manifest(), 'humanoid').portrait, true);
  assert.equal(normalizeSpriteManifest(manifest({ portrait: false }), 'humanoid').portrait, false);
  assert.equal(normalizeSpriteManifest(manifest(), 'humanoid').secondary, true);
  assert.equal(normalizeSpriteManifest(manifest({ secondary: false }), 'humanoid').secondary, false);
});

test('frame selection cuts from one pose to the other halfway, never fading two frames together', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  assert.deepEqual(selectSpriteFrames(sheet, null).map((f) => [f.name, f.alpha]), [['idle', 1]]);
  const mid = selectSpriteFrames(sheet, { from: 'idle', to: 'strike', t: 0.4 }, 0.4);
  assert.deepEqual(mid.map((f) => [f.name, f.alpha]), [['idle', 1]], 'before halfway, the from pose alone');
  const past = selectSpriteFrames(sheet, { from: 'idle', to: 'strike', t: 0.6 }, 0.6);
  assert.deepEqual(past.map((f) => [f.name, f.alpha]), [['strike', 1]], 'from halfway, the to pose alone');
  assert.deepEqual(selectSpriteFrames(sheet, { from: 'idle', to: 'strike', t: 1 }, 1).map((f) => f.name), ['strike']);
  assert.deepEqual(selectSpriteFrames(sheet, { from: 'strike', to: 'strike', t: 1 }, 1).map((f) => f.name), ['strike']);
  const missing = selectSpriteFrames(sheet, { from: 'idle', to: 'chop', t: 0.5 }, 0.5);
  assert.deepEqual(missing.map((f) => f.name), ['idle'], 'a pose without a frame keeps the from pose');
});

test('placement lands the ground anchor on the hip and mirrors for left-facing figures', () => {
  const sheet = normalizeSpriteManifest(manifest(), 'humanoid');
  const right = placeSpriteFrame(sheet, 32, 1, 300, 400, 1);
  assert.equal(right.scale, 0.5);
  assert.equal(right.width, 128);
  assert.equal(right.height, 128);
  assert.equal(right.mirrored, false);
  assert.equal(right.x, 300 - 64);
  assert.equal(right.y, 400 - 116);
  const left = placeSpriteFrame(sheet, 32, 1, 300, 400, -1);
  assert.equal(left.mirrored, true);
  assert.equal(left.x + left.width - 64, 300, 'mirrored anchor still sits on the hip');
  const stretched = placeSpriteFrame(sheet, 32, 1, 300, 400, 1, 1.1);
  assert.ok(stretched.height > right.height && stretched.y < right.y, 'stretch grows upward from the ground');

  const headRight = anchorToStage(right, sheet.frames.idle.anchors.head);
  assert.equal(headRight.x, 300);
  assert.equal(headRight.y, right.y + 30);
  assert.equal(headRight.r, 10);
  const handRight = anchorToStage(right, sheet.frames.idle.anchors.hand);
  assert.equal(handRight.x, 300 + 11, 'right hand is ahead of the hip when facing right');
  const handLeft = anchorToStage(left, sheet.frames.idle.anchors.hand);
  assert.equal(handLeft.x, 300 - 11, 'mirrored hand is ahead of the hip when facing left');
});

test('the library loads a sheet once, caches failures, and reports readiness', async () => {
  const requested = [];
  const images = [];
  class FakeImage {
    set src(value) {
      this._src = value;
      images.push(this);
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  }
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith('humanoid.json')) return { ok: true, text: async () => JSON.stringify(manifest()), json: async () => manifest() };
    return { ok: false, text: async () => JSON.stringify(null), json: async () => null };
  };
  const ready = [];
  const library = createSpriteLibrary({ fetch: fetchImpl, Image: FakeImage, onReady: (kind) => ready.push(kind) });
  assert.equal(library.get('humanoid'), null, 'not ready synchronously');
  assert.equal(library.status('humanoid'), 'loading');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const entry = library.get('humanoid');
  assert.ok(entry && entry.sheet && entry.image);
  assert.deepEqual(ready, ['humanoid']);
  library.get('humanoid');
  assert.equal(requested.filter((url) => url.endsWith('humanoid.json')).length, 1, 'one manifest request');

  assert.equal(library.get('beast'), null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(library.status('beast'), 'failed');
  library.get('beast');
  assert.equal(requested.filter((url) => url.endsWith('beast.json')).length, 1, 'failure is cached');
  assert.equal(library.load('../etc'), null, 'keys that are not sheet keys are refused');

  const offline = createSpriteLibrary({});
  assert.equal(offline.get('humanoid'), null);
  assert.equal(offline.status('humanoid'), 'unavailable');
});

test('sheet keys use public race hints for any fighter but private identity only for the recipient', () => {
  const figure = { kind: 'humanoid' };
  assert.deepEqual(spriteKeysFor({ name: 'Grash Ironjaw', gender: 'Male', race: 'Scro' }, figure, 'player'),
    ['characters/grash-ironjaw', 'male-scro', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'Ulf', gender: 'Male', race: 'Northman' }, figure, 'player'),
    ['characters/ulf', 'male-northman', 'male-human', 'humanoid'], 'human cultures fall through to the shared human sheet');
  assert.deepEqual(spriteKeysFor({ name: 'Corwin', gender: 'Male', race: 'Darkwinder' }, figure, 'player'),
    ['characters/corwin', 'male-darkwinder', 'male-human', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'Esme', gender: 'female', race: 'Desert Nomad' }, figure, 'player'),
    ['characters/esme', 'female-desert-nomad', 'female-human', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'Tam', gender: 'male', race: 'Wayfarian' }, figure, 'player'),
    ['characters/tam', 'male-wayfarian', 'male-elf', 'humanoid'], 'the elven kinds fall through to the shared elf sheet');
  assert.deepEqual(spriteKeysFor({ name: 'Ola', gender: 'female', race: 'Shel-Zaranite' }, figure, 'player'),
    ['characters/ola', 'female-shel-zaranite', 'female-elf', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'Borin', gender: 'male', race: 'Rift Duergar' }, figure, 'player'),
    ['characters/borin', 'male-rift-duergar', 'male-dwarf', 'humanoid'], 'the dwarven kinds fall through to the shared dwarf sheet');
  assert.deepEqual(spriteKeysFor({ name: 'Gorbag', gender: 'male', race: 'Uruk' }, figure, 'player'),
    ['characters/gorbag', 'male-uruk', 'male-scro', 'humanoid'], 'Uruk borrow the Scro sheet');
  assert.deepEqual(spriteKeysFor({ name: 'Pip', gender: 'male', race: 'Kender' }, figure, 'player'),
    ['characters/pip', 'male-kender', 'male-human', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'Bryn', race: 'High Elf' }, figure, 'player'),
    ['characters/bryn', 'male-high-elf', 'male-elf', 'humanoid'], 'unspecified gender uses a visual default');
  assert.deepEqual(spriteKeysFor({ name: 'Bryn', gender: 'male', race: 'Scro' }, figure, 'target'),
    ['humanoid'], 'legacy targets cannot borrow private identity');
  assert.deepEqual(spriteKeysFor({ name: 'Bryn', gender: 'female', race: 'Scro', appearanceKnown: true }, figure, 'target'),
    ['female-scro', 'humanoid'], 'targets use their own public race and gender');
  assert.deepEqual(spriteKeysFor({ name: 'an ash drake', isNpc: true }, { kind: 'beast' }, 'target'),
    ['enemies/drake', 'beast'], 'recognized NPC names select an enemy archetype before the fallback');
  assert.deepEqual(spriteKeysFor({ name: 'Bryn', gender: 'male', race: 'Scro', observed: true }, figure, 'player'),
    ['humanoid'], 'an observed fighter cannot borrow private identity');
  assert.deepEqual(spriteKeysFor({ name: 'Bryn', race: 'Unlisted', family: 'Elf', appearanceKnown: true, observed: true }, figure, 'player'),
    ['male-unlisted', 'male-elf', 'humanoid'], 'observed fighters use explicit public family and a visual gender default');
  assert.deepEqual(spriteKeysFor({ name: '../../x', gender: '..', race: 'Scro' }, { kind: 'beast' }, 'player'),
    ['characters/x', 'beast'], 'names and races are slugged before becoming keys');
  assert.equal(isSheetKey('characters/grash'), true);
  assert.equal(isSheetKey('enemies/drake'), true);
  assert.equal(isSheetKey('male-scro'), true);
  assert.equal(isSheetKey('../etc'), false);
  assert.equal(isSheetKey('characters/'), false);
});

test('public Wolf forms use gender-neutral animal art without changing legacy observed forms', () => {
  for (const gender of ['male', 'female', undefined]) {
    const wolf = { name: 'Acer', race: 'Wolf', gender };
    const figure = resolveFigure(wolf);
    assert.deepEqual(spriteKeysFor(wolf, figure, 'player'), ['wolf', 'beast']);
    assert.deepEqual(spriteKeysFor({ ...wolf, appearanceKnown: true }, figure, 'player'), ['wolf', 'beast']);
    assert.deepEqual(spriteKeysFor({ ...wolf, observed: true }, figure, 'player'), ['beast']);
    assert.deepEqual(spriteKeysFor(wolf, figure, 'target'), ['beast']);
    assert.deepEqual(spriteKeysFor({ ...wolf, appearanceKnown: true, observed: true }, figure, 'player'), ['wolf', 'beast']);
    assert.deepEqual(spriteKeysFor({ ...wolf, appearanceKnown: true }, figure, 'target'), ['wolf', 'beast']);
  }
  const humanoid = { race: 'wolf', gender: 'female', form: 'humanoid', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(humanoid, resolveFigure(humanoid), 'player'), ['female-wolf', 'humanoid']);
  const crinos = { race: 'crinos', gender: 'male', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(crinos, resolveFigure(crinos), 'player'), ['male-crinos', 'crinos', 'male-ursavar', 'humanoid']);
});

test('dedicated neutral race sheets outrank biological families for own and observed fighters', () => {
  for (const [race, family] of [
    ['Crannian Gnome', 'gnome'], ['Hyperborean Gnome', 'gnome'],
    ['Ice Gnoll', 'gnoll'], ['Thraxian', 'draconian'], ['Vaelkar', 'draconian'],
    ['Crinos', 'lycanthrope'], ['Reedstalker', 'draconian'], ['Boneback', 'draconian'],
    ['Miura', 'feline'], ['Zymari', 'fungus'],
  ]) {
    const key = race.toLowerCase().replaceAll(' ', '-');
    for (const gender of ['male', 'female', undefined]) {
      for (const side of ['player', 'target']) {
        const fighter = { race, family, gender, appearanceKnown: true, observed: side === 'target', equipment: {} };
        const figure = resolveFigure(fighter, side);
        const keys = spriteKeysFor(fighter, figure, side);
        const selected = keys.find(candidate => existsSync(new URL('../public/assets/sprites/' + candidate + '.json', import.meta.url)));
        assert.equal(selected, key, race + ' uses its dedicated art');
        assert.equal(keys[0], (gender === 'female' ? 'female-' : 'male-') + key, 'gender-specific art still has priority');
        const sheet = normalizeSpriteManifest(JSON.parse(readFileSync(new URL('../public/assets/sprites/' + selected + '.json', import.meta.url))), figure.kind);
        assert.ok(sheet, race + ' manifest matches the figure');
        assert.ok(existsSync(new URL('../public' + sheet.image, import.meta.url)), race + ' image is shipped');
        assert.equal(sheet.weaponsInArt, false, 'player equipment overlays remain enabled');
      }
    }
    for (const form of ['quadruped', 'mist']) {
      const fighter = { race, family, appearanceKnown: true, form };
      assert.ok(!spriteKeysFor(fighter, resolveFigure(fighter), 'player').includes(key), 'incompatible forms do not reuse base race art');
    }
  }
  const swampTroll = { race: 'Swamp Troll', family: 'troll', gender: 'female', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(swampTroll, resolveFigure(swampTroll), 'player'),
    ['female-swamp-troll', 'female-arthok', 'female-troll', 'humanoid'], 'player race mapping outranks NPC family art');
  const yugoloth = { race: 'yugoloth', family: 'human', gender: 'male', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(yugoloth, resolveFigure(yugoloth), 'target'),
    ['male-yugoloth', 'male-arthok', 'male-human', 'humanoid'], 'race-specific shared art precedes a broader public family');
});

test('public creature races choose bundled art without name guesses or stale humanoid forms', () => {
  for (const [race, key, kind] of [
    ['beast', 'beast', 'beast'],
    ['dragon', 'enemies/drake', 'beast'],
    ['spider', 'enemies/spider', 'beast'],
    ['skeleton', 'enemies/undead', 'humanoid'],
    ['troll', 'enemies/troll', 'humanoid'],
    ['orc', 'male-orc', 'humanoid'],
    ['rat', 'enemies/rat', 'beast'],
    ['rodent', 'enemies/rat', 'beast'],
    ['mouse', 'enemies/rat', 'beast'],
    ['bat', 'enemies/bat', 'beast'],
    ['bear', 'enemies/bear', 'beast'],
    ['boar', 'enemies/boar', 'beast'],
    ['Wild Boar', 'enemies/boar', 'beast'],
    ['snake', 'enemies/serpent', 'beast'],
    ['serpent', 'enemies/serpent', 'beast'],
    ['crab', 'enemies/crab', 'beast'],
    ['Giant Crab', 'enemies/crab', 'beast'],
    ['crocodile', 'enemies/crocodile', 'beast'],
    ['alligator', 'enemies/crocodile', 'beast'],
    ['golem', 'enemies/golem', 'humanoid'],
    ['goblin', 'enemies/goblin', 'humanoid'],
    ['kobold', 'enemies/kobold', 'humanoid'],
    ['minotaur', 'enemies/minotaur', 'humanoid'],
    ['gargoyle', 'enemies/gargoyle', 'humanoid'],
  ]) {
    const fighter = { name: 'a misleading ash drake', race, appearanceKnown: true, equipment: {} };
    for (const side of ['player', 'target']) {
      const figure = resolveFigure(fighter, side);
      assert.equal(figure.kind, kind, race);
      assert.equal(spriteKeysFor({ ...fighter, observed: true }, figure, side)[0], key, race);
    }
  }
  const dragon = { race: 'Dragon', family: 'dragon', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(dragon, resolveFigure(dragon, 'target'), 'target'),
    ['male-dragon', 'male-arthok', 'humanoid'], 'playable Dragon family keeps humanoid art');
  const iceOgre = { race: 'Ice Ogre', family: 'ogre', gender: 'male', appearanceKnown: true };
  for (const side of ['player', 'target']) {
    const fighter = { ...iceOgre, observed: side === 'target' };
    assert.deepEqual(spriteKeysFor(fighter, resolveFigure(fighter, side), side),
      ['male-ice-ogre', 'male-scro', 'male-ogre', 'humanoid'], 'Ice Ogre race art outranks generic Ogre family art');
  }
  const ogre = { race: 'ogre', isNpc: true, appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(ogre, resolveFigure(ogre, 'target'), 'target'),
    ['enemies/troll', 'humanoid'], 'ordinary Ogre NPCs keep their enemy art');
  const transformed = { race: 'human', family: 'human', gender: 'female', form: 'quadruped', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(transformed, resolveFigure(transformed), 'player'), ['beast'],
    'explicit animal form must not reuse humanoid race art');
  const explicit = { race: 'dragon', form: 'humanoid', appearanceKnown: true };
  assert.equal(resolveFigure(explicit, 'target').kind, 'humanoid');
  assert.deepEqual(spriteKeysFor(explicit, resolveFigure(explicit, 'target'), 'target'),
    ['male-dragon', 'male-arthok', 'humanoid']);
  const unknownForm = { race: 'dragon', form: 'mist', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(unknownForm, resolveFigure(unknownForm, 'target'), 'target'), ['humanoid'],
    'unknown explicit forms use generic art instead of the base race');
  const orc = { race: 'orc', appearanceKnown: true };
  assert.deepEqual(spriteKeysFor(orc, resolveFigure(orc, 'target'), 'target'), ['male-orc', 'male-scro', 'humanoid']);
  assert.deepEqual(spriteKeysFor({ name: 'an ash drake', appearanceKnown: true }, resolveFigure({ appearanceKnown: true }), 'target'),
    ['humanoid'], 'redaction does not recover creature identity from a name');
});

test('armed monster sheets cover attacks without overriding redaction or explicit forms', () => {
  for (const race of ['goblin', 'kobold', 'minotaur', 'gargoyle']) {
    const key = 'enemies/' + race;
    const sheet = normalizeSpriteManifest(JSON.parse(readFileSync(new URL('../public/assets/sprites/' + key + '.json', import.meta.url))), 'humanoid');
    assert.ok(sheet, race + ' ships a valid sheet');
    assert.ok(existsSync(new URL('../public' + sheet.image, import.meta.url)), race + ' image is shipped');
    assert.equal(sheet.weaponsInArt, false, race + ' accepts runtime equipment');
    for (const pose of ['idle', 'windup', 'strike', 'maul', 'thrust', 'chop', 'loose', 'guard', 'cast', 'recoil', 'whiff', 'dodge', 'look']) {
      const [selected] = selectSpriteFrames(sheet, { from: pose, to: pose }, 1);
      assert.equal(selected.name, pose, race + ' animates ' + pose);
      assert.ok(selected.frame.anchors.hand && selected.frame.anchors.offHand, race + ' has hand anchors for ' + pose);
    }
    const redacted = { name: 'a giant ' + race, isNpc: true, appearanceKnown: true };
    assert.deepEqual(spriteKeysFor(redacted, resolveFigure(redacted, 'target'), 'target'), ['humanoid'], race + ' does not bypass redaction');
    const transformed = { ...redacted, race, form: 'quadruped' };
    assert.deepEqual(spriteKeysFor(transformed, resolveFigure(transformed, 'target'), 'target'), ['beast'], race + ' respects incompatible explicit forms');
    const legacy = { name: 'a giant ' + race, isNpc: true };
    assert.equal(spriteKeysFor(legacy, resolveFigure(legacy, 'target'), 'target')[0], key, race + ' supports legacy NPC names');
  }
});

test('natural beasts ship nine attack poses without bypassing public appearance', () => {
  for (const race of ['boar', 'serpent', 'crab', 'crocodile']) {
    const sheet = normalizeSpriteManifest(JSON.parse(readFileSync(new URL('../public/assets/sprites/enemies/' + race + '.json', import.meta.url))), 'beast');
    assert.ok(sheet, race + ' ships a valid beast sheet');
    const image = readFileSync(new URL('../public' + sheet.image, import.meta.url));
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    assert.equal(sheet.weaponsInArt, true, race + ' owns its natural attacks');
    assert.equal(sheet.portrait, false);
    assert.equal(sheet.secondary, false);
    for (const pose of ['idle', 'windup', 'maul', 'whiff', 'recoil', 'dodge', 'guard', 'cast', 'look']) {
      const [selected] = selectSpriteFrames(sheet, { from: pose, to: pose }, 1);
      assert.equal(selected.name, pose, race + ' animates ' + pose);
      assert.ok(selected.frame.x + sheet.frameWidth <= width && selected.frame.y + sheet.frameHeight <= height);
    }
    const redacted = { name: 'a giant ' + race, isNpc: true, appearanceKnown: true };
    assert.deepEqual(spriteKeysFor(redacted, resolveFigure(redacted, 'target'), 'target'), ['humanoid']);
    const transformed = { ...redacted, race, form: 'mist' };
    assert.deepEqual(spriteKeysFor(transformed, resolveFigure(transformed, 'target'), 'target'), ['humanoid']);
    const family = { ...redacted, family: race };
    assert.equal(spriteKeysFor(family, resolveFigure(family, 'target'), 'target')[0], 'enemies/' + race);
    const legacy = { name: redacted.name, isNpc: true };
    assert.equal(spriteKeysFor(legacy, resolveFigure(legacy, 'target'), 'target')[0], 'enemies/' + race);
  }
  for (const family of ['animal', 'reptile', 'crustacean']) {
    const fighter = { family, appearanceKnown: true, name: 'a giant crab', isNpc: true };
    assert.deepEqual(spriteKeysFor(fighter, resolveFigure(fighter, 'target'), 'target'), ['male-' + family, 'humanoid']);
  }
});

test('named boss art requires an exact visible label and public race, without overriding forms', () => {
  for (const [key, race, names] of [
    ['ilyrra', 'dragon', ['Ilyrra', 'Ilyrra Still-Wing']],
    ['orryx', 'dragon', ['Orryx', 'Orryx, Root of Thunder']],
    ['lord-blackbriar', 'spirit', ['Lord Blackbriar', 'Lord Blackbriar, the Sole Heir']],
    ['languish', 'undead', ['Languish', 'a smooth priest']],
    ['gravewatch-penitent', 'undead', ['The Gravewatch Penitent']],
    ['vaelkor', 'dragon', ['Vaelkor', 'Vaelkor, the Ash Regent', 'Vaelkor the Ash Regent']],
    ['unarrived', 'dragon', ['Unarrived', 'the Unarrived']],
    ['swamp-wyrm', 'dragon', ['Swamp Wyrm']],
    ['bandit-king', 'human', ['bandit king', 'The Bandit King']],
    ['tidemother', 'beast', ['tidemother', 'the Tidemother']],
    ['carrion-queen', 'bird', ['Carrion Queen', 'the Carrion Queen of the Black Boughs']],
    ['drowned-dryad', 'spirit', ['Drowned Dryad', 'the Drowned Dryad of the Root-Ford']],
    ['furnace-king', 'elemental', ['The Furnace King']],
    ['thaloryn', 'beast', ['Thaloryn', 'Thaloryn, the Unmoored Leviathan']],
    ['greg-director', 'human', ['Greg, Director of Security']],
    ['aralith', 'gargoyle', ['Aralith', 'Aralith the Nature Mage']],
    ['sayf-al-murr', 'human', ['Sayf al-Murr', 'Sayf al-Murr, the salt baron']],
    ['waternix', 'faerie', ['Waternix', 'each-uisge']],
    ['gaean-warden', 'spirit', ['Gaean warden', "a Warden of Gaea's Vigil", "the Warden of Gaea's Vigil"]],
    ['astral-colossus', 'construct', ['Astral Colossus', 'The Astral Colossus']],
    ['splintermaw', 'reptile', ['Splintermaw']],
    ['ironheart-treant', 'treant', ['Ironheart Treant', 'the Ironheart Treant']],
    ['sablehorn', 'dragon', ['Sablehorn', 'Sablehorn Moltwyrm']],
    ['vorrak', 'dragon', ['Vorrak', 'Vorrak the Acid Coil']],
    ['lower-jaw-alpha', 'reptile', ['Lower Jaw Alpha', 'the lower jaw alpha']],
    ['qitar', 'demon', ['Qitar', 'Qitar, the Unbound']],
    ['mawspike', 'reptile', ['Mawspike', 'Mawspike the Burrower']],
    ['uncolored-one', 'spirit', ['Uncolored One', 'The Uncolored One']],
    ['warden-post-golem', 'golem', ['Warden post golem', 'the Warden Post Golem']],
    ['defiler', 'fiend', ['Defiler', 'the Defiler', 'daemon of defilement']],
    ['white-shark', 'fish', ['White shark', 'white shark']],
    ['ruby-dragon', 'dragon', ['Ruby dragon', 'dragon of ruby']],
    ['regrowth-mass', 'reptile', ['Regrowth mass', 'a regrowth mass']],
    ['bankbreaker', 'animal', ['Bankbreaker', 'Bankbreaker, the root-burrowing beast']],
    ['nhal-serev', 'undead', ['Nhal Serev', 'Nhal Serev, the Rimebound Archlich']],
    ['rabbit-of-caerbannog', 'fiend', ['Rabbit of Caerbannog']],
    ['volcano-heart', 'elemental', ['Volcano Heart', 'the Volcano Heart']],
    ['gravemarch-span', 'golem', ['Gravemarch span', 'the Gravemarch Span']],
    ['obsidian-thane', 'giant', ['Obsidian thane', 'the Obsidian Thane']],
    ['parallax-queen', 'construct', ['The Parallax Queen']],
    ['cragjaw', 'reptile', ['Cragjaw', 'Cragjaw, First Hunger']],
    ['rattleback', 'reptile', ['Rattleback', 'Rattleback Gnashmother']],
    ['echoing-drop-stalker', 'reptile', ['Echoing drop stalker', 'an echoing drop stalker']],
    ['black-vent-ancient', 'dragon', ['Black vent ancient', 'the Black Vent Ancient']],
    ['hollow-antler', 'spirit', ['Hollow Antler', 'the Hollow Antler']],
  ]) {
    const expected = 'enemies/' + key;
    for (const name of names) {
      const fighter = { name: '  ' + name.toUpperCase() + '  ( BOSS ) ', race, isNpc: true, appearanceKnown: true };
      for (const side of ['player', 'target']) {
        const observed = { ...fighter, observed: true };
        const keys = spriteKeysFor(observed, resolveFigure(observed, side), side);
        assert.equal(keys[0], expected, name + ' uses dedicated art before shared species');
        assert.ok(keys.length > 1, name + ' retains existing fallback art');
      }
      for (const override of [
        { race: '' }, { race: race === 'human' ? 'undead' : 'human' }, { race: '', family: race },
        { name: name + ' statue' }, { appearanceKnown: false },
        { form: 'mist' }, { form: 'humanoid' }, { form: 'quadruped' },
      ]) {
        const hidden = { ...fighter, ...override };
        assert.ok(!spriteKeysFor(hidden, resolveFigure(hidden, 'target'), 'target').includes(expected), name + ' respects ' + JSON.stringify(override));
      }
    }
    const beastBodyOverride = ['waternix', 'splintermaw', 'lower-jaw-alpha', 'mawspike', 'white-shark', 'regrowth-mass', 'bankbreaker', 'rabbit-of-caerbannog', 'parallax-queen', 'cragjaw', 'rattleback', 'echoing-drop-stalker'].includes(key);
    const kind = ['dragon', 'beast'].includes(race) || beastBodyOverride ? 'beast' : 'humanoid';
    const sheet = normalizeSpriteManifest(JSON.parse(readFileSync(new URL('../public/assets/sprites/' + expected + '.json', import.meta.url))), kind);
    assert.ok(sheet, key + ' ships a valid sheet');
    const image = readFileSync(new URL('../public' + sheet.image, import.meta.url));
    assert.equal(sheet.portrait, false);
    assert.equal(sheet.secondary, false);
    const armed = ['gravewatch-penitent', 'bandit-king', 'aralith', 'sayf-al-murr'].includes(key);
    assert.equal(sheet.weaponsInArt, !armed, 'armed bosses retain server equipment overlays');
    const poses = ['idle', 'windup', 'maul', 'whiff', 'recoil', 'dodge', 'guard', 'cast', 'look'];
    if (kind === 'humanoid' || beastBodyOverride) poses.push('strike', 'thrust', 'chop');
    if (armed) poses.push('raise');
    for (const pose of poses) {
      const [selected] = selectSpriteFrames(sheet, { from: pose, to: pose }, 1);
      assert.equal(selected.name, pose, key + ' animates ' + pose);
      assert.ok(selected.frame.x + sheet.frameWidth <= image.readUInt32BE(16));
      assert.ok(selected.frame.y + sheet.frameHeight <= image.readUInt32BE(20));
      if (armed) assert.ok(selected.frame.anchors.hand, 'weapon follows the painted hand');
      if (key === 'bandit-king') assert.ok(selected.frame.anchors.offHand && selected.frame.anchors.offElbow, 'shield follows the painted arm');
    }
  }
  const ambiguous = { name: 'Wyrm (BOSS)', race: 'dragon', appearanceKnown: true, isNpc: true };
  assert.equal(spriteKeysFor(ambiguous, resolveFigure(ambiguous, 'target'), 'target')[0], 'enemies/drake', 'other Wyrm actors share the same public base name and race');
  const necromancer = { name: 'Vaelkor', race: 'undead', appearanceKnown: true, isNpc: true };
  assert.equal(spriteKeysFor(necromancer, resolveFigure(necromancer, 'target'), 'target')[0], 'enemies/undead', 'Vaelkor the Unquiet is not the Ash Regent');
  for (const fighter of [
    { name: 'Greg', race: 'human' },
    { name: 'queen', race: 'bird' },
    { name: 'queen', race: 'spirit' },
    { name: 'harpy', race: 'bird' },
    { name: 'Carrion Queen', race: 'harpy' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!keys.includes('enemies/greg-director') && !keys.includes('enemies/carrion-queen') && !keys.includes('enemies/drowned-dryad'), 'shared aliases and inferred races do not identify a boss: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'a woodland faerie', race: 'faerie' },
    { name: 'horse', race: 'faerie' },
    { name: 'each-uisge', race: 'elf' },
    { name: 'nature mage', race: 'gargoyle' },
    { name: 'warden', race: 'spirit' },
    { name: 'Astral Colossus', race: 'giant' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!keys.includes('enemies/waternix') && !keys.includes('enemies/aralith') && !keys.includes('enemies/gaean-warden') && !keys.includes('enemies/astral-colossus'), 'generic aliases and unrelated faeries retain their own art: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'gnasher', race: 'reptile' },
    { name: 'wyrm', race: 'dragon' },
    { name: 'an old oak', race: 'treant' },
    { name: 'Splintermaw', race: 'crocodile' },
    { name: 'Ironheart Treant', race: 'plant' },
    { name: 'Sablehorn', race: 'reptile' },
    { name: 'Vorrak', race: 'serpent' },
    { name: 'Lower Jaw Alpha', race: 'dragon' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!['splintermaw', 'ironheart-treant', 'sablehorn', 'vorrak', 'lower-jaw-alpha'].some((key) => keys.includes('enemies/' + key)), 'shared aliases and inferred species do not identify a boss: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'gnasher', race: 'reptile' },
    { name: 'golem', race: 'golem' },
    { name: 'Mawspike', race: 'dragon' },
    { name: 'Warden post golem', race: 'construct' },
    { name: 'Qitar', race: 'fiend' },
    { name: 'The Uncolored One', race: 'undead' },
    { name: 'a Heartroot defiler', race: 'human' },
    { name: 'daemon of defilement', race: 'demon' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!['qitar', 'mawspike', 'uncolored-one', 'warden-post-golem', 'defiler'].some((key) => keys.includes('enemies/' + key)), 'generic labels and competing identities retain fallback art: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'shark', race: 'fish' },
    { name: 'dragon', race: 'dragon' },
    { name: 'baby dragon', race: 'dragon' },
    { name: 'mass', race: 'reptile' },
    { name: 'burrower', race: 'animal' },
    { name: 'archlich', race: 'undead' },
    { name: 'White shark', race: 'shark' },
    { name: 'Regrowth mass', race: 'beast' },
    { name: 'Bankbreaker', race: 'reptile' },
    { name: 'Nhal Serev', race: 'lich' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!['white-shark', 'ruby-dragon', 'regrowth-mass', 'bankbreaker', 'nhal-serev'].some((key) => keys.includes('enemies/' + key)), 'broad labels and inferred species do not identify a boss: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'a rabbit', race: 'fiend' },
    { name: 'Rabbit of Caerbannog', race: 'rabbit' },
    { name: 'elemental', race: 'elemental' },
    { name: 'Volcano Heart', race: 'golem' },
    { name: 'bridge warden', race: 'golem' },
    { name: 'Gravemarch span', race: 'construct' },
    { name: 'giant', race: 'giant' },
    { name: 'Obsidian thane', race: 'golem' },
    { name: 'queen', race: 'construct' },
    { name: 'The Parallax Queen', race: 'insect' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!['rabbit-of-caerbannog', 'volcano-heart', 'gravemarch-span', 'obsidian-thane', 'parallax-queen'].some((key) => keys.includes('enemies/' + key)), 'generic shorts and inferred races retain fallback art: ' + JSON.stringify(fighter));
  }
  for (const fighter of [
    { name: 'gnasher', race: 'reptile' },
    { name: 'brood-mother', race: 'reptile' },
    { name: 'stalker', race: 'reptile' },
    { name: 'wyrm', race: 'dragon' },
    { name: 'antler', race: 'spirit' },
    { name: 'Cragjaw', race: 'dragon' },
    { name: 'Rattleback', race: 'beast' },
    { name: 'Echoing drop stalker', race: 'lizard' },
    { name: 'Black vent ancient', race: 'reptile' },
    { name: 'Hollow Antler', race: 'treant' },
  ]) {
    const observed = { ...fighter, appearanceKnown: true, isNpc: true };
    const keys = spriteKeysFor(observed, resolveFigure(observed, 'target'), 'target');
    assert.ok(!['cragjaw', 'rattleback', 'echoing-drop-stalker', 'black-vent-ancient', 'hollow-antler'].some((key) => keys.includes('enemies/' + key)), 'shared descriptions and inferred species do not identify a boss: ' + JSON.stringify(fighter));
  }
});

test('every playable race resolves to a shipped sheet or a shared archetype', () => {
  const races = [
    'arctic-elf', 'barbarian', 'crannian-gnome', 'crinos', 'darkwinder', 'desert-dwarf',
    'desert-nomad', 'dragon', 'faerie', 'glavian', 'gypsy', 'halfling', 'high-elf',
    'hyperborean-gnome', 'ice-gnoll', 'ice-ogre', 'kender', 'northman', 'pixie',
    'rift-duergar', 'scro', 'shel-zaranite', 'sidhe', 'silver-elf', 'souvraeli',
    'stone-dwarf', 'swamp-troll', 'sylph', 'thraxian', 'uruk', 'wayfarian', 'wolf',
    'yugoloth', 'arthok', 'ursavar', 'vaelkar', 'reedstalker', 'boneback', 'miura', 'zymari',
  ];
  for (const race of races) {
    const combatant = { gender: 'female', race };
    const keys = spriteKeysFor(combatant, resolveFigure(combatant), 'player');
    assert.ok(keys.some(key => key !== 'humanoid' && existsSync(new URL('../public/assets/sprites/' + key + '.json', import.meta.url))), race + ' has non-generic art coverage');
  }
});

test('enemy names map to distinct shipped archetypes', () => {
  assert.equal(enemySpriteKey('an ash drake'), 'enemies/drake');
  assert.equal(enemySpriteKey('a giant venom spider'), 'enemies/spider');
  assert.equal(enemySpriteKey('a giant plague rat'), 'enemies/rat');
  assert.equal(enemySpriteKey('a cave bat'), 'enemies/bat');
  assert.equal(enemySpriteKey('a brown bear'), 'enemies/bear');
  assert.equal(enemySpriteKey('a giant wild boar'), 'enemies/boar');
  assert.equal(enemySpriteKey('a giant marsh snake'), 'enemies/serpent');
  assert.equal(enemySpriteKey('a giant serpent'), 'enemies/serpent');
  assert.equal(enemySpriteKey('a giant crab'), 'enemies/crab');
  assert.equal(enemySpriteKey('a giant crocodile'), 'enemies/crocodile');
  assert.equal(enemySpriteKey('a giant alligator'), 'enemies/crocodile');
  assert.equal(enemySpriteKey('crabapple'), '');
  assert.equal(enemySpriteKey('a stone golem'), 'enemies/golem');
  assert.equal(enemySpriteKey('a reed goblin warden'), 'enemies/goblin');
  assert.equal(enemySpriteKey('a smelly little kobold'), 'enemies/kobold');
  assert.equal(enemySpriteKey('a giant minotaur'), 'enemies/minotaur');
  assert.equal(enemySpriteKey('a stone gargoyle'), 'enemies/gargoyle');
  assert.equal(enemySpriteKey('goblinfish'), '');
  assert.equal(enemySpriteKey('a standard bearer'), '');
  assert.equal(enemySpriteKey('the skeletal knight'), 'enemies/undead');
  assert.equal(enemySpriteKey('a swamp troll'), 'enemies/troll');
  assert.equal(enemySpriteKey('Aurora'), '');
});

test('a race sheet takes over from the kind sheet once it is ready, and cloak overrides parse', async () => {
  class FakeImage {
    set src(value) { this._src = value; setTimeout(() => { if (this.onload) this.onload(); }, this._src.includes('scro') ? 40 : 0); }
    get src() { return this._src; }
  }
  const fetchImpl = async (url) => {
    if (url.endsWith('humanoid.json')) return { ok: true, text: async () => JSON.stringify(manifest()), json: async () => manifest() };
    if (url.endsWith('male-scro.json')) return { ok: true, text: async () => JSON.stringify(manifest({ image: '/assets/sprites/male-scro.png', cloak: '#4d1414' })), json: async () => manifest({ image: '/assets/sprites/male-scro.png', cloak: '#4d1414' }) };
    if (url.endsWith('characters/grash.json')) return { ok: true, text: async () => JSON.stringify(manifest({ kind: 'dragon' })), json: async () => manifest({ kind: 'dragon' }) };
    return { ok: false, text: async () => JSON.stringify(null), json: async () => null };
  };
  const library = createSpriteLibrary({ fetch: fetchImpl, Image: FakeImage });
  const keys = ['characters/grash', 'male-scro', 'humanoid'];
  assert.equal(library.pick(keys), null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(library.pick(keys).key, 'humanoid', 'kind sheet is ready first');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const picked = library.pick(keys);
  assert.equal(picked.key, 'male-scro', 'the more specific sheet wins once loaded');
  assert.equal(picked.sheet.cloak, '#4d1414');
  assert.equal(library.status('characters/grash'), 'failed', 'a sheet with an unknown body kind is refused');
  assert.equal(normalizeSpriteManifest(manifest({ cloak: false }), 'humanoid').cloak, false);
  assert.equal(normalizeSpriteManifest(manifest({ cloak: 'red' }), 'humanoid').cloak, true, 'non-hex colors are ignored');
});
