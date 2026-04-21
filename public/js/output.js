import { dom } from './state.js';
import { parseAnsi, styleToElement } from './ansi.js';
import { highlightManager } from './highlight-manager.js';
import {
  DEFAULT_OUTPUT_SCROLLBACK_PRESET,
  OUTPUT_OVERSCAN_LINES,
  OUTPUT_SCROLLBACK_PRESETS,
} from './constants.js';

const BOTTOM_THRESHOLD_PX = 5;
const DEFAULT_LINE_HEIGHT_PX = 23;

let isScrollLocked = false;
let isOutputPaused = false;
let lineStore = [];
let nextLineId = 1;
let pendingLines = [];
let frameScheduled = false;
let renderInvalidated = false;
let scrollbackLimit = OUTPUT_SCROLLBACK_PRESETS[DEFAULT_OUTPUT_SCROLLBACK_PRESET];
let estimatedLineHeight = DEFAULT_LINE_HEIGHT_PX;
let topSpacer = null;
let viewportEl = null;
let bottomSpacer = null;
let resizeObserver = null;
let suppressScrollEvents = false;
let suppressAutoPause = false;

function syncPauseUi() {
  if (!dom.outputShell || !dom.outputPauseBtn) return;
  dom.outputShell.classList.toggle('paused', isOutputPaused);
  dom.outputPauseBtn.setAttribute('aria-pressed', isOutputPaused ? 'true' : 'false');
  dom.outputPauseBtn.title = isOutputPaused ? 'Resume live terminal' : 'Pause live terminal';
}

function snapOutputToBottom() {
  if (!dom.output) return;
  suppressScrollEvents = true;
  dom.output.scrollTop = dom.output.scrollHeight;
  suppressScrollEvents = false;
}

function releaseAutoPauseSuppression() {
  requestAnimationFrame(() => {
    suppressAutoPause = false;
  });
}

function resumeOutputLive() {
  isOutputPaused = false;
  isScrollLocked = false;
  suppressAutoPause = true;
  syncPauseUi();

  if (pendingLines.length > 0) {
    lineStore.push(...pendingLines);
    pendingLines = [];
    evictOverflowLines();
    renderInvalidated = true;
    renderViewport();
  } else if (renderInvalidated) {
    renderViewport();
  }

  snapOutputToBottom();
  renderInvalidated = true;
  scheduleFrame();
  releaseAutoPauseSuppression();
}

function setOutputPaused(paused) {
  if (isOutputPaused === paused) {
    if (!paused) {
      resumeOutputLive();
    }
    return;
  }
  isOutputPaused = paused;

  if (paused) {
    isScrollLocked = true;
    syncPauseUi();
    return;
  }

  resumeOutputLive();
}

function getPresetLimit(preset) {
  return OUTPUT_SCROLLBACK_PRESETS[preset] || OUTPUT_SCROLLBACK_PRESETS[DEFAULT_OUTPUT_SCROLLBACK_PRESET];
}

function isAtBottom() {
  return (dom.output.scrollHeight - dom.output.scrollTop - dom.output.clientHeight) < BOTTOM_THRESHOLD_PX;
}

function getLineHeight(line) {
  return line.height || estimatedLineHeight;
}

function markAllLineHeightsDirty() {
  for (const line of lineStore) {
    line.height = 0;
  }
}

function createLine(text, cssClass, fragments) {
  return {
    id: nextLineId++,
    cssClass: cssClass || '',
    fragments,
    text,
    height: 0,
  };
}

function buildLinesFromFragments(fragments, cssClass) {
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

  return lines.map((lineFrags) => createLine(
    lineFrags.map((frag) => frag.text).join(''),
    cssClass,
    lineFrags
  ));
}

function buildSingleTextLine(text, cssClass) {
  return createLine(text, cssClass, [{ text, style: {} }]);
}

function createLineElement(line) {
  const div = document.createElement('div');
  div.className = 'output-line' + (line.cssClass ? ' ' + line.cssClass : '');
  div.setAttribute('data-line-id', String(line.id));

  if (line.fragments.length === 0 || line.text === '') {
    div.appendChild(document.createTextNode('\u200B'));
    return div;
  }

  for (const frag of line.fragments) {
    const el = styleToElement(frag.text, frag.style);
    if (el) div.appendChild(el);
  }

  return div;
}

function scheduleFrame() {
  if (frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(flushAndRender);
}

function invalidateRender() {
  renderInvalidated = true;
  scheduleFrame();
}

function evictOverflowLines() {
  if (lineStore.length <= scrollbackLimit) return 0;

  const removeCount = lineStore.length - scrollbackLimit;
  let removedHeight = 0;
  for (let i = 0; i < removeCount; i++) {
    removedHeight += getLineHeight(lineStore[i]);
  }

  lineStore = lineStore.slice(removeCount);
  return removedHeight;
}

function getPrefixHeights() {
  const prefix = new Array(lineStore.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < lineStore.length; i++) {
    prefix[i + 1] = prefix[i] + getLineHeight(lineStore[i]);
  }
  return prefix;
}

function findStartIndex(prefix, scrollTop) {
  let low = 0;
  let high = lineStore.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefix[mid + 1] <= scrollTop) low = mid + 1;
    else high = mid;
  }

  return Math.min(low, Math.max(0, lineStore.length - 1));
}

function findEndIndex(prefix, endOffset, startIndex) {
  let endIndex = startIndex;
  while (endIndex < lineStore.length && prefix[endIndex] < endOffset) {
    endIndex++;
  }
  return Math.max(endIndex, startIndex + 1);
}

function measureEstimatedLineHeight() {
  if (!viewportEl) return;

  const probe = document.createElement('div');
  probe.className = 'output-line';
  probe.style.visibility = 'hidden';
  probe.textContent = 'M';
  viewportEl.appendChild(probe);

  const measured = probe.getBoundingClientRect().height;
  probe.remove();

  if (measured > 0) {
    estimatedLineHeight = measured;
  }
}

function renderViewport() {
  if (!topSpacer || !viewportEl || !bottomSpacer) return;

  renderInvalidated = false;

  if (lineStore.length === 0) {
    topSpacer.style.height = '0px';
    bottomSpacer.style.height = '0px';
    viewportEl.textContent = '';
    return;
  }

  const prefix = getPrefixHeights();
  const totalHeight = prefix[prefix.length - 1];
  const scrollTop = dom.output.scrollTop;
  const viewportHeight = dom.output.clientHeight || 0;
  const visibleBottom = scrollTop + viewportHeight;

  const visibleStart = findStartIndex(prefix, scrollTop);
  const visibleEnd = findEndIndex(prefix, visibleBottom, visibleStart);
  const renderStart = Math.max(0, visibleStart - OUTPUT_OVERSCAN_LINES);
  const renderEnd = Math.min(lineStore.length, visibleEnd + OUTPUT_OVERSCAN_LINES);
  const anchorIndex = visibleStart;
  const anchorOffset = scrollTop - prefix[anchorIndex];

  topSpacer.style.height = prefix[renderStart] + 'px';
  bottomSpacer.style.height = Math.max(0, totalHeight - prefix[renderEnd]) + 'px';

  const frag = document.createDocumentFragment();
  const mounted = [];

  for (let i = renderStart; i < renderEnd; i++) {
    const line = lineStore[i];
    const el = createLineElement(line);
    mounted.push([line, el]);
    frag.appendChild(el);
  }

  viewportEl.replaceChildren(frag);

  let heightChanged = false;
  for (const [line, el] of mounted) {
    const measured = Math.ceil(el.getBoundingClientRect().height);
    if (measured > 0 && measured !== line.height) {
      line.height = measured;
      heightChanged = true;
    }
  }

  if (heightChanged) {
    const nextPrefix = getPrefixHeights();
    const anchoredScrollTop = nextPrefix[anchorIndex] + anchorOffset;
    suppressScrollEvents = true;
    dom.output.scrollTop = Math.max(0, anchoredScrollTop);
    suppressScrollEvents = false;
    renderInvalidated = true;
    scheduleFrame();
  }
}

function flushAndRender() {
  frameScheduled = false;

  if (isOutputPaused) {
    if (renderInvalidated) {
      renderViewport();
    }
    return;
  }

  if (pendingLines.length > 0) {
    const shouldStickToBottom = !isScrollLocked || isAtBottom();
    const previousScrollTop = dom.output.scrollTop;

    lineStore.push(...pendingLines);
    pendingLines = [];

    const removedHeight = evictOverflowLines();
    if (removedHeight > 0 && isScrollLocked) {
      suppressScrollEvents = true;
      dom.output.scrollTop = Math.max(0, previousScrollTop - removedHeight);
      suppressScrollEvents = false;
    }

    renderInvalidated = true;
    renderViewport();

    if (shouldStickToBottom) {
      suppressScrollEvents = true;
      dom.output.scrollTop = dom.output.scrollHeight;
      suppressScrollEvents = false;
      isScrollLocked = false;
    }
  } else if (renderInvalidated) {
    renderViewport();
  }
}

function queueLines(lines) {
  if (!lines.length) return;
  pendingLines.push(...lines);
  scheduleFrame();
}

export function initOutput() {
  dom.output.textContent = '';
  syncPauseUi();

  topSpacer = document.createElement('div');
  topSpacer.className = 'output-spacer';

  viewportEl = document.createElement('div');
  viewportEl.className = 'output-viewport';

  bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'output-spacer';

  dom.output.appendChild(topSpacer);
  dom.output.appendChild(viewportEl);
  dom.output.appendChild(bottomSpacer);

  measureEstimatedLineHeight();

  dom.output.addEventListener('scroll', function() {
    if (suppressScrollEvents) return;
    const atBottom = isAtBottom();
    isScrollLocked = !atBottom;
    if (atBottom && isOutputPaused) {
      setOutputPaused(false);
      return;
    }
    if (!atBottom && !suppressAutoPause) {
      setOutputPaused(true);
    }
    invalidateRender();
  });

  if (dom.outputPauseBtn) {
    dom.outputPauseBtn.addEventListener('click', function() {
      if (!isOutputPaused) {
        setOutputPaused(true);
        return;
      }

      setOutputPaused(false);
    });
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      measureEstimatedLineHeight();
      markAllLineHeightsDirty();
      invalidateRender();
    });
    resizeObserver.observe(dom.output);
  } else {
    window.addEventListener('resize', function() {
      measureEstimatedLineHeight();
      markAllLineHeightsDirty();
      invalidateRender();
    });
  }
}

export function setOutputScrollbackPreset(preset) {
  scrollbackLimit = getPresetLimit(preset);

  if (lineStore.length > scrollbackLimit) {
    const removedHeight = evictOverflowLines();
    if (removedHeight > 0 && isScrollLocked) {
      suppressScrollEvents = true;
      dom.output.scrollTop = Math.max(0, dom.output.scrollTop - removedHeight);
      suppressScrollEvents = false;
    }
  }

  invalidateRender();
}

export function appendOutput(text, cssClass) {
  const fragments = parseAnsi(text);
  queueLines(highlightManager.applyHighlightsToLines(buildLinesFromFragments(fragments, cssClass)));
}

export function appendSystemMessage(text) {
  queueLines([buildSingleTextLine(text, 'system-line')]);
}

export function appendEcho(text) {
  queueLines([buildSingleTextLine('> ' + text, 'echo-line')]);
}

export function clearOutput() {
  lineStore = [];
  pendingLines = [];
  nextLineId = 1;
  isScrollLocked = false;
  isOutputPaused = false;
  syncPauseUi();

  if (topSpacer) topSpacer.style.height = '0px';
  if (bottomSpacer) bottomSpacer.style.height = '0px';
  if (viewportEl) viewportEl.textContent = '';
  if (dom.output) {
    suppressScrollEvents = true;
    dom.output.scrollTop = 0;
    suppressScrollEvents = false;
  }
}
