import { state, dom } from './state.js';
import { appendEcho, clearOutput } from './output.js';
import { MAX_HISTORY, SESSION_KEY } from './constants.js';
import { trackCommand } from './map-data.js';
import { initCompletion, requestCompletion, resetCompletionState } from './completion.js';
import { settingsManager } from './settings-manager.js';

let commandHistory = [];
let historyIndex = 0;
let currentInput = '';
let _saveTimer = null;

export function sendCommandText(text) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;

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
  resetCompletionState();
  historyIndex = commandHistory.length;
  currentInput = '';
  dom.commandInput.focus();

  if (settingsManager.get('repeatLastCommand')) {
    dom.commandInput.value = text;
    dom.commandInput.select();
  } else {
    dom.commandInput.value = '';
  }

  return true;
}

function getMappedCommand(key) {
  if (!settingsManager.get('keyMapperEnabled')) return null;

  const mappings = settingsManager.get('keyMappings');
  if (!Array.isArray(mappings) || mappings.length === 0) return null;

  for (let index = mappings.length - 1; index >= 0; index--) {
    const mapping = mappings[index];
    if (!mapping || mapping.key !== key || !mapping.command) continue;
    return mapping.command;
  }

  return null;
}

function isBlockedEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target === dom.commandInput) return false;
  if (target.closest('.ide-overlay, .cm-editor, .cm-content')) return true;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function handleMappedKey(event) {
  if (event.defaultPrevented || event.repeat) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;

  const command = getMappedCommand(event.key);
  if (!command) return false;
  if (isBlockedEditableTarget(event.target)) return false;

  event.preventDefault();
  event.stopPropagation();
  sendCommandText(command);
  return true;
}

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
  return sendCommandText(dom.commandInput.value);
}

export function initInput() {
  initCompletion();

  dom.commandInput.addEventListener('keydown', function(e) {
    if (handleMappedKey(e)) {
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      requestCompletion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      resetCompletionState();
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
      resetCompletionState();
      if (historyIndex < commandHistory.length) {
        historyIndex++;
        if (historyIndex === commandHistory.length) {
          dom.commandInput.value = currentInput;
        } else {
          dom.commandInput.value = commandHistory[historyIndex];
        }
      }
    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
      resetCompletionState();
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
    if (e.defaultPrevented) return;
    if (isBlockedEditableTarget(e.target)) return;

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearOutput();
    } else if (e.key === 'Escape') {
      resetCompletionState();
      dom.commandInput.value = '';
      dom.commandInput.focus();
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      dom.output.scrollBy(0, -dom.output.clientHeight * 0.8);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      dom.output.scrollBy(0, dom.output.clientHeight * 0.8);
    }

    if (handleMappedKey(e)) return;

    // Auto-focus: redirect printable keys to command input
    if (document.activeElement === dom.commandInput) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length === 1) {
      dom.commandInput.focus();
    }
  });
}
