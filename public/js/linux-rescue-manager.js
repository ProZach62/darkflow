import { gmcp } from './gmcp.js';
import { dom } from './state.js';
import {
  createLinuxRescueState,
  getLinuxRescuePrompt,
  runLinuxRescueCommand,
} from './linux-rescue-core.mjs';

const PKG_OPEN = 'Darkwind.LinuxRescue.Open';

export const linuxRescueManager = {
  els: {
    overlay: null,
    stream: null,
    prompt: null,
    input: null,
  },

  open: false,
  state: createLinuxRescueState(),
  localHistory: [],
  historyIndex: 0,

  init() {
    if (typeof document === 'undefined') return;
    this.mount();
    gmcp.on(PKG_OPEN, () => this.show());
    document.addEventListener('keydown', (event) => this.handleDocumentKeydown(event), true);
  },

  mount() {
    if (this.els.overlay || typeof document === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.className = 'linux-rescue-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Linux rescue terminal');

    const terminal = document.createElement('div');
    terminal.className = 'linux-rescue-terminal';

    const title = document.createElement('div');
    title.className = 'linux-rescue-title';
    title.textContent = 'tty1 - secure maintenance session';

    const stream = document.createElement('div');
    stream.className = 'linux-rescue-stream';

    const row = document.createElement('div');
    row.className = 'linux-rescue-input-row';

    const prompt = document.createElement('span');
    prompt.className = 'linux-rescue-prompt';

    const input = document.createElement('input');
    input.className = 'linux-rescue-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;

    input.addEventListener('keydown', (event) => this.handleInputKeydown(event));
    overlay.addEventListener('mousedown', () => input.focus());

    row.appendChild(prompt);
    row.appendChild(input);
    terminal.appendChild(title);
    terminal.appendChild(stream);
    terminal.appendChild(row);
    overlay.appendChild(terminal);
    document.body.appendChild(overlay);

    this.els = { overlay, stream, prompt, input };
    this.updatePrompt();
  },

  show() {
    this.mount();
    this.open = true;
    this.state = createLinuxRescueState();
    this.localHistory = [];
    this.historyIndex = 0;
    this.clearStream();
    this.appendLines([
      'Ubuntu 22.04.4 LTS workstation tty1',
      'Last login: Fri Jun 12 09:41:28 from vpn.internal',
      'Type "help" for available commands. Type "exit" to return.',
      '',
    ]);
    this.updatePrompt();
    this.els.overlay.classList.add('open');
    this.els.input.value = '';
    this.els.input.focus();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  },

  hide() {
    this.open = false;
    if (this.els.overlay) this.els.overlay.classList.remove('open');
    if (this.els.input) this.els.input.value = '';
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (dom.commandInput) dom.commandInput.focus();
  },

  handleDocumentKeydown(event) {
    if (!this.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      return;
    }
    if (event.target !== this.els.input) {
      this.els.input.focus();
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        this.els.input.value += event.key;
        event.preventDefault();
        event.stopPropagation();
      }
    }
  },

  handleInputKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.localHistory.length) return;
      this.historyIndex = Math.max(0, this.historyIndex - 1);
      this.els.input.value = this.localHistory[this.historyIndex] || '';
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.localHistory.length) return;
      this.historyIndex = Math.min(this.localHistory.length, this.historyIndex + 1);
      this.els.input.value = this.localHistory[this.historyIndex] || '';
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.submit(this.els.input.value);
  },

  submit(raw) {
    const command = String(raw || '');
    this.appendLine(getLinuxRescuePrompt(this.state) + ' ' + command);
    if (command.trim()) {
      this.localHistory.push(command);
      this.historyIndex = this.localHistory.length;
    }
    const result = runLinuxRescueCommand(this.state, command);
    if (result.clear) this.clearStream();
    if (Array.isArray(result.output)) this.appendLines(result.output);
    this.els.input.value = '';
    this.updatePrompt();
    if (result.exit) this.hide();
  },

  updatePrompt() {
    if (!this.els.prompt) return;
    this.els.prompt.textContent = getLinuxRescuePrompt(this.state) + ' ';
  },

  clearStream() {
    if (this.els.stream) this.els.stream.textContent = '';
  },

  appendLines(lines) {
    lines.forEach((line) => this.appendLine(line));
  },

  appendLine(text) {
    if (!this.els.stream) return;
    const line = document.createElement('div');
    line.className = 'linux-rescue-line';
    line.textContent = text;
    this.els.stream.appendChild(line);
    this.els.stream.scrollTop = this.els.stream.scrollHeight;
  },
};
