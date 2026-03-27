# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web-based WebSocket client for an LDMud MUD game server (play.darkwind.ai). The client connects to the MUD via WebSocket using the browser-native `WebSocket` API.

## Architecture

- **Single self-contained HTML file** — no build tools, no frameworks, no dependencies
- Vanilla JavaScript with embedded CSS
- The LDMud driver auto-detects WebSocket connections on the same port as telnet (no separate WS port)
- Text frames carry commands (client->server) and game output (server->client) as plain UTF-8 strings
- ANSI SGR escape sequences in output must be parsed and rendered as styled HTML spans
- See `BLUEPRINT-webclient.md` for the full design specification

## Key Design Constraints

- The driver source is at `/home/jasona/code/ldmud/` — WebSocket implementation in `src/pkg-websocket.c`
- No telnet negotiation over WebSocket (no IAC, NAWS, GMCP, MCCP)
- Must handle partial ANSI sequences spanning message boundaries
- Batch DOM updates via requestAnimationFrame to handle rapid server messages
- Target browsers: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
