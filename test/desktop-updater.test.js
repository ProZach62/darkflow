'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createDesktopUpdater,
  macInstallerUrl,
} = require('../desktop/updater.cjs');

test('disabled desktop updater never checks or installs', async () => {
  const statuses = [];
  const updater = createDesktopUpdater({
    enabled: false,
    sendStatus: (status) => statuses.push(status),
  });

  updater.initialize();
  assert.equal(await updater.check({ manual: true }), false);
  assert.equal(updater.install(), false);
  assert.deepEqual(statuses, [{ state: 'disabled' }]);
  assert.deepEqual(updater.getStatus(), { state: 'disabled' });
});

test('enabled updater reports download progress and installs only after download', () => {
  const statuses = [];
  const mock = new EventEmitter();
  mock.checkForUpdates = async () => {};
  mock.quitAndInstall = () => { mock.installed = true; };

  const updater = createDesktopUpdater({
    enabled: true,
    platform: 'win32',
    sendStatus: (status) => statuses.push(status),
    initialCheckDelayMs: 60_000,
    checkIntervalMs: 60_000,
    loadUpdater: () => mock,
  });
  updater.initialize();

  assert.equal(updater.install(), false);
  mock.emit('update-available', { version: '1.5.0' });
  mock.emit('download-progress', { percent: 42.6 });
  mock.emit('update-downloaded', { version: '1.5.0' });
  assert.equal(updater.install(), true);
  assert.equal(mock.installed, true);
  assert.deepEqual(statuses, [
    { state: 'available', version: '1.5.0' },
    { state: 'downloading', percent: 43 },
    { state: 'downloaded', version: '1.5.0' },
  ]);

  updater.stop();
});

test('unsigned macOS updates open the versioned DMG instead of trying to restart', async () => {
  const statuses = [];
  const openedUrls = [];
  const mock = new EventEmitter();
  mock.checkForUpdates = async () => {};
  mock.quitAndInstall = () => { mock.installed = true; };

  const updater = createDesktopUpdater({
    enabled: true,
    platform: 'darwin',
    openExternal: async (url) => {
      openedUrls.push(url);
      return true;
    },
    sendStatus: (status) => statuses.push(status),
    initialCheckDelayMs: 60_000,
    checkIntervalMs: 60_000,
    loadUpdater: () => mock,
  });
  updater.initialize();

  assert.equal(mock.autoDownload, false);
  assert.equal(mock.autoInstallOnAppQuit, false);
  mock.emit('update-available', { version: '1.5.3' });
  assert.deepEqual(statuses, [{ state: 'manual', version: '1.5.3' }]);
  mock.emit('download-progress', { percent: 100 });
  mock.emit('update-downloaded', { version: '1.5.3' });
  assert.deepEqual(statuses, [{ state: 'manual', version: '1.5.3' }]);
  assert.equal(updater.install(), true);
  await Promise.resolve();
  assert.deepEqual(openedUrls, [
    'https://github.com/jasona/darkflow/releases/download/v1.5.3/Darkwind-1.5.3-mac-universal.dmg',
  ]);
  assert.equal(mock.installed, undefined);

  updater.stop();
});

test('macOS installer URLs accept only stable release versions', () => {
  assert.equal(macInstallerUrl('1.5.3'),
    'https://github.com/jasona/darkflow/releases/download/v1.5.3/Darkwind-1.5.3-mac-universal.dmg');
  assert.equal(macInstallerUrl('1.5.3-beta.1'), '');
  assert.equal(macInstallerUrl('../latest'), '');
});
