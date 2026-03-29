import { dom } from './state.js';
import { parseAnsi, styleToElement } from './ansi.js';
import { MAX_LINES, PRUNE_BATCH } from './constants.js';

let isScrollLocked = false;
let lineCount = 0;
let pendingDivs = [];
let rafScheduled = false;

export function initOutput() {
  dom.output.addEventListener('scroll', function() {
    const atBottom = (dom.output.scrollHeight - dom.output.scrollTop - dom.output.clientHeight) < 5;
    isScrollLocked = !atBottom;
  });
}

export function appendOutput(text, cssClass) {
  const fragments = parseAnsi(text);

  const lines = [[]];
  for (const frag of fragments) {
    const parts = frag.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i]) {
        lines[lines.length - 1].push({ text: parts[i], style: frag.style });
      }
    }
  }

  for (const lineFrags of lines) {
    const div = document.createElement('div');
    div.className = 'output-line' + (cssClass ? ' ' + cssClass : '');
    if (lineFrags.length === 0) {
      div.appendChild(document.createTextNode('\u200B'));
    } else {
      for (const frag of lineFrags) {
        const el = styleToElement(frag.text, frag.style);
        if (el) div.appendChild(el);
      }
    }
    pendingDivs.push(div);
  }

  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushOutput);
  }
}

export function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'output-line system-line';
  div.appendChild(document.createTextNode(text));
  pendingDivs.push(div);
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushOutput);
  }
}

export function appendEcho(text) {
  const div = document.createElement('div');
  div.className = 'output-line echo-line';
  div.appendChild(document.createTextNode('> ' + text));
  pendingDivs.push(div);
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushOutput);
  }
}

function flushOutput() {
  rafScheduled = false;
  if (pendingDivs.length === 0) return;

  const frag = document.createDocumentFragment();
  for (const div of pendingDivs) frag.appendChild(div);
  lineCount += pendingDivs.length;
  pendingDivs = [];

  dom.output.appendChild(frag);

  if (lineCount > MAX_LINES) {
    const toRemove = Math.min(PRUNE_BATCH, lineCount - MAX_LINES);
    for (let i = 0; i < toRemove; i++) {
      dom.output.removeChild(dom.output.firstChild);
    }
    lineCount -= toRemove;
  }

  if (!isScrollLocked) {
    dom.output.scrollTop = dom.output.scrollHeight;
  }
}

export function clearOutput() {
  dom.output.textContent = '';
  lineCount = 0;
  pendingDivs = [];
}
