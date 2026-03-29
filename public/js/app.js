import { state, dom, initDom } from './state.js';
import { gmcp } from './gmcp.js';
import { initOutput } from './output.js';
import { panelManager } from './panel-manager.js';
import { connect, disconnect } from './connection.js';
import { loadHistory, saveHistory, saveHistoryNow, initInput } from './input.js';

// ── Initialize DOM refs ─────────────────────────────────────────────
initDom();
initOutput();

// ── Status Bar ──────────────────────────────────────────────────────
function formatDuration(ms) {
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

setInterval(function() {
  if (state.connectTime) {
    dom.statusDuration.textContent = formatDuration(Date.now() - state.connectTime);
  }
  dom.statusBytes.textContent = 'Sent: ' + formatBytes(state.bytesSent) + ' / Recv: ' + formatBytes(state.bytesReceived);
}, 1000);

// ── GMCP Debug Panel ────────────────────────────────────────────────
dom.gmcpToggle.addEventListener('click', function() {
  const visible = dom.gmcpPanel.classList.toggle('open');
  dom.gmcpToggle.style.color = visible ? '#58a6ff' : '#8b949e';
});

gmcp.on('*', function(packageName, data) {
  console.log('[GMCP]', packageName, data);
  const entry = document.createElement('div');
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] '
    + packageName + ' ' + JSON.stringify(data);
  dom.gmcpPanel.appendChild(entry);
  while (dom.gmcpPanel.childNodes.length > 200) {
    dom.gmcpPanel.removeChild(dom.gmcpPanel.firstChild);
  }
  if (dom.gmcpPanel.classList.contains('open')) {
    dom.gmcpPanel.scrollTop = dom.gmcpPanel.scrollHeight;
  }
});

// ── Game Uptime (from GMCP Game package) ────────────────────────────
gmcp.on('Game', function(data) {
  if (data && data.game_uptime) {
    dom.statusUptime.textContent = 'Uptime: ' + data.game_uptime;
  }
});

// ── Connect Button ──────────────────────────────────────────────────
dom.connectBtn.addEventListener('click', function() {
  if (state.ws || dom.connectBtn.classList.contains('disconnect')) {
    disconnect();
  } else {
    connect();
  }
});

// ── Sidebar Toggles ─────────────────────────────────────────────────
document.getElementById('left-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('left-dock');
  const collapsed = !dock.classList.contains('collapsed');
  dock.classList.toggle('collapsed', collapsed);
  this.classList.toggle('active', !collapsed);
  panelManager.state.docks.left = collapsed;
  panelManager.saveState();
});

document.getElementById('right-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('right-dock');
  const collapsed = !dock.classList.contains('collapsed');
  dock.classList.toggle('collapsed', collapsed);
  this.classList.toggle('active', !collapsed);
  panelManager.state.docks.right = collapsed;
  panelManager.saveState();
});

// ── Panels Menu ─────────────────────────────────────────────────────
document.getElementById('panels-menu-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('panels-menu').classList.toggle('open');
});

document.addEventListener('click', function() {
  document.getElementById('panels-menu').classList.remove('open');
});

// ── Init ────────────────────────────────────────────────────────────
dom.host.value = 'darkwind.ai';
dom.wssToggle.checked = true;
loadHistory();
panelManager.init();
initInput();
dom.commandInput.focus();

window.addEventListener('beforeunload', function() {
  saveHistoryNow();
  if (state.ws) state.ws.close(1000, 'Page unload');
});
