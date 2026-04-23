import { state } from './state.js';
import { appendSystemMessage } from './output.js';
import { sendSocketPayload } from './connection.js';

const GMCP_CLIENT_NAME = 'WebMUD Client';
const GMCP_MEDIA_REFRESH_PACKAGE = 'Darkwind.Client.RefreshMedia';
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
    sendSocketPayload(gmcpTextEncoder.encode(payload), {
      kind: 'gmcp',
      size: payload.length,
      preview: packageName,
    });
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
      'Darkwind.Char.Avatar 1',
      'Darkwind.Room.Image 1',
      'Darkwind.Window 1',
      'Darkwind.IDE 1',
      'Darkwind.MapData 1',
      'Darkwind.Completion 1',
      'Darkwind.Quests 1',
      'Darkwind.Announcements 1',
      'Darkwind.Giphy 1'
    ]);
    this.enabled = true;
  },

  reset() {
    this.enabled = false;
  },

  requestMediaRefresh() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.send(GMCP_MEDIA_REFRESH_PACKAGE);
    return true;
  },

  restartHandshake() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      appendSystemMessage('GMCP restart unavailable: not connected.');
      return false;
    }

    this.reset();
    this.sendHandshake();
    this.requestMediaRefresh();
    appendSystemMessage('GMCP handshake re-sent and media refresh requested.');
    return true;
  }
};
