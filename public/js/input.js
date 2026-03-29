import { state, dom } from './state.js';
import { appendEcho, clearOutput } from './output.js';
import { MAX_HISTORY, SESSION_KEY } from './constants.js';

let commandHistory = [];
let historyIndex = 0;
let currentInput = '';

export function loadHistory() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) commandHistory = JSON.parse(stored);
  } catch(e) { /* ignore */ }
  historyIndex = commandHistory.length;
}

export function saveHistory() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(commandHistory));
  } catch(e) { /* ignore */ }
}

export function sendCommand() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const text = dom.commandInput.value;
  state.ws.send(text);
  state.bytesSent += text.length;

  if (text) {
    commandHistory.push(text);
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory.splice(0, commandHistory.length - MAX_HISTORY);
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
  });
}
