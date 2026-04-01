# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web-based WebSocket client for an LDMud MUD game server (play.darkwind.ai). The client connects to the MUD via WebSocket using the browser-native `WebSocket` API. It supports GMCP over binary WebSocket frames for structured data (panels, mapping, IDE, server-driven windows).

## Architecture

- **Modular vanilla JS** -- native ES modules, no build tools, no frameworks, no client-side dependencies
- Express server serves static files from `public/`; does not proxy WebSocket traffic
- The LDMud driver auto-detects WebSocket connections on the same port as telnet (no separate WS port)
- Text frames carry commands (client->server) and game output (server->client) as plain UTF-8 strings
- Binary frames carry GMCP messages (bidirectional) for structured data
- ANSI SGR escape sequences in output are parsed and rendered as styled HTML spans
- 32x32 graphical tile map built collaboratively from all players' exploration data

## Key Modules

- `gmcp.js` -- GMCP event bus, handshake, send/receive
- `ansi.js` -- Stateful ANSI parser (handles partial sequences across messages)
- `output.js` -- Terminal output with requestAnimationFrame batching
- `panel-manager.js` -- Panel lifecycle, drag/drop, edge snapping, GMCP data handlers
- `panel-renderers.js` -- Render functions for each panel type
- `map-data.js` -- Room graph model, coordinate tracking, direction detection, server data merge
- `map-renderer.js` -- CSS Grid tile map renderer (32x32 terrain tiles)
- `window-manager.js` -- Server-driven GUI window rendering (Darkwind.Window)
- `ide-manager.js` / `ide-editor.js` -- In-browser code editor (Darkwind.IDE)

## GMCP Extensions

See `docs/` for full protocol specifications:
- `Darkwind.Window 1` -- Server-driven modals, panels, forms
- `Darkwind.IDE 1` -- In-browser LPC code editor for builders
- `Darkwind.MapData 1` -- Collaborative mapping (client sends RoomUpdate, server pushes Area data)

## Server-Side Companion (darkwind-nextgen)

The MUD server codebase is at `../darkwind-nextgen/`. Key server-side files for this client:
- `secure/daemons/telopt_d.c` -- GMCP message sending (Room.Info, MapData.Area, Window, IDE)
- `secure/player/telopt.c` -- GMCP message receiving and dispatch
- `secure/daemons/map_d.c` -- Mapping daemon (stores room graph, resolves coordinates via BFS)
- `secure/include/gmcp_defs.h` -- GMCP package/key constants
- `secure/daemons/vrroom.c` -- Virtual room mapping support (query_map_id, query_map_exit_path)

## Key Design Constraints

- Never use non-ASCII characters in any code files (LPC only supports ASCII, and this has caused server crashes)
- The driver source is at `/home/jasona/code/ldmud/`
- GMCP is delivered via binary WebSocket frames, not telnet subnegotiation
- Must handle partial ANSI sequences spanning message boundaries
- Batch DOM updates via requestAnimationFrame to handle rapid server messages
- Target browsers: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- Tile assets served from `public/assets/tiles/` (22 terrain JPGs + 1 player PNG)
