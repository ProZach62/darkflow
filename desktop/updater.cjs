'use strict';

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15 * 1000;

function createDesktopUpdater({
  enabled,
  sendStatus,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  initialCheckDelayMs = INITIAL_CHECK_DELAY_MS,
  loadUpdater = () => require('electron-updater').autoUpdater,
}) {
  let updater = null;
  let initialTimer = null;
  let intervalTimer = null;
  let updateDownloaded = false;
  let manualCheck = false;
  let lastStatus = { state: enabled ? 'idle' : 'disabled' };

  function emit(state, details = {}) {
    lastStatus = { state, ...details };
    sendStatus(lastStatus);
  }

  function reportError(error) {
    console.error('[desktop-updater]', error);
    const downloadFailed = ['available', 'downloading'].includes(lastStatus.state);
    if (manualCheck || downloadFailed) {
      emit('error', {
        message: downloadFailed
          ? 'Unable to download the update.'
          : 'Unable to check for updates.',
      });
    }
    manualCheck = false;
  }

  function initialize() {
    if (!enabled || updater) return;

    updater = loadUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;

    updater.on('checking-for-update', () => {
      if (manualCheck) emit('checking');
    });
    updater.on('update-available', (info) => {
      manualCheck = false;
      emit('available', { version: info.version });
    });
    updater.on('update-not-available', () => {
      if (manualCheck) emit('current');
      manualCheck = false;
    });
    updater.on('download-progress', (progress) => {
      emit('downloading', {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      });
    });
    updater.on('update-downloaded', (info) => {
      updateDownloaded = true;
      emit('downloaded', { version: info.version });
    });
    updater.on('error', reportError);

    initialTimer = setTimeout(() => check(), initialCheckDelayMs);
    intervalTimer = setInterval(() => check(), checkIntervalMs);
  }

  async function check({ manual = false } = {}) {
    if (!enabled || !updater) {
      if (manual) emit('disabled');
      return false;
    }

    manualCheck = manual;
    try {
      await updater.checkForUpdates();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  function install() {
    if (!enabled || !updater || !updateDownloaded) return false;
    updater.quitAndInstall(false, true);
    return true;
  }

  function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return {
    initialize,
    check,
    install,
    stop,
    getStatus: () => ({ ...lastStatus }),
  };
}

module.exports = {
  createDesktopUpdater,
  DEFAULT_CHECK_INTERVAL_MS,
};
