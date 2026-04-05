import { dom } from './state.js';
import { gmcp } from './gmcp.js';
import { appendSystemMessage } from './output.js';

const REQUEST_PACKAGE = 'Darkwind.Completion.Request';
const RESULT_PACKAGE = 'Darkwind.Completion.Result';

let pendingRequest = null;
let lastAmbiguousSignature = null;
let suppressReset = false;

function signatureFor(line, cursor) {
  return line + '\n' + String(cursor);
}

function formatMatches(matches) {
  const maxWidth = matches.reduce(function(width, match) {
    return Math.max(width, match.length);
  }, 0) + 2;
  const columns = Math.max(1, Math.floor(80 / Math.max(maxWidth, 1)));
  const lines = [];

  for (let index = 0; index < matches.length; index += columns) {
    const row = matches.slice(index, index + columns)
      .map(function(match) {
        return match.padEnd(maxWidth, ' ');
      })
      .join('')
      .trimEnd();
    lines.push(row);
  }

  return lines.join('\n');
}

function clearAmbiguousState() {
  lastAmbiguousSignature = null;
}

function applyCompletionResult(data) {
  let nextLine;
  let nextCursor;
  let matches;
  let ambiguous;
  let request;

  if (!pendingRequest) return;

  request = pendingRequest;
  nextLine = data && typeof data.line === 'string' ? data.line : request.line;
  nextCursor = data && typeof data.cursor === 'number' ? data.cursor : request.cursor;
  matches = data && Array.isArray(data.matches) ? data.matches : [];
  ambiguous = Boolean(data && data.ambiguous) && matches.length > 1;

  pendingRequest = null;

  suppressReset = true;
  dom.commandInput.value = nextLine;
  dom.commandInput.setSelectionRange(nextCursor, nextCursor);
  suppressReset = false;

  if (ambiguous) {
    lastAmbiguousSignature = signatureFor(nextLine, nextCursor);
    if (request.repeated) {
      appendSystemMessage(formatMatches(matches));
    }
    return;
  }

  clearAmbiguousState();
}

export function initCompletion() {
  gmcp.on(RESULT_PACKAGE, applyCompletionResult);

  dom.commandInput.addEventListener('input', function() {
    if (suppressReset) return;
    pendingRequest = null;
    clearAmbiguousState();
  });
}

export function resetCompletionState() {
  pendingRequest = null;
  clearAmbiguousState();
}

export function requestCompletion() {
  const line = dom.commandInput.value;
  const cursor = dom.commandInput.selectionStart == null
    ? line.length
    : dom.commandInput.selectionStart;
  const signature = signatureFor(line, cursor);

  pendingRequest = {
    line,
    cursor,
    repeated: signature === lastAmbiguousSignature
  };

  gmcp.send(REQUEST_PACKAGE, { line, cursor });
}