'use strict';

const fs = require('fs');
const path = require('path');
const packageMetadata = require('../package.json');

const SUPPORTED_PLATFORMS = ['mac', 'win', 'linux'];

function releaseContract(platform, version, productName = 'Darkwind') {
  const prefix = `${productName}-${version}`;
  const contracts = {
    mac: {
      metadata: 'latest-mac.yml',
      downloads: [
        `${prefix}-mac-universal.zip`,
        `${prefix}-mac-universal.dmg`,
      ],
      artifacts: [
        `${prefix}-mac-universal.zip`,
        `${prefix}-mac-universal.zip.blockmap`,
        `${prefix}-mac-universal.dmg`,
        `${prefix}-mac-universal.dmg.blockmap`,
        'latest-mac.yml',
      ],
    },
    win: {
      metadata: 'latest.yml',
      downloads: [`${prefix}-win-x64.exe`],
      artifacts: [
        `${prefix}-win-x64.exe`,
        `${prefix}-win-x64.exe.blockmap`,
        'latest.yml',
      ],
    },
    linux: {
      metadata: 'latest-linux.yml',
      downloads: [
        `${prefix}-linux-x86_64.AppImage`,
        `${prefix}-linux-amd64.deb`,
      ],
      artifacts: [
        `${prefix}-linux-x86_64.AppImage`,
        `${prefix}-linux-amd64.deb`,
        'latest-linux.yml',
      ],
    },
  };
  if (!contracts[platform]) {
    throw new Error(`Unsupported desktop release platform: ${platform}`);
  }
  return contracts[platform];
}

function yamlScalar(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function readGeneratedMetadata(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const versionMatch = source.match(/^version:\s*(.+?)\s*$/m);
  const urls = Array.from(source.matchAll(/^\s*-\s+url:\s*(.+?)\s*$/gm),
    (match) => yamlScalar(match[1]));
  const sha512Count = Array.from(source.matchAll(/^\s*sha512:\s*\S+/gm)).length;
  return {
    source,
    version: versionMatch ? yamlScalar(versionMatch[1]) : '',
    urls,
    sha512Count,
  };
}

function validatePlatformRelease(platform, directory, options = {}) {
  const version = options.version || packageMetadata.version;
  const productName = options.productName
    || packageMetadata.build.productName
    || packageMetadata.desktopName
    || 'Darkwind';
  const contract = releaseContract(platform, version, productName);
  const errors = [];

  for (const artifact of contract.artifacts) {
    const artifactPath = path.join(directory, artifact);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`missing ${artifact}`);
      continue;
    }
    if (!fs.statSync(artifactPath).size) errors.push(`empty ${artifact}`);
  }

  const metadataPath = path.join(directory, contract.metadata);
  if (fs.existsSync(metadataPath)) {
    const metadata = readGeneratedMetadata(metadataPath);
    if (metadata.version !== version) {
      errors.push(
        `${contract.metadata} version is ${metadata.version || 'missing'}, expected ${version}`
      );
    }
    for (const download of contract.downloads) {
      if (!metadata.urls.includes(download)) {
        errors.push(`${contract.metadata} does not reference ${download}`);
      }
    }
    if (metadata.sha512Count < contract.downloads.length) {
      errors.push(`${contract.metadata} is missing SHA-512 checksums`);
    }
  }

  if (errors.length) {
    throw new Error(`${platform} release validation failed:\n- ${errors.join('\n- ')}`);
  }
  return contract.artifacts.map((artifact) => path.join(directory, artifact));
}

function validateRelease(platform, directory, options = {}) {
  const platforms = platform === 'all' ? SUPPORTED_PLATFORMS : [platform];
  return platforms.flatMap((name) =>
    validatePlatformRelease(name, directory, options));
}

if (require.main === module) {
  const platform = process.argv[2];
  const directory = path.resolve(process.argv[3] || 'dist/desktop');
  if (!platform) {
    console.error('Usage: node desktop/validate-release.cjs <mac|win|linux|all> [directory]');
    process.exit(2);
  }
  try {
    const artifacts = validateRelease(platform, directory);
    console.log(`Validated ${artifacts.length} desktop release artifacts in ${directory}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  readGeneratedMetadata,
  releaseContract,
  validatePlatformRelease,
  validateRelease,
};
