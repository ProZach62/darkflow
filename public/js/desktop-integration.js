function formatUpdateMessage(status) {
  const version = status.version ? ' ' + status.version : '';
  switch (status.state) {
    case 'checking':
      return { message: 'Checking for Darkwind updates...' };
    case 'available':
      return { message: `Darkwind${version} is downloading...` };
    case 'downloading':
      return { message: `Downloading Darkwind update: ${status.percent || 0}%` };
    case 'downloaded':
      return {
        message: `Darkwind${version} is ready to install.`,
        action: 'Restart and update',
      };
    case 'manual':
      return {
        message: `Darkwind${version} is available. Download the macOS installer to update.`,
        action: 'Download installer',
      };
    case 'current':
      return { message: 'Darkwind is up to date.', temporary: true };
    case 'error':
      return {
        message: status.message || 'Unable to check for updates.',
        action: 'Try again',
      };
    default:
      return null;
  }
}

export function initializeDesktopUpdates({ banner, message, action }) {
  const desktop = window.darkflowDesktop;
  if (!desktop || typeof desktop.getInfo !== 'function') return false;

  let currentState = 'idle';
  let hideTimer = null;

  function hideBanner() {
    banner.style.display = 'none';
  }

  function render(status) {
    if (!status || typeof status.state !== 'string') return;
    currentState = status.state;
    const display = formatUpdateMessage(status);
    if (!display) {
      hideBanner();
      return;
    }

    if (hideTimer) clearTimeout(hideTimer);
    message.textContent = display.message;
    action.textContent = display.action || '';
    action.hidden = !display.action;
    banner.style.display = 'block';

    if (display.temporary) {
      hideTimer = setTimeout(hideBanner, 5000);
    }
  }

  action.addEventListener('click', (event) => {
    event.preventDefault();
    const operation = ['downloaded', 'manual'].includes(currentState)
      ? desktop.installUpdate()
      : desktop.checkForUpdates();
    Promise.resolve(operation).catch(() => {});
  });

  desktop.onUpdateStatus(render);
  desktop.getInfo().then((info) => render(info.updateStatus)).catch(() => {});
  return true;
}

export { formatUpdateMessage };
