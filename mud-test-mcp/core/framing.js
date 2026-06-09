// Output framing: deciding when a command's output is "done".
//
// A MudSession emits these events that this module listens for:
//   'activity' -- any inbound game text or GMCP frame arrived
//   'goahead'  -- the server sent IAC GA (end-of-prompt marker), emitted by the
//                 session *after* the chunk's text/GMCP has been buffered
//   'close' / 'error' -- connection ended
//
// Settle priority: IAC GA (cleanest, once in-game) > quiet debounce after the
// first activity > hard timeout. We never settle 'quiet' before any activity so
// a slow command isn't cut off with empty output; the hard timeout covers the
// no-output / no-GA case.

export const DEFAULT_QUIET_MS = 250;
export const DEFAULT_TIMEOUT_MS = 3000;

export function awaitSettled(session, { quietMs = DEFAULT_QUIET_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let quietTimer = null;
    let hardTimer = null;
    let done = false;

    const cleanup = () => {
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
      session.off('activity', onActivity);
      session.off('goahead', onGoAhead);
      session.off('close', onClose);
      session.off('error', onError);
    };

    const finish = (settledBy) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(settledBy);
    };

    const onActivity = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish('quiet'), quietMs);
    };
    const onGoAhead = () => finish('ga');
    const onClose = () => finish('close');
    const onError = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };

    hardTimer = setTimeout(() => finish('timeout'), timeoutMs);
    session.on('activity', onActivity);
    session.on('goahead', onGoAhead);
    session.once('close', onClose);
    session.once('error', onError);
  });
}

// Resolve once `getText()` satisfies `predicate`, or reject on timeout/close.
// Used by the login sequence to wait for the name/password prompts, which arrive
// before GMCP (and therefore before GA framing) is available.
export function awaitMatch(session, getText, predicate, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let done = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      session.off('activity', check);
      session.off('close', onClose);
      session.off('error', onError);
    };

    const settle = (fn, arg) => {
      if (done) return;
      done = true;
      cleanup();
      fn(arg);
    };

    const check = () => {
      let matched = false;
      try {
        matched = predicate(getText());
      } catch (err) {
        return settle(reject, err);
      }
      if (matched) settle(resolve, getText());
    };
    const onClose = () => settle(reject, new Error('connection closed while waiting for expected output'));
    const onError = (err) => settle(reject, err);

    timer = setTimeout(
      () => settle(reject, new Error(`timed out after ${timeoutMs}ms waiting for expected output`)),
      timeoutMs,
    );
    session.on('activity', check);
    session.once('close', onClose);
    session.once('error', onError);
    // Output may already satisfy the predicate before we subscribed.
    check();
  });
}
