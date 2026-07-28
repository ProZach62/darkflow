'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageMetadata = require('../package.json');
const {
  releaseContract,
  validatePlatformRelease,
} = require('../desktop/validate-release.cjs');

test('desktop release scripts explicitly produce unsigned packages', () => {
  assert.equal(packageMetadata.build.mac.identity, null);
  assert.equal(packageMetadata.build.mac.notarize, false);
  assert.equal(packageMetadata.build.mac.hardenedRuntime, false);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.identity=null/);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.notarize=false/);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.hardenedRuntime=false/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:release:win'],
    /forceCodeSigning=true/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:dist:mac'],
    /forceCodeSigning/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:dist:win'],
    /forceCodeSigning/);
});

test('release validator requires installers, blockmaps, metadata, and checksums', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-release-'));
  const version = '9.8.7';
  const contract = releaseContract('win', version);

  try {
    for (const artifact of contract.artifacts) {
      fs.writeFileSync(path.join(directory, artifact), 'artifact\n');
    }
    fs.writeFileSync(path.join(directory, contract.metadata), [
      `version: ${version}`,
      'files:',
      `  - url: ${contract.downloads[0]}`,
      '    sha512: checksum',
      `path: ${contract.downloads[0]}`,
      'sha512: checksum',
      '',
    ].join('\n'));

    assert.doesNotThrow(() =>
      validatePlatformRelease('win', directory, { version }));

    fs.unlinkSync(path.join(directory, `${contract.downloads[0]}.blockmap`));
    assert.throws(() =>
      validatePlatformRelease('win', directory, { version }),
    /missing .*\.blockmap/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
