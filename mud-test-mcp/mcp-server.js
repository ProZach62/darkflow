#!/usr/bin/env node
// Standalone entry point for the Darkflow MCP relay.
//
//   node mcp-server.js            stdio (default) - clients spawn it locally
//   node mcp-server.js --http     Streamable HTTP - listens for remote clients
//
// The tools and the HTTP mount live in core/mcp.js, which is also mounted into
// play.darkwind.ai/server.js so the web client can serve MCP on its own port.
//
// IMPORTANT (stdio mode): stdout is the JSON-RPC stream. All diagnostics go to
// stderr (console.error). Never console.log on stdout in stdio mode.
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadEnv } from './core/config.js';
import { createMcpServer, attachMcp } from './core/mcp.js';

loadEnv();

async function startStdio() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('[darkflow-mcp] ready on stdio');
}

function startHttp() {
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  const port = parseInt(process.env.MCP_HTTP_PORT, 10) || 7423;
  const path = process.env.MCP_PATH || '/mcp';

  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true, transport: 'streamable-http' }));
  const { authenticated } = attachMcp(app, { path });

  app.listen(port, host, () => {
    console.error(`[darkflow-mcp] ready on http://${host}:${port}${path}` +
      (authenticated ? ' (bearer auth on)' : ' (no auth - rely on a hidden MCP_PATH)'));
  });
}

const httpMode = process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http';
try {
  if (httpMode) startHttp();
  else await startStdio();
} catch (err) {
  console.error('[darkflow-mcp] fatal:', err);
  process.exit(1);
}
