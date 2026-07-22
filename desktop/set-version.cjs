'use strict';

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  console.error('Usage: npm run version:set -- <semver>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const clientVersionPath = path.join(root, 'public', 'version.json');

const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

packageData.version = version;
lockData.version = version;
if (lockData.packages && lockData.packages['']) {
  lockData.packages[''].version = version;
}

fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n');
fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2) + '\n');
fs.writeFileSync(clientVersionPath, JSON.stringify({ version }) + '\n');

console.log(`Darkflow and Darkwind desktop versions set to ${version}.`);
