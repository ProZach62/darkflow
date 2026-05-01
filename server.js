const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const tls = require('tls');
const { WebSocketServer } = require('ws');

// Load .env file if it exists (no dependency needed)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch(e) { /* no .env file, that's fine */ }

const app = express();
const PORT = process.env.PORT || 3000;

// Serve client configuration from environment variables
app.get('/config.json', (req, res) => {
  res.json({
    host: process.env.MUD_HOST || '',
    port: parseInt(process.env.MUD_PORT, 10) || 4242,
    wss: process.env.MUD_WSS !== '0',
    gameName: process.env.GAME_NAME || '',
  });
});

// Client version endpoint (no caching so stale tabs always get current version)
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const versionFile = path.join(__dirname, 'public', 'version.json');
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    res.json(data);
  } catch(e) {
    res.json({ version: 'unknown' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// /proxy : WebSocket ↔ TCP/TLS bridge for connecting to non-WebSocket MUDs.
//
// Browser opens   ws[s]://<this-server>/proxy?host=X&port=Y&tls=0|1
// We open         net.connect({host, port}) or tls.connect(...)
// and pipe bytes both ways unmodified.
//
// v1: open relay with logging. Future: allowlist (see docs).
// ─────────────────────────────────────────────────────────────────────────────

// Telnet IAC parser. Strips IAC sequences from upstream bytes, replies
// DONT/WONT to all WILL/DO so MUDs don't hang waiting for negotiation, and
// handles partial IAC sequences across chunk boundaries via a per-connection
// pending buffer. SB ... SE subnegotiations are discarded entirely. Returns
// { text: Buffer, reply: Buffer|null }.
const IAC = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB = 0xFA, SE = 0xF0;

function makeTelnetParser() {
  let pending = Buffer.alloc(0);
  return function parse(chunk) {
    const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    pending = Buffer.alloc(0);
    const out = [];
    const reply = [];
    let i = 0;
    while (i < buf.length) {
      const b = buf[i];
      if (b !== IAC) {
        out.push(b);
        i++;
        continue;
      }
      if (i + 1 >= buf.length) { pending = buf.slice(i); break; }
      const cmd = buf[i + 1];
      if (cmd === IAC) {
        out.push(IAC);
        i += 2;
        continue;
      }
      if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
        if (i + 2 >= buf.length) { pending = buf.slice(i); break; }
        const opt = buf[i + 2];
        if (cmd === WILL) reply.push(IAC, DONT, opt);
        else if (cmd === DO) reply.push(IAC, WONT, opt);
        i += 3;
        continue;
      }
      if (cmd === SB) {
        let j = i + 2;
        let end = -1;
        while (j < buf.length - 1) {
          if (buf[j] === IAC && buf[j + 1] === SE) { end = j + 2; break; }
          j++;
        }
        if (end < 0) { pending = buf.slice(i); break; }
        i = end;
        continue;
      }
      // Other 2-byte commands (NOP, GA, etc.): consume both.
      i += 2;
    }
    return {
      text: Buffer.from(out),
      reply: reply.length ? Buffer.from(reply) : null,
    };
  };
}

const LOG_DIR = path.join(__dirname, 'log');
const PROXY_LOG = path.join(LOG_DIR, 'proxy.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(e) { /* ignore */ }

function logProxy(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFile(PROXY_LOG, line, (err) => {
    if (err) console.error('[proxy] log write failed:', err.message);
  });
  // Also echo to stdout so docker/journald captures it.
  console.log('[proxy]', line.trim());
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/proxy' });

wss.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  const host = reqUrl.searchParams.get('host');
  const port = parseInt(reqUrl.searchParams.get('port'), 10);
  const useTls = reqUrl.searchParams.get('tls') === '1';
  const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    logProxy({ event: 'reject', reason: 'invalid-args', sourceIp, host, port });
    try { ws.close(1008, 'invalid host/port'); } catch(e) {}
    return;
  }

  logProxy({ event: 'connect', sourceIp, host, port, tls: useTls });

  const telnetParser = makeTelnetParser();
  let bytesUp = 0, bytesDown = 0;
  let upstream;
  try {
    upstream = useTls
      ? tls.connect({ host, port, rejectUnauthorized: false, servername: host })
      : net.connect({ host, port });
  } catch (err) {
    logProxy({ event: 'upstream-spawn-error', sourceIp, host, port, error: err.message });
    try { ws.close(1011, 'upstream spawn error'); } catch(e) {}
    return;
  }

  upstream.on('connect', () => {
    logProxy({ event: 'upstream-open', sourceIp, host, port, tls: useTls });
  });
  // tls.connect emits 'secureConnect' once TLS handshake completes
  upstream.on('secureConnect', () => {
    logProxy({ event: 'upstream-secure', sourceIp, host, port });
  });
  upstream.on('data', (chunk) => {
    bytesDown += chunk.length;
    const { text, reply } = telnetParser(chunk);
    // Politely decline any IAC negotiation the MUD asked for.
    if (reply && !upstream.destroyed) {
      try { upstream.write(reply); } catch(e) {}
    }
    // Forward game text as a UTF-8 text frame so Darkflow's onmessage routes
    // it to appendOutput() rather than the GMCP dispatcher (which would
    // happen for a binary frame).
    if (text.length && ws.readyState === ws.OPEN) {
      try { ws.send(text.toString('utf-8')); }
      catch (err) {
        logProxy({ event: 'ws-send-error', sourceIp, host, port, error: err.message });
      }
    }
  });
  upstream.on('error', (err) => {
    logProxy({ event: 'upstream-error', sourceIp, host, port, error: err.message });
    try { ws.close(1011, 'upstream error'); } catch(e) {}
  });
  upstream.on('close', () => {
    logProxy({ event: 'upstream-close', sourceIp, host, port, bytesUp, bytesDown });
    if (ws.readyState === ws.OPEN) {
      try { ws.close(1000, 'upstream closed'); } catch(e) {}
    }
  });

  ws.on('message', (data, isBinary) => {
    // ws gives us a Buffer for binary, string for text. Coerce to Buffer for net.
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    bytesUp += buf.length;
    if (!upstream.destroyed) {
      try { upstream.write(buf); }
      catch (err) {
        logProxy({ event: 'upstream-write-error', sourceIp, host, port, error: err.message });
      }
    }
  });
  ws.on('close', () => {
    logProxy({ event: 'client-close', sourceIp, host, port, bytesUp, bytesDown });
    if (!upstream.destroyed) {
      try { upstream.end(); } catch(e) {}
    }
  });
  ws.on('error', (err) => {
    logProxy({ event: 'client-error', sourceIp, host, port, error: err.message });
    if (!upstream.destroyed) {
      try { upstream.destroy(); } catch(e) {}
    }
  });
});

server.listen(PORT, () => {
  console.log(`Darkflow listening on port ${PORT}`);
  console.log(`Proxy endpoint: ws[s]://<host>:${PORT}/proxy?host=X&port=Y&tls=0|1`);
});
