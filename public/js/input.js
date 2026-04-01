import { state, dom } from './state.js';
import { appendEcho, clearOutput } from './output.js';
import { MAX_HISTORY, SESSION_KEY } from './constants.js';
import { trackCommand } from './map-data.js';

let commandHistory = [];
let historyIndex = 0;
let currentInput = '';
let _saveTimer = null;

export function loadHistory() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) commandHistory = JSON.parse(stored);
  } catch(e) { /* ignore */ }
  historyIndex = commandHistory.length;
}

export function saveHistory() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(commandHistory));
    } catch(e) { /* ignore */ }
  }, 500);
}

export function saveHistoryNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(commandHistory));
  } catch(e) { /* ignore */ }
}

export function sendCommand() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const text = dom.commandInput.value;
  trackCommand(text);
  state.ws.send(text);
  state.bytesSent += text.length;

  if (text) {
    commandHistory.push(text);
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory = commandHistory.slice(-MAX_HISTORY);
    }
    saveHistory();
  }

  appendEcho(text);
  dom.commandInput.value = '';
  historyIndex = commandHistory.length;
  currentInput = '';
  dom.commandInput.focus();
}

export function initInput() {
  dom.commandInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      if (historyIndex === commandHistory.length) {
        currentInput = dom.commandInput.value;
      }
      if (historyIndex > 0) {
        historyIndex--;
        dom.commandInput.value = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < commandHistory.length) {
        historyIndex++;
        if (historyIndex === commandHistory.length) {
          dom.commandInput.value = currentInput;
        } else {
          dom.commandInput.value = commandHistory[historyIndex];
        }
      }
    }
  });

  dom.sendBtn.addEventListener('click', sendCommand);

  dom.output.addEventListener('click', function() {
    if (!window.getSelection().toString()) {
      dom.commandInput.focus();
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearOutput();
    } else if (e.key === 'Escape') {
      dom.commandInput.value = '';
      dom.commandInput.focus();
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      dom.output.scrollBy(0, -dom.output.clientHeight * 0.8);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      dom.output.scrollBy(0, dom.output.clientHeight * 0.8);
    }

    // Auto-focus: redirect printable keys to command input
    if (document.activeElement === dom.commandInput) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length === 1) {
      dom.commandInput.focus();
    }
  });
}
