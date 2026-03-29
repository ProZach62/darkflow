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
  output: null,
  commandInput: null,
  sendBtn: null,
  statusUrl: null,
  statusDuration: null,
  statusBytes: null,
  gmcpPanel: null,
  gmcpToggle: null,
};

export function initDom() {
  dom.host = document.getElementById('host');
  dom.port = document.getElementById('port');
  dom.wssToggle = document.getElementById('wss-toggle');
  dom.connectBtn = document.getElementById('connect-btn');
  dom.autoReconnect = document.getElementById('auto-reconnect');
  dom.connectionState = document.getElementById('connection-state');
  dom.output = document.getElementById('output');
  dom.commandInput = document.getElementById('command-input');
  dom.sendBtn = document.getElementById('send-btn');
  dom.statusUrl = document.getElementById('status-url');
  dom.statusDuration = document.getElementById('status-duration');
  dom.statusBytes = document.getElementById('status-bytes');
  dom.gmcpPanel = document.getElementById('gmcp-panel');
  dom.gmcpToggle = document.getElementById('gmcp-toggle');
}
