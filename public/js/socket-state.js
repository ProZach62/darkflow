export function getSocketReadyState(ws) {
  return ws && typeof ws.readyState === 'number' ? ws.readyState : WebSocket.CLOSED;
}

export function isSocketOpen(ws) {
  return getSocketReadyState(ws) === WebSocket.OPEN;
}

export function isSocketConnecting(ws) {
  return getSocketReadyState(ws) === WebSocket.CONNECTING;
}

export function isSocketClosingOrClosed(ws) {
  const readyState = getSocketReadyState(ws);
  return readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED;
}

export function socketReadyStateName(ws) {
  switch (getSocketReadyState(ws)) {
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.OPEN: return 'open';
    case WebSocket.CLOSING: return 'closing';
    case WebSocket.CLOSED: return 'closed';
    default: return 'unknown';
  }
}
