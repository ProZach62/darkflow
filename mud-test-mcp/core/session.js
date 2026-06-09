// MudSession: a headless telnet client for any MUD.
//
// Opens a raw telnet (or TLS) connection to a target the caller specifies
// (host/port/character/password per session), optionally drives a best-effort
// login, then exposes send()/read() with output framing and a live GMCP state
// snapshot. It reuses the same telnet/GMCP parser as the Darkflow web client
// (via core/telnet.js) so byte handling stays identical.
//
// Nothing here is specific to one game: connection details come from the
// caller, and the login prompt patterns are configurable (with broad defaults).
// Env vars (MUD_HOST, MUD_CHARACTER, ...) are only optional fallbacks for
// single-tenant/local convenience.

import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

import { makeTelnetParser, wrapGmcp, constants } from './telnet.js';
import { awaitSettled, awaitMatch, DEFAULT_QUIET_MS, DEFAULT_TIMEOUT_MS } from './framing.js';

const { IAC, DO, TELOPT_GMCP } = constants;

// Broad defaults that match common DikuMUD/LP/Mudlib login prompts. Override per
// session (namePrompt/passwordPrompt) or via MUD_NAME_PROMPT/MUD_PASSWORD_PROMPT.
const DEFAULT_NAME_PROMPT = /(by what name|what is your name|what name|enter.*name|character name|your name|account|^\s*name\s*:|^\s*login\s*:)/im;
const DEFAULT_PASSWORD_PROMPT = /(password|passphrase|pass\s*:)/i;

// Standard GMCP packages most MUDs understand. Advertising extras a MUD does not
// support is harmless (they are ignored), but we keep this generic rather than
// listing one game's custom packages.
const SUPPORTS = [
  'Char 1', 'Char.Vitals 1', 'Char.Status 1', 'Char.StatusVars 1',
  'Room 1', 'Room.Info 1', 'Comm 1', 'Comm.Channel 1', 'Group 1', 'Game 1',
];

// Strip ANSI SGR / CSI escape sequences and normalize line endings to \n.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
export function stripAnsi(s) {
  return s.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toPattern(p) {
  if (!p) return null;
  if (p instanceof RegExp) return p;
  // A string from env/args is treated as a case-insensitive regex source.
  try { return new RegExp(p, 'i'); } catch { return null; }
}

// Parse a GMCP frame "Package.Name {json}" into { package, data }.
function parseGmcpFrame(buf) {
  const s = buf.toString('utf8');
  const sp = s.indexOf(' ');
  const pkg = (sp === -1 ? s : s.slice(0, sp)).trim();
  let data = null;
  if (sp !== -1) {
    const rest = s.slice(sp + 1).trim();
    if (rest) {
      try { data = JSON.parse(rest); } catch { data = rest; }
    }
  }
  return { package: pkg, data };
}

function debugLog(...args) {
  if (process.env.MUD_DEBUG) console.error('[mud-mcp]', ...args);
}

export class MudSession extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = opts.host || process.env.MUD_HOST || '';
    this.port = parseInt(opts.port || process.env.MUD_PORT, 10) || 4242;
    this.tls = opts.tls ?? (process.env.MUD_TLS === '1');
    // accept either `character` or `username`
    this.character = opts.character ?? opts.username
      ?? process.env.MUD_CHARACTER ?? process.env.MUD_TEST_CHAR ?? '';
    this.password = opts.password
      ?? process.env.MUD_PASSWORD ?? process.env.MUD_TEST_PASS ?? '';
    // A client name of "Mudlet" makes some MUDs append IAC GA after each prompt
    // (a clean settle signal). Harmless elsewhere; configurable.
    this.clientName = opts.clientName || process.env.MUD_CLIENT_NAME || 'Mudlet';
    this.charSelection = String(opts.selection || process.env.MUD_CHAR_SELECTION || '1');
    this.namePrompt = toPattern(opts.namePrompt || process.env.MUD_NAME_PROMPT) || DEFAULT_NAME_PROMPT;
    this.passwordPrompt = toPattern(opts.passwordPrompt || process.env.MUD_PASSWORD_PROMPT) || DEFAULT_PASSWORD_PROMPT;
    this.quietMs = parseInt(opts.quietMs || process.env.MUD_QUIET_MS, 10) || DEFAULT_QUIET_MS;
    this.timeoutMs = parseInt(opts.timeoutMs || process.env.MUD_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

    this.connected = false;
    this.loggedIn = false;
    this.banner = '';

    this.rawText = '';
    this.consumedTextLen = 0;
    this.gmcpLog = [];
    this.consumedGmcpLen = 0;
    this.gmcpState = {};

    this._decoder = new TextDecoder('utf-8');
    this._sawGAInChunk = false;
    this._lastError = null;
    // Always keep an error listener so an idle-connection error never becomes an
    // unhandled 'error' throw; framing helpers add their own.
    this.on('error', (err) => { this._lastError = err; });

    this.parser = makeTelnetParser({
      onGmcpAgreed: () => this._onGmcpAgreed(),
      onGoAhead: () => { this._sawGAInChunk = true; },
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (!this.host) return reject(new Error('no host: pass host (and port) to mud_connect or set MUD_HOST'));
      let settled = false;
      const onReady = () => {
        this.connected = true;
        debugLog(`connected to ${this.host}:${this.port}`);
        try { this.socket.write(Buffer.from([IAC, DO, TELOPT_GMCP])); } catch { /* ignore */ }
        settled = true;
        resolve();
      };

      try {
        this.socket = this.tls
          ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false, servername: this.host })
          : net.connect({ host: this.host, port: this.port });
      } catch (err) {
        return reject(err);
      }

      this.socket.once(this.tls ? 'secureConnect' : 'connect', onReady);
      this.socket.on('data', (chunk) => this._onData(chunk));
      this.socket.on('error', (err) => {
        if (!settled) { settled = true; return reject(err); }
        this.emit('error', err);
      });
      this.socket.on('close', () => {
        this.connected = false;
        this.emit('close');
      });
    });
  }

  _onData(chunk) {
    this._sawGAInChunk = false;
    const { text, reply, gmcpFrames } = this.parser.parse(chunk);

    if (reply && this.socket && !this.socket.destroyed) {
      try { this.socket.write(reply); } catch { /* ignore */ }
    }

    let activity = false;
    if (text.length) {
      this.rawText += this._decoder.decode(text, { stream: true });
      activity = true;
    }
    for (const frame of gmcpFrames) {
      const parsed = parseGmcpFrame(frame);
      this.gmcpLog.push({ ...parsed, ts: Date.now() });
      this.gmcpState[parsed.package] = parsed.data;
      activity = true;
    }

    if (activity) this.emit('activity');
    // Emit GA only after this chunk's text/GMCP is buffered.
    if (this._sawGAInChunk) this.emit('goahead');
  }

  _onGmcpAgreed() {
    debugLog('GMCP agreed; sending Core.Hello + Core.Supports.Set');
    this.sendGmcp('Core.Hello', { client: this.clientName, version: '0.1.0' });
    this.sendGmcp('Core.Supports.Set', SUPPORTS);
  }

  sendGmcp(pkg, data) {
    if (!this.socket || this.socket.destroyed) return;
    const payload = data !== undefined ? `${pkg} ${JSON.stringify(data)}` : pkg;
    try { this.socket.write(wrapGmcp(Buffer.from(payload, 'utf8'))); } catch { /* ignore */ }
  }

  write(line) {
    if (!this.socket || this.socket.destroyed) throw new Error('not connected');
    const out = String(line).replace(/\r?\n$/, '') + '\r\n';
    this.socket.write(Buffer.from(out, 'utf8'));
  }

  // Text accumulated since byte offset `from` (ANSI-stripped).
  _textSince(from) {
    return stripAnsi(this.rawText.slice(from));
  }

  // Everything received so far, ANSI-stripped.
  transcript() {
    return stripAnsi(this.rawText);
  }

  // Wait until text since `from` matches `pattern` (RegExp or substring).
  waitFor(pattern, { from = this.rawText.length, timeoutMs = 8000 } = {}) {
    const test = pattern instanceof RegExp
      ? (t) => pattern.test(t)
      : (t) => t.toLowerCase().includes(String(pattern).toLowerCase());
    return awaitMatch(this, () => this._textSince(from), test, { timeoutMs });
  }

  // Connect-only: capture the opening banner and consume it. Used when no
  // credentials are supplied (the caller will drive login via send()).
  async greet({ quietMs, timeoutMs } = {}) {
    const settledBy = await awaitSettled(this, {
      quietMs: quietMs ?? this.quietMs,
      timeoutMs: timeoutMs ?? this.timeoutMs,
    }).catch(() => 'timeout');
    this.banner = this.transcript();
    this.consumedTextLen = this.rawText.length;
    this.consumedGmcpLen = this.gmcpLog.length;
    return { banner: this.banner, room: this.gmcpState['Room.Info'] || null, settledBy, loggedIn: false };
  }

  async login({ character = this.character, password = this.password } = {}) {
    if (!this.connected) throw new Error('connect() before login()');
    if (!character || !password) throw new Error('login requires a character/username and password');

    await this.waitFor(this.namePrompt, { from: 0, timeoutMs: 10000 });
    this.write(character);

    await this.waitFor(this.passwordPrompt, { timeoutMs: 10000 });
    this.write(password);

    // After the password the server either drops us in-game (prompt + maybe IAC
    // GA), shows a character-selection screen, or rejects the login.
    const markAfterPassword = this.rawText.length;
    let settledBy = await awaitSettled(this, { quietMs: Math.max(this.quietMs, 400), timeoutMs: 10000 });
    const postLogin = this._textSince(markAfterPassword);

    if (/incorrect|invalid|wrong password|no match|too many|try again|denied|not a valid/i.test(postLogin)) {
      throw new Error(`login failed for "${character}": ${postLogin.trim().slice(0, 200)}`);
    }

    // Best-effort: many mudlibs show a numbered character-selection screen.
    if (/player selection|enter either|which character|select .*character|^\s*\[\d+\]/im.test(postLogin)) {
      debugLog('character selection screen; selecting', this.charSelection);
      this.write(this.charSelection);
      settledBy = await awaitSettled(this, { quietMs: Math.max(this.quietMs, 400), timeoutMs: 10000 });
    }

    this.loggedIn = true;
    this.banner = this.transcript();
    this.consumedTextLen = this.rawText.length;
    this.consumedGmcpLen = this.gmcpLog.length;
    debugLog(`logged in as ${character} (settledBy=${settledBy})`);
    return { banner: this.banner, room: this.gmcpState['Room.Info'] || null, settledBy, loggedIn: true };
  }

  _drain(settledBy) {
    const raw = this.rawText.slice(this.consumedTextLen);
    const gmcp = this.gmcpLog.slice(this.consumedGmcpLen).map((g) => ({ package: g.package, data: g.data }));
    this.consumedTextLen = this.rawText.length;
    this.consumedGmcpLen = this.gmcpLog.length;
    return { text: stripAnsi(raw), raw, gmcp, settledBy };
  }

  async send(command, { quietMs, timeoutMs } = {}) {
    if (!this.connected) throw new Error('not connected');
    this.write(command);
    const settledBy = await awaitSettled(this, {
      quietMs: quietMs ?? this.quietMs,
      timeoutMs: timeoutMs ?? this.timeoutMs,
    });
    return this._drain(settledBy);
  }

  // Drain any unconsumed (typically async) output. If nothing is pending, wait
  // briefly for a push to arrive.
  async read({ waitMs = 600 } = {}) {
    const hasPending = this.consumedTextLen < this.rawText.length
      || this.consumedGmcpLen < this.gmcpLog.length;
    if (!hasPending) {
      await awaitSettled(this, { quietMs: 150, timeoutMs: waitMs }).catch(() => {});
    }
    return this._drain('read');
  }

  state(pkg) {
    if (pkg) return this.gmcpState[pkg] ?? null;
    return { ...this.gmcpState };
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.end(); } catch { /* ignore */ }
    }
  }
}
