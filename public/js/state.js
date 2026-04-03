export const state = {
  ws: null,
  connectTime: null,
  bytesSent: 0,
  bytesReceived: 0,
  reconnectAttempts: 0,
  reconnectTimer: null,
  userDisconnected: false,
};

export const dom = {
  host: null,
  port: null,
  wssToggle: null,
  connectBtn: null,
  autoReconnect: null,
  connectionState: null,
  connectionDot: null,
  connectFields: null,
  toolbarStatus: null,
  gearMenu: null,
  gearConnInfo: null,
  gearDisconnectBtn: null,
  output: null,
  commandInput: null,
  sendBtn: null,
  statusConnection: null,
  statusUptime: null,
  statusVersions: null,
  updateBanner: null,
  updateRefresh: null,
  toolbarBrand: null,
  gmcpPanel: null,
  gmcpToggle: null,
  notificationsBtn: null,
  mailBtn: null,
};

export function initDom() {
  dom.host = document.getElementById('host');
  dom.port = document.getElementById('port');
  dom.wssToggle = document.getElementById('wss-toggle');
  dom.connectBtn = document.getElementById('connect-btn');
  dom.autoReconnect = document.getElementById('auto-reconnect');
  dom.connectionState = document.getElementById('connection-state');
  dom.connectionDot = document.getElementById('connection-dot');
  dom.connectFields = document.getElementById('toolbar-connect-fields');
  dom.toolbarStatus = document.getElementById('toolbar-status');
  dom.gearMenu = document.getElementById('gear-menu');
  dom.gearConnInfo = document.getElementById('gear-conn-info');
  dom.gearDisconnectBtn = document.getElementById('gear-disconnect-btn');
  dom.output = document.getElementById('output');
  dom.commandInput = document.getElementById('command-input');
  dom.sendBtn = document.getElementById('send-btn');
  dom.statusConnection = document.getElementById('status-connection');
  dom.statusUptime = document.getElementById('status-uptime');
  dom.statusVersions = document.getElementById('status-versions');
  dom.updateBanner = document.getElementById('update-banner');
  dom.updateRefresh = document.getElementById('update-refresh');
  dom.toolbarBrand = document.getElementById('toolbar-brand');
  dom.gmcpPanel = document.getElementById('gmcp-panel');
  dom.gmcpToggle = document.getElementById('gmcp-toggle');
  dom.notificationsBtn = document.getElementById('notifications-btn');
  dom.mailBtn = document.getElementById('mail-btn');
}
