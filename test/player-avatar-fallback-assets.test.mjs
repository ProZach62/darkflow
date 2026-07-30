import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const avatarDir = resolve(root, 'public/assets/avatars');
const genders = ['female', 'male'];
const races = [
  'arctic-elf',
  'barbarian',
  'crannian-gnome',
  'darkwinder',
  'desert-dwarf',
  'desert-nomad',
  'dragon',
  'faerie',
  'glavian',
  'gypsy',
  'halfling',
  'high-elf',
  'hyperborean-gnome',
  'ice-gnoll',
  'ice-ogre',
  'kender',
  'northman',
  'pixie',
  'rift-duergar',
  'scro',
  'shel-zaranite',
  'sidhe',
  'silver-elf',
  'souvraeli',
  'stone-dwarf',
  'swamp-troll',
  'sylph',
  'thraxian',
  'uruk',
  'wayfarian',
  'yugoloth',
];

test('bundles one default portrait for every supported gender and race pair', async () => {
  const expected = genders
    .flatMap((gender) => races.map((race) => `${gender}-${race}.png`))
    .sort();
  const actual = (await readdir(avatarDir))
    .filter((name) => name.endsWith('.png'))
    .sort();

  assert.equal(expected.length, 62);
  assert.deepEqual(actual, expected);
  await Promise.all(expected.map((name) => access(resolve(avatarDir, name))));
});
