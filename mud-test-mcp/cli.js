#!/usr/bin/env node
// Thin CLI over the MudSession/script core. Shares the exact same code path as
// the MCP server, so it doubles as a manual smoke test and a CI regression
// runner. The MCP server is for an LLM; this is for a human or a pipeline.
//
//   node cli.js send "look"                 connect, log in, run one command
//   node cli.js state [Package]             print the GMCP state snapshot
//   node cli.js run path/to/script.yaml     run one scripted sequence (json or yaml)
//   node cli.js run path/to/dir/            run every .yaml/.yml/.json script in a directory
//
// Target the MUD with flags (they override .env), e.g.:
//   node cli.js send "look" --host mud.example.com --port 5000 --user bob --password pw
//   node cli.js run smoke.yaml --host 127.0.0.1 --port 4242 --tls
// Connection flags: --host --port --user/--character --password --tls
//                   --name-prompt --password-prompt
// Anything not a flag is positional (the command / package / script path).
//
// Exit code is non-zero when a scripted run has any failing step.
import fs from 'node:fs';
import path from 'node:path';

import { loadEnv } from './core/config.js';
import { MudSession } from './core/session.js';
import { runScript } from './core/script.js';

loadEnv();

// Pull --flag [value] / --flag=value connection options out of argv, leaving the
// positional args (command, package, script path) behind.
function parseArgs(argv) {
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    let key = arg.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
    key = key.toLowerCase();
    if (key === 'tls') {
      opts.tls = val === undefined ? true : !/^(0|false|no|off)$/i.test(val);
      continue;
    }
    if (val === undefined) val = argv[++i];
    switch (key) {
      case 'host': opts.host = val; break;
      case 'port': opts.port = parseInt(val, 10); break;
      case 'character': case 'char': case 'user': case 'username': opts.character = val; break;
      case 'password': case 'pass': opts.password = val; break;
      case 'name-prompt': case 'nameprompt': opts.namePrompt = val; break;
      case 'password-prompt': case 'passwordprompt': opts.passwordPrompt = val; break;
      default: console.error(`(ignoring unknown flag --${key})`); break;
    }
  }
  return { positionals, opts };
}

async function loadScriptFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return JSON.parse(raw);
  const { parse } = await import('yaml');
  return parse(raw);
}

// Test-script files (.yaml/.yml/.json) directly inside `dir`, sorted. Non-script
// files (README.md, etc.) are skipped; not recursive.
function listScriptFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /\.(ya?ml|json)$/i.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

// Run one script file in its own fresh session; print the per-step report and
// return whether it passed.
async function runScriptFile(file, opts) {
  const script = await loadScriptFile(file);
  const report = await withSession(opts, (session) => runScript(session, script, { stopOnFail: false }));
  for (const r of report.results) printStepResult(r);
  console.log(`${report.passed ? 'PASSED' : 'FAILED'}: ${report.run - report.failed}/${report.run} steps passed.`);
  return report.passed;
}

async function withSession(opts, fn) {
  const session = new MudSession(opts);
  if (!session.host) {
    throw new Error('no host: pass --host (and --port) or set MUD_HOST in .env');
  }
  if (!session.character || !session.password) {
    throw new Error('no credentials: pass --user and --password, or set MUD_CHARACTER/MUD_PASSWORD in .env');
  }
  await session.connect();
  const login = await session.login();
  try {
    return await fn(session, login);
  } finally {
    session.close();
  }
}

function printStepResult(r) {
  const status = r.pass ? 'PASS' : 'FAIL';
  const head = [`[${status}]`, `#${r.index}`, r.kind, r.command ? `"${r.command}"` : (r.package || '')]
    .filter(Boolean).join(' ');
  console.log(head + (r.label ? `  (${r.label})` : '') + (r.settledBy ? `  <${r.settledBy}>` : ''));
  if (!r.pass) {
    for (const f of r.failures) console.log(`    - ${f}`);
    if (r.output) console.log('    output:\n' + r.output.split('\n').map((l) => '      ' + l).join('\n'));
  }
}

async function main() {
  const { positionals, opts } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positionals;

  if (cmd === 'send') {
    const command = rest.join(' ');
    if (!command) throw new Error('usage: cli.js send "<command>" [--host H --port P --user U --password PW]');
    await withSession(opts, async (session) => {
      const out = await session.send(command);
      console.log(out.text);
      console.error(`\n[settledBy=${out.settledBy}, gmcp frames=${out.gmcp.length}]`);
    });
    return;
  }

  if (cmd === 'state') {
    const pkg = rest[0];
    await withSession(opts, async (session) => {
      // give async GMCP a moment after login
      await session.read({ waitMs: 400 });
      console.log(JSON.stringify(session.state(pkg), null, 2));
    });
    return;
  }

  if (cmd === 'run') {
    const target = rest[0];
    if (!target) throw new Error('usage: cli.js run <script.yaml|script.json|directory> [--host H --port P --user U --password PW]');

    if (!fs.statSync(target).isDirectory()) {
      // Single script.
      const passed = await runScriptFile(target, opts);
      process.exitCode = passed ? 0 : 1;
      return;
    }

    // Directory: run every .yaml/.yml/.json script in it, each in its own session.
    const files = listScriptFiles(target);
    if (files.length === 0) {
      console.error(`No .yaml/.yml/.json test scripts found in ${target}`);
      process.exitCode = 2;
      return;
    }
    let passedCount = 0;
    for (const file of files) {
      console.log(`\n=== ${path.relative(process.cwd(), file) || file} ===`);
      try {
        if (await runScriptFile(file, opts)) passedCount++;
      } catch (err) {
        // One script erroring (e.g. connect/login failure) shouldn't stop the rest.
        console.log(`[ERROR] ${err.message}`);
      }
    }
    console.log(`\n==== ${passedCount}/${files.length} scripts passed ====`);
    process.exitCode = passedCount === files.length ? 0 : 1;
    return;
  }

  console.error('usage: cli.js <send|state|run> ... [--host H --port P --user U --password PW --tls]');
  process.exitCode = 2;
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exitCode = 1;
});
