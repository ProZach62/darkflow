// Script runner: execute a list of steps against a MudSession and report
// per-step pass/fail. A step is one command (or GMCP/read/wait) plus
// expectations, modeling either a success path or a graceful-failure path.
//
// Step shapes:
//   { send: "get sword", expect_contains: [...], expect_not_contains: [...], expect_regex: "..." }
//   { gmcp: "Room.Info", expect_equals: { name: "Temple Square" }, expect_contains: [...] }
//   { read: true, expect_contains: [...] }     // drain async output
//   { wait_ms: 500 }                            // pause
// Common optional fields: label, quiet_ms, timeout_ms.

const MAX_OUTPUT = 1500;

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function truncate(s) {
  if (typeof s !== 'string') s = String(s);
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n... [${s.length - MAX_OUTPUT} more chars]` : s;
}

// Text-based expectations shared by send/gmcp/read steps.
function checkText(text, step) {
  const failures = [];
  for (const sub of asArray(step.expect_contains)) {
    if (!text.includes(sub)) failures.push(`expected to contain ${JSON.stringify(sub)}`);
  }
  for (const sub of asArray(step.expect_not_contains)) {
    if (text.includes(sub)) failures.push(`expected NOT to contain ${JSON.stringify(sub)}`);
  }
  for (const re of asArray(step.expect_regex)) {
    let rx;
    try { rx = new RegExp(re, 'i'); } catch (err) {
      failures.push(`invalid regex ${JSON.stringify(re)}: ${err.message}`);
      continue;
    }
    if (!rx.test(text)) failures.push(`expected to match /${re}/i`);
  }
  return failures;
}

// Recursive subset match: every key in `expected` must equal `actual`'s value.
function subsetMatch(actual, expected, path = '') {
  const failures = [];
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (actual == null || typeof actual !== 'object') {
      failures.push(`${path || 'value'}: expected object, got ${JSON.stringify(actual)}`);
      return failures;
    }
    for (const key of Object.keys(expected)) {
      failures.push(...subsetMatch(actual[key], expected[key], path ? `${path}.${key}` : key));
    }
  } else if (actual !== expected) {
    failures.push(`${path || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return failures;
}

async function runStep(session, step, index) {
  const base = { index, label: step.label || null };

  if (step.wait_ms != null || step.sleep != null) {
    const ms = step.wait_ms ?? step.sleep;
    await new Promise((r) => setTimeout(r, ms));
    return { ...base, kind: 'wait', pass: true, failures: [], output: `waited ${ms}ms` };
  }

  if (step.gmcp) {
    const data = session.state(step.gmcp);
    const failures = [];
    if (data == null) {
      failures.push(`no GMCP data received for package "${step.gmcp}"`);
    } else {
      if (step.expect_equals) failures.push(...subsetMatch(data, step.expect_equals));
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      failures.push(...checkText(text, step));
    }
    return { ...base, kind: 'gmcp', package: step.gmcp, data, pass: failures.length === 0, failures, output: truncate(JSON.stringify(data)) };
  }

  if (step.read) {
    const out = await session.read({ waitMs: step.wait_ms });
    const failures = checkText(out.text, step);
    return { ...base, kind: 'read', pass: failures.length === 0, failures, output: truncate(out.text) };
  }

  if (step.send != null) {
    const out = await session.send(step.send, { quietMs: step.quiet_ms, timeoutMs: step.timeout_ms });
    const failures = checkText(out.text, step);
    return { ...base, kind: 'send', command: step.send, settledBy: out.settledBy, pass: failures.length === 0, failures, output: truncate(out.text) };
  }

  return { ...base, kind: 'unknown', pass: false, failures: ['step has no send/gmcp/read/wait_ms'], output: JSON.stringify(step) };
}

export async function runScript(session, script, { stopOnFail = false } = {}) {
  const steps = Array.isArray(script) ? script : (script && script.steps) || [];
  const results = [];
  let passed = true;
  for (let i = 0; i < steps.length; i++) {
    const res = await runStep(session, steps[i], i);
    results.push(res);
    if (!res.pass) {
      passed = false;
      if (stopOnFail) break;
    }
  }
  return { passed, total: steps.length, run: results.length, failed: results.filter((r) => !r.pass).length, results };
}
