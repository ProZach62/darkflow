import { state } from './state.js';

const GMCP_CLIENT_NAME = 'WebMUD Client';
const gmcpTextEncoder = new TextEncoder();
export const gmcpTextDecoder = new TextDecoder('utf-8');

export const gmcp = {
  enabled: false,
  handlers: {},

  on(packageName, callback) {
    if (!this.handlers[packageName]) this.handlers[packageName] = [];
    this.handlers[packageName].push(callback);
  },

  off(packageName, callback) {
    if (!this.handlers[packageName]) return;
    this.handlers[packageName] = this.handlers[packageName].filter(cb => cb !== callback);
  },

  dispatch(packageName, data) {
    if (this.handlers['*']) {
      this.handlers['*'].forEach(cb => cb(packageName, data));
    }
    if (this.handlers[packageName]) {
      this.handlers[packageName].forEach(cb => cb(data, packageName));
    }
  },

  send(packageName, data) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const payload = data !== undefined
      ? packageName + ' ' + JSON.stringify(data)
      : packageName;
    state.ws.send(gmcpTextEncoder.encode(payload));
  },

  sendHandshake() {
    this.send('Core.Hello', {
      client: GMCP_CLIENT_NAME,
      version: state.clientVersion || 'unknown'
    });
    this.send('Core.Supports.Set', [
      'Char 1',
      'Char.Vitals 1',
      'Char.Items 1',
      'Room 1',
      'Comm 1',
      'Group 1',
      'Game 1',
      'Darkwind.Window 1',
      'Darkwind.IDE 1',
      'Darkwind.MapData 1',
      'Darkwind.Completion 1',
      'Darkwind.Quests 1'
    ]);
    this.enabled = true;
  },

  reset() {
    this.enabled = false;
  }
};
