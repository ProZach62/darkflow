import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.WebSocket = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

const {
  getSocketReadyState,
  isSocketClosingOrClosed,
  isSocketConnecting,
  isSocketOpen,
  socketReadyStateName,
} = await import('../public/js/socket-state.js');

test('socket state helpers treat only OPEN as sendable', () => {
  assert.equal(isSocketOpen({ readyState: WebSocket.OPEN }), true);
  assert.equal(isSocketOpen({ readyState: WebSocket.CONNECTING }), false);
  assert.equal(isSocketOpen({ readyState: WebSocket.CLOSING }), false);
  assert.equal(isSocketOpen({ readyState: WebSocket.CLOSED }), false);
  assert.equal(isSocketOpen(null), false);
});

test('socket state helpers classify non-open sockets', () => {
  assert.equal(isSocketConnecting({ readyState: WebSocket.CONNECTING }), true);
  assert.equal(isSocketClosingOrClosed({ readyState: WebSocket.CLOSING }), true);
  assert.equal(isSocketClosingOrClosed({ readyState: WebSocket.CLOSED }), true);
  assert.equal(isSocketClosingOrClosed({ readyState: WebSocket.OPEN }), false);
  assert.equal(getSocketReadyState(null), WebSocket.CLOSED);
});

test('socket state names are stable for diagnostics', () => {
  assert.equal(socketReadyStateName({ readyState: WebSocket.CONNECTING }), 'connecting');
  assert.equal(socketReadyStateName({ readyState: WebSocket.OPEN }), 'open');
  assert.equal(socketReadyStateName({ readyState: WebSocket.CLOSING }), 'closing');
  assert.equal(socketReadyStateName({ readyState: WebSocket.CLOSED }), 'closed');
  assert.equal(socketReadyStateName({ readyState: 99 }), 'unknown');
});
