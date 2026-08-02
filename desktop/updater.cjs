'use strict';

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15 * 1000;
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function macInstallerUrl(version) {
  const normalized = String(version || '').trim();
  if (!STABLE_VERSION_PATTERN.test(normalized)) return '';
  const encoded = encodeURIComponent(normalized);
  return `https://github.com/jasona/darkflow/releases/download/v${encoded}/Darkwind-${encoded}-mac-universal.dmg`;
}

function createDesktopUpdater({
  enabled,
  sendStatus,
  platform = process.platform,
  openExternal = () => false,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  initialCheckDelayMs = INITIAL_CHECK_DELAY_MS,
  loadUpdater = () => require('electron-updater').autoUpdater,
}) {
  let updater = null;
  let initialTimer = null;
  let intervalTimer = null;
  let updateDownloaded = false;
  let manualInstallerUrl = '';
  let manualCheck = false;
  let lastStatus = { state: enabled ? 'idle' : 'disabled' };
  const requiresManualInstall = platform === 'darwin';

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
    updater.autoDownload = !requiresManualInstall;
    updater.autoInstallOnAppQuit = !requiresManualInstall;
    updater.allowPrerelease = false;

    updater.on('checking-for-update', () => {
      if (manualCheck) emit('checking');
    });
    updater.on('update-available', (info) => {
      manualCheck = false;
      if (requiresManualInstall) {
        manualInstallerUrl = macInstallerUrl(info.version);
        if (!manualInstallerUrl) {
          emit('error', { message: 'The macOS update download is unavailable.' });
          return;
        }
        emit('manual', { version: info.version });
        return;
      }
      emit('available', { version: info.version });
    });
    updater.on('update-not-available', () => {
      manualInstallerUrl = '';
      if (manualCheck) emit('current');
      manualCheck = false;
    });
    updater.on('download-progress', (progress) => {
      if (requiresManualInstall) return;
      emit('downloading', {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      });
    });
    updater.on('update-downloaded', (info) => {
      if (requiresManualInstall) return;
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
    if (requiresManualInstall) {
      if (!enabled || !updater || lastStatus.state !== 'manual' || !manualInstallerUrl) {
        return false;
      }
      try {
        Promise.resolve(openExternal(manualInstallerUrl)).then((opened) => {
          if (opened === false) {
            emit('error', { message: 'Unable to open the macOS update download.' });
          }
        }).catch(() => {
          emit('error', { message: 'Unable to open the macOS update download.' });
        });
        return true;
      } catch (error) {
        emit('error', { message: 'Unable to open the macOS update download.' });
        return false;
      }
    }
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
  macInstallerUrl,
};
