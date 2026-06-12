// Pure logic for the Connection Health (lag troubleshooting) feature: sample
// rings, the Core.Ping correlator, summary statistics, and the diagnosis
// matrix that attributes perceived lag to the network, the game server, or
// the player's own device/connection. No DOM, no imports - unit tested in
// test/lag-core.test.mjs.

export const LAG_THRESHOLDS = {
  windowMs: 60000,
  minSamples: 3,
  pingTimeoutMs: 4000,
  // network axis (MUD round-trip)
  rttOkMs: 150,
  rttWarnMs: 400,
  lossOkPct: 5,
  lossWarnPct: 15,
  // server axis (heartbeat drift / load)
  driftAvgOkMs: 50,
  driftAvgWarnMs: 200,
  // Max drift runs hot on healthy servers: the driver's alarm coalescing
  // makes individual beats jitter by several hundred ms. Only multi-second
  // outliers indicate a real stall.
  driftMaxOkMs: 600,
  driftMaxWarnMs: 2000,
  hbPctOk: 90,
  hbPctWarn: 75,
  serverWindowMinS: 10,
  serverPollMissBad: 2,
  // local axis (event-loop drift / browser health)
  localDriftOkMs: 100,
  localDriftBadMs: 500,
  longTaskWarnMsPerMin: 200,
  longTaskBadMsPerMin: 1000,
  bufferedWarnBytes: 16384,
};

// ---------------------------------------------------------------------------
// Sample ring: bounded FIFO. Entries are plain objects supplied by callers;
// by convention {t} is a monotonic timestamp and {gap: true} marks a pause
// (hidden tab, reconnect) so windows and sparklines stay honest.
export function makeRing(capacity) {
  const items = [];
  return {
    push(entry) {
      items.push(entry);
      if (items.length > capacity) items.splice(0, items.length - capacity);
    },
    items() { return items.slice(); },
    last() { return items.length ? items[items.length - 1] : null; },
    size() { return items.length; },
    clear() { items.length = 0; },
  };
}

// ---------------------------------------------------------------------------
// Core.Ping correlator. The server echoes an EMPTY Core.Ping, so only one
// outstanding ping can ever be correlated; a late echo arriving after its
// timeout must not be matched against the next ping (generation counter).
export function makePingCorrelator(options = {}) {
  const timeoutMs = options.timeoutMs || LAG_THRESHOLDS.pingTimeoutMs;
  let outstanding = null;

  return {
    // Returns true if a ping may be sent now (nothing outstanding).
    canSend() { return outstanding === null; },

    // Record a sent ping. Refuses (returns false) while one is outstanding.
    onSend(sentAt) {
      if (outstanding !== null) return false;
      outstanding = { sentAt };
      return true;
    },

    // An echo arrived: returns the RTT in ms, or null if nothing was
    // outstanding (late echo after timeout, unsolicited frame).
    onEcho(at) {
      if (outstanding === null) return null;
      const rtt = at - outstanding.sentAt;
      outstanding = null;
      return rtt >= 0 ? rtt : null;
    },

    // Returns true once when the outstanding ping has timed out (= lost).
    checkTimeout(at) {
      if (outstanding !== null && at - outstanding.sentAt >= timeoutMs) {
        outstanding = null;
        return true;
      }
      return false;
    },

    // Disconnects abandon the outstanding ping without counting a loss.
    abort() { outstanding = null; },

    isOutstanding() { return outstanding !== null; },
  };
}

// ---------------------------------------------------------------------------
// Stats over a ring of {t, rtt|null, gap?} samples. rtt === null means lost.
export function summarizeRtt(samples, nowT, thresholds = LAG_THRESHOLDS) {
  const windowed = samples.filter((s) => !s.gap && nowT - s.t <= thresholds.windowMs);
  const values = windowed.filter((s) => typeof s.rtt === 'number').map((s) => s.rtt).sort((a, b) => a - b);
  const lost = windowed.length - values.length;
  if (windowed.length < thresholds.minSamples) return null;

  const pick = (q) => values.length ? values[Math.min(values.length - 1, Math.floor(q * values.length))] : null;
  return {
    count: windowed.length,
    lost,
    lossPct: Math.round((lost / windowed.length) * 100),
    median: pick(0.5),
    p90: pick(0.9),
    latest: values.length ? windowed.filter((s) => typeof s.rtt === 'number').pop().rtt : null,
  };
}

// Local samples: {t, driftMs, longTaskMs, hidden?}. Hidden-tab samples are
// excluded - background timer throttling is normal, not device trouble.
export function summarizeLocal(samples, nowT, thresholds = LAG_THRESHOLDS) {
  const windowed = samples.filter((s) => !s.gap && !s.hidden && nowT - s.t <= thresholds.windowMs);
  if (!windowed.length) return null;
  const drifts = windowed.map((s) => s.driftMs).sort((a, b) => a - b);
  const driftP90 = drifts[Math.min(drifts.length - 1, Math.floor(0.9 * drifts.length))];
  const longTaskMs = windowed.reduce((sum, s) => sum + (s.longTaskMs || 0), 0);
  return { driftP90, longTaskMsPerMin: longTaskMs, count: windowed.length };
}

// ---------------------------------------------------------------------------
// Diagnosis. inputs:
//   connected: bool         online: bool (navigator.onLine)
//   mud:    summarizeRtt() result or null
//   http:   summarizeRtt() result or null
//   server: latest Darkwind.Lag.Status payload or null
//   serverSupported: bool   serverPollMisses: int (unanswered Lag.Get polls)
//   local:  summarizeLocal() result or null
//   wsStalled: bool   reconnectsRecent: int   bufferedBytes: int
//   sameHost: bool (web host serves the MUD; enables cross-attribution)
export function diagnose(inputs, thresholds = LAG_THRESHOLDS) {
  const t = thresholds;
  const network = { status: 'unknown', reasons: [] };
  const server = { status: 'unknown', reasons: [] };
  const local = { status: 'unknown', reasons: [] };

  // --- local axis ---
  if (inputs.online === false) {
    local.status = 'bad';
    local.reasons.push('Your browser reports it is offline.');
  } else if (inputs.wsStalled) {
    local.status = 'bad';
    local.reasons.push('The game connection has stalled (data stopped flowing).');
  } else if ((inputs.reconnectsRecent || 0) > 0) {
    local.status = 'bad';
    local.reasons.push('Your connection dropped and reconnected recently.');
  } else if (inputs.local) {
    if (inputs.local.driftP90 > t.localDriftBadMs
      || inputs.local.longTaskMsPerMin > t.longTaskBadMsPerMin) {
      local.status = 'bad';
      local.reasons.push('This browser tab is running slowly (heavy page or busy device).');
    } else if (inputs.local.driftP90 > t.localDriftOkMs
      || inputs.local.longTaskMsPerMin > t.longTaskWarnMsPerMin) {
      local.status = 'warn';
      local.reasons.push('This browser tab shows some slowdown.');
    } else if ((inputs.bufferedBytes || 0) > t.bufferedWarnBytes) {
      local.status = 'warn';
      local.reasons.push('Outgoing data is backing up in the connection.');
    } else {
      local.status = 'ok';
    }
  }

  // --- network axis (MUD RTT, cross-checked against HTTP) ---
  if (inputs.mud) {
    if (inputs.mud.median > t.rttWarnMs || inputs.mud.lossPct > t.lossWarnPct) {
      network.status = 'bad';
      if (inputs.mud.median > t.rttWarnMs) network.reasons.push('Game round-trips are very slow (' + inputs.mud.median + 'ms).');
      if (inputs.mud.lossPct > t.lossWarnPct) network.reasons.push(inputs.mud.lossPct + '% of pings went unanswered.');
    } else if (inputs.mud.median > t.rttOkMs || inputs.mud.lossPct > t.lossOkPct) {
      network.status = 'warn';
      network.reasons.push('Game round-trips are elevated (' + inputs.mud.median + 'ms).');
    } else {
      network.status = 'ok';
    }
  }

  // --- server axis ---
  if (!inputs.serverSupported) {
    server.reasons.push('This server does not report health data.');
  } else if ((inputs.serverPollMisses || 0) >= t.serverPollMissBad
    && inputs.mud && inputs.mud.lossPct < t.lossWarnPct) {
    server.status = 'bad';
    server.reasons.push('The server stopped answering health checks while the connection stayed up.');
  } else if (inputs.server) {
    const s = inputs.server;
    if ((s.window_s || 0) < t.serverWindowMinS) {
      server.reasons.push('Server health data is still warming up.');
    } else if (s.hb_drift_avg_ms > t.driftAvgWarnMs || s.hb_drift_max_ms > t.driftMaxWarnMs
      || (s.hb_missed || 0) > 0 || (s.hb_processed_pct ?? 100) < t.hbPctWarn) {
      server.status = 'bad';
      server.reasons.push('The game server is running behind schedule (internal drift '
        + s.hb_drift_avg_ms + 'ms avg, ' + s.hb_drift_max_ms + 'ms max).');
    } else if (s.hb_drift_avg_ms > t.driftAvgOkMs || s.hb_drift_max_ms > t.driftMaxOkMs
      || (s.hb_processed_pct ?? 100) < t.hbPctOk) {
      server.status = 'warn';
      server.reasons.push('The game server shows mild internal slowdown.');
    } else {
      server.status = 'ok';
    }
  }

  // --- cross-attribution (the leading indicators) ---
  // Only meaningful when the web host is the game host.
  if (inputs.sameHost !== false && network.status === 'bad' && inputs.http) {
    const httpBad = inputs.http.median > t.rttWarnMs;
    const httpOk = inputs.http.median <= t.rttOkMs;
    if (httpBad) {
      // Both paths slow: the wire between player and host.
      network.reasons.push('Plain web requests to the host are slow too - the path between you and the server is congested.');
      if (server.status !== 'bad') server.status = server.status === 'unknown' ? 'unknown' : 'ok';
    } else if (httpOk && server.status === 'bad') {
      // Game path slow, web path fine, server admits drift: server's fault.
      network.status = 'warn';
      network.reasons.push('Plain web requests are fast - the slowdown is inside the game server, not your network.');
    } else if (httpOk) {
      network.status = 'warn';
      network.reasons.push('Game traffic is slow but plain web requests are fast - the server may be queueing game traffic.');
    }
  }

  // --- verdict ---
  let verdict = 'ok';
  let headline = 'Everything looks healthy right now.';
  if (!inputs.connected) {
    verdict = 'disconnected';
    headline = 'Not connected to the game.';
  } else if (local.status === 'bad') {
    verdict = 'local';
    headline = 'The problem looks local: ' + local.reasons[0];
  } else if (server.status === 'bad') {
    verdict = 'server';
    headline = 'The game server itself appears to be lagging.';
  } else if (network.status === 'bad') {
    verdict = 'network';
    headline = 'Network latency between you and the server looks high.';
  } else if (network.status === 'warn' || server.status === 'warn' || local.status === 'warn') {
    verdict = 'warn';
    if (network.status === 'warn') headline = 'Mild network slowdown: ' + network.reasons[0];
    else if (server.status === 'warn') headline = 'Mild server slowdown detected.';
    else headline = 'Mild local slowdown: ' + local.reasons[0];
  } else if (network.status === 'unknown' && inputs.connected) {
    verdict = 'unknown';
    headline = 'Collecting samples...';
  }

  return { network, server, local, verdict, headline };
}

// Chip status from the latest mud RTT sample + verdict.
export function chipStatus(rttMs, verdict, thresholds = LAG_THRESHOLDS) {
  if (verdict === 'disconnected' || rttMs === null || rttMs === undefined) return 'off';
  if (verdict === 'local' || verdict === 'server' || verdict === 'network') return 'bad';
  if (rttMs > thresholds.rttWarnMs) return 'bad';
  if (rttMs > thresholds.rttOkMs || verdict === 'warn') return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Sparkline geometry: maps {t, rtt} samples onto a w x h box, splitting the
// polyline at gaps and lost samples. Returns { segments: [[{x,y,rtt}..]..],
// maxRtt }. Pure math so the renderer just joins points.
export function sparklinePoints(samples, nowT, opts = {}) {
  const windowMs = opts.windowMs || LAG_THRESHOLDS.windowMs;
  const w = opts.width || 240;
  const h = opts.height || 48;
  const floorMax = opts.floorMax || 200;

  const windowed = samples.filter((s) => nowT - s.t <= windowMs);
  let maxRtt = floorMax;
  for (const s of windowed) {
    if (typeof s.rtt === 'number' && s.rtt > maxRtt) maxRtt = s.rtt;
  }

  const segments = [];
  let current = [];
  for (const s of windowed) {
    if (s.gap || s.rtt === null || s.rtt === undefined) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    const x = w - ((nowT - s.t) / windowMs) * w;
    const y = h - Math.min(1, s.rtt / maxRtt) * (h - 2) - 1;
    current.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rtt: s.rtt });
  }
  if (current.length) segments.push(current);
  return { segments, maxRtt };
}
