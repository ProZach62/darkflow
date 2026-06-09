// The MCP server: tool definitions (createMcpServer) plus a reusable
// attachMcp(app, opts) that mounts a Streamable HTTP MCP endpoint onto any
// Express app. Used by:
//   - mcp-server.js  (standalone stdio or --http)
//   - play.darkwind.ai/server.js, which mounts it at /mcp so starting the
//     Darkflow web client also serves MCP on the same port.
//
// MUD sessions persist across tool calls in the module-global `sessions` map
// (shared across all MCP sessions/transports), keyed by sessionId.
import { randomUUID } from 'node:crypto';

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { MudSession } from './session.js';
import { runScript } from './script.js';

const sessions = new Map();

function json(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function fail(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`unknown sessionId "${sessionId}" (use mud_connect first; mud_sessions lists active)`);
  return s;
}

// Build a fully-configured MCP server. A fresh instance is created per stdio
// process and per HTTP MCP session; all instances share the module-global MUD
// `sessions` map, so MUD sessions persist regardless of transport.
export function createMcpServer() {
  const server = new McpServer({ name: 'darkflow-mcp', version: '0.1.0' });

  server.registerTool('mud_connect', {
    title: 'Connect to a MUD (and optionally log in)',
    description: 'Open a telnet/TLS session to a MUD you specify, and if a character/username + password are given, attempt a best-effort login. Pass host, port, character (or username), password, tls. If credentials are omitted the session just connects and returns the opening screen so you can log in yourself with mud_send. Returns a sessionId (reuse it for later calls), whether login succeeded, the banner/transcript, and the landing room if the MUD sent one via GMCP. Env vars (MUD_HOST, MUD_CHARACTER, ...) are optional fallbacks for single-tenant setups.',
    inputSchema: {
      host: z.string().optional().describe('Target MUD hostname/IP (or set MUD_HOST)'),
      port: z.number().optional().describe('Target MUD port (default 4242)'),
      character: z.string().optional().describe('Character/account name to log in as'),
      username: z.string().optional().describe('Alias for character'),
      password: z.string().optional().describe('Password for the character'),
      tls: z.boolean().optional().describe('Connect over TLS instead of plain telnet'),
      namePrompt: z.string().optional().describe('Regex for the name prompt, if this MUD differs from the default'),
      passwordPrompt: z.string().optional().describe('Regex for the password prompt, if this MUD differs from the default'),
    },
  }, async (args) => {
    let session;
    try {
      session = new MudSession(args);
      await session.connect();
    } catch (err) {
      return fail(err.message);
    }
    const id = randomUUID();
    sessions.set(id, session);
    session.once('close', () => sessions.delete(id));
    try {
      let result;
      if (session.character && session.password) {
        try {
          result = await session.login();
        } catch (loginErr) {
          // Keep the session open so the caller can finish login via mud_send.
          session.consumedTextLen = session.rawText.length;
          session.consumedGmcpLen = session.gmcpLog.length;
          result = {
            loggedIn: false,
            loginError: loginErr.message,
            note: 'Auto-login did not complete; the session is open - inspect the banner and finish login with mud_send.',
            banner: session.transcript(),
            room: session.state('Room.Info'),
          };
        }
      } else {
        result = await session.greet();
      }
      return json({ sessionId: id, ...result });
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('mud_send', {
    title: 'Send a command',
    description: 'Send one command to the MUD and return the framed output (ANSI-stripped text, raw text, GMCP frames since the send, and how output settled: ga|quiet|timeout).',
    inputSchema: {
      sessionId: z.string(),
      command: z.string(),
      quietMs: z.number().optional().describe('Silence window that counts as settled (default 250)'),
      timeoutMs: z.number().optional().describe('Hard cap on waiting for output (default 3000)'),
    },
  }, async ({ sessionId, command, quietMs, timeoutMs }) => {
    try {
      const out = await getSession(sessionId).send(command, { quietMs, timeoutMs });
      return json(out);
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('mud_read', {
    title: 'Drain async output',
    description: 'Return any unsolicited output that has arrived since the last read/send (combat rounds, channel chatter, timed events). Waits briefly if nothing is pending.',
    inputSchema: {
      sessionId: z.string(),
      waitMs: z.number().optional(),
    },
  }, async ({ sessionId, waitMs }) => {
    try {
      return json(await getSession(sessionId).read({ waitMs }));
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('mud_state', {
    title: 'GMCP state snapshot',
    description: 'Return the latest structured GMCP state for assertions (e.g. Room.Info, Char.Vitals). Pass a package name for just that one, or omit for the whole snapshot.',
    inputSchema: {
      sessionId: z.string(),
      package: z.string().optional(),
    },
  }, async ({ sessionId, package: pkg }) => {
    try {
      return json(getSession(sessionId).state(pkg));
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('mud_run_script', {
    title: 'Run a scripted test sequence',
    description: 'Run an ordered list of steps and return a per-step pass/fail report. Each step is one of: {send, expect_contains[], expect_not_contains[], expect_regex[]} | {gmcp: "Pkg.Name", expect_equals:{}, expect_contains[]} | {read:true, expect_contains[]} | {wait_ms}. Use a success step for the happy path and a graceful-failure step (expect_not_contains a traceback) for the error path. Provide sessionId to reuse a connected session (recommended); or omit to run in a throwaway session against the env default target (MUD_HOST/MUD_CHARACTER/MUD_PASSWORD), for single-tenant setups.',
    inputSchema: {
      sessionId: z.string().optional(),
      steps: z.array(z.record(z.string(), z.any())),
      stopOnFail: z.boolean().optional(),
    },
  }, async ({ sessionId, steps, stopOnFail }) => {
    let ephemeral = null;
    try {
      let session;
      if (sessionId) {
        session = getSession(sessionId);
      } else {
        ephemeral = new MudSession();
        if (!ephemeral.host || !ephemeral.character || !ephemeral.password) return fail('no sessionId and no env default target; pass sessionId from mud_connect, or set MUD_HOST + MUD_CHARACTER + MUD_PASSWORD');
        await ephemeral.connect();
        await ephemeral.login();
        session = ephemeral;
      }
      const report = await runScript(session, { steps }, { stopOnFail: !!stopOnFail });
      return json(report);
    } catch (err) {
      return fail(err.message);
    } finally {
      if (ephemeral) ephemeral.close();
    }
  });

  server.registerTool('mud_disconnect', {
    title: 'Disconnect a session',
    description: 'Close a MUD session and free its sessionId.',
    inputSchema: { sessionId: z.string() },
  }, async ({ sessionId }) => {
    const s = sessions.get(sessionId);
    if (s) { s.close(); sessions.delete(sessionId); }
    return json({ closed: !!s, sessionId });
  });

  server.registerTool('mud_sessions', {
    title: 'List active sessions',
    description: 'List currently open MUD sessions and their logged-in character.',
    inputSchema: {},
  }, async () => {
    const list = [...sessions.entries()].map(([id, s]) => ({
      sessionId: id, character: s.character, host: s.host, port: s.port, loggedIn: s.loggedIn,
    }));
    return json({ count: list.length, sessions: list });
  });

  return server;
}

// Mount a Streamable HTTP MCP endpoint onto an existing Express `app`.
// Works on Express 4 or 5. Returns { path, authenticated }.
//   path  - route to serve MCP on (default '/mcp')
//   token - bearer token; if falsy the endpoint is open (relies on a hidden path)
export function attachMcp(app, { path = '/mcp', token = process.env.MCP_AUTH_TOKEN || '' } = {}) {
  const jsonParser = express.json();

  // Optional bearer auth on the MCP path.
  app.use(path, (req, res, next) => {
    if (!token) return next();
    if ((req.headers['authorization'] || '') === `Bearer ${token}`) return next();
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  });

  // Stateful Streamable HTTP: one transport (and MCP server) per MCP session,
  // keyed by the mcp-session-id header.
  const transports = {};

  app.post(path, jsonParser, async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    let transport;
    if (sid && transports[sid]) {
      transport = transports[sid];
    } else if (!sid && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => { transports[newId] = transport; },
      });
      transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
      await createMcpServer().connect(transport);
    } else {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session ID' }, id: null });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionReq = async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    if (!sid || !transports[sid]) { res.status(400).send('Invalid or missing session ID'); return; }
    await transports[sid].handleRequest(req, res);
  };
  app.get(path, handleSessionReq);     // SSE stream (server -> client)
  app.delete(path, handleSessionReq);  // session termination

  return { path, authenticated: !!token };
}
