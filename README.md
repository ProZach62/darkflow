# Darkflow

Darkflow is the browser-based WebSocket client for Darkwind. It connects directly to the game server, renders ANSI terminal output, and layers Darkwind-specific GMCP panels, mapping, builder tools, announcements, quests, and media on top of the live MUD session.

## How It Works

The browser's native `WebSocket` API connects directly to the MUD server. Darkflow simply serves the static HTML client; it does **not** proxy WebSocket traffic.

```
Browser  --WebSocket-->  MUD server (e.g. port 4242)
Browser  --HTTP-->       This app (port 3000, serves the client page)
```

## Features

- **ANSI color rendering** -- Parses SGR escape sequences (standard 8-color, bright, and 256-color) into styled HTML using xterm standard palette
- **Partial sequence buffering** -- Handles ANSI escape sequences that span multiple WebSocket messages
- **Command history** -- Up/down arrow navigation through previous commands, persisted across page refreshes via sessionStorage
- **Scroll-lock** -- Auto-scrolls to new output unless you've scrolled up to read history
- **Auto-reconnect** -- Optional exponential backoff reconnection (1s to 30s)
- **Performance** -- Batches DOM updates via `requestAnimationFrame` with `DocumentFragment`; prunes output at 5000 lines
- **GMCP over WebSocket** -- Negotiates GMCP (Generic MUD Communication Protocol) via binary WebSocket frames
- **Dockable panel system** -- Panels dock to left/right sidebars or float freely; drag-and-drop reordering; edge snapping to sidebars/toolbar; state persisted in localStorage
- **Graphical tile map** -- Collaborative mapping system with 32x32 terrain tiles, built incrementally as players explore; server aggregates data from all players via Darkwind.MapData GMCP extension
- **Server-driven GUI windows** -- Modal dialogs and panels rendered from server-sent layouts via Darkwind.Window GMCP extension
- **In-browser IDE** -- Code editor for builders via Darkwind.IDE GMCP extension; syntax highlighting, save/compile feedback with error display
- **Keyboard shortcuts** -- Enter (send), Up/Down (history), Ctrl+L (clear), Escape (clear input), Page Up/Down (scroll)
- **Darkflow terminal theme** -- Dense terminal-first layout with polished Darkwind panel chrome, responsive down to 320px
- **Zero dependencies on the client** -- Native ES modules, no build tools, no frameworks

## Quick Start

Requires [Node.js](https://nodejs.org/) 18+.

### Local Development

```bash
git clone https://github.com/jasona/play.darkwind.ai.git
cd play.darkwind.ai
npm install
npm start
```

Open `http://localhost:3000` in your browser. Enter the MUD host and port (defaults to `darkwind.ai:4242` over WSS) and click **Connect**.

### Docker

```bash
docker build -t darkflow-client .
docker run -p 3000:3000 darkflow-client
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Port the Express server listens on |

## Deploying on Coolify

1. Create a new service in Coolify and point it to this repository
2. Select **Dockerfile** as the build method
3. Coolify will set the `PORT` environment variable automatically
4. Deploy

## Project Structure

```
.
├── server.js                  # Express server (serves static files)
├── public/
│   ├── index.html             # HTML shell
│   ├── version.json           # Client version for update detection
│   ├── assets/
│   │   ├── tiles/             # 32x32 terrain tile images (22 terrain + player)
│   │   └── login-background.jpg
│   ├── css/
│   │   ├── main.css           # Core layout, toolbar, ANSI color classes
│   │   ├── panels.css         # Dock columns, panel widgets, tile map styles
│   │   ├── windows.css        # Server-driven window/modal styles
│   │   └── ide.css            # In-browser code editor styles
│   └── js/
│       ├── app.js             # Entry point, event wiring, init
│       ├── constants.js       # Color tables, limits, keys
│       ├── state.js           # Shared mutable state (ws, DOM refs)
│       ├── gmcp.js            # GMCP event bus, handshake
│       ├── ansi.js            # ANSI parser state machine
│       ├── output.js          # Terminal output with RAF batching
│       ├── connection.js      # WebSocket connect/disconnect/reconnect
│       ├── input.js           # Command input, history, keyboard shortcuts
│       ├── panel-defs.js      # Panel definitions and defaults
│       ├── panel-manager.js   # Panel lifecycle, drag/drop, snapping, GMCP handlers
│       ├── panel-renderers.js # Panel render functions (vitals, room, inventory, etc.)
│       ├── map-data.js        # Room graph model, coordinate tracking, server merge
│       ├── map-renderer.js    # CSS Grid tile map renderer
│       ├── window-manager.js  # Server-driven window rendering
│       ├── completion.js      # Tab-completion GMCP handler and state
│       ├── ide-manager.js     # IDE GMCP handler and lifecycle
│       └── ide-editor.js      # Code editor UI component
├── docs/
│   ├── BLUEPRINT-webclient.md           # Original webclient design spec
│   ├── PLAN-webclient.md                # Implementation planning notes
│   ├── gmcp-darkwind-window.md          # Darkwind.Window GMCP protocol spec
│   ├── gmcp-darkwind-ide.md             # Darkwind.IDE GMCP protocol spec
│   ├── gmcp-darkwind-mapdata.md         # Darkwind.MapData GMCP protocol spec
│   └── gmcp-darkwind-completion.md      # Darkwind.Completion GMCP protocol spec
├── Dockerfile                 # node:22-alpine production image
├── package.json               # Darkflow package metadata; Express as the only dependency
└── CLAUDE.md                  # Claude Code project guidance
```

## GMCP Extensions

The client supports four custom GMCP extensions specific to Darkwind MUD:

| Extension | Version | Description | Documentation |
|-----------|---------|-------------|---------------|
| `Darkwind.Window` | 1 | Server-driven GUI windows (modals, panels, forms) | [docs/gmcp-darkwind-window.md](docs/gmcp-darkwind-window.md) |
| `Darkwind.IDE` | 1 | In-browser code editor for builders | [docs/gmcp-darkwind-ide.md](docs/gmcp-darkwind-ide.md) |
| `Darkwind.MapData` | 1 | Collaborative mapping system | [docs/gmcp-darkwind-mapdata.md](docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.Completion` | 1 | Server-authoritative command and argument tab completion | [docs/gmcp-darkwind-completion.md](docs/gmcp-darkwind-completion.md) |

In addition to standard GMCP packages: `Char 1`, `Char.Vitals 1`, `Char.Items 1`, `Room 1`, `Comm 1`, `Group 1`, `Game 1`.

## Architecture Notes

- Darkflow uses **native ES modules** with no build step, no frontend framework, and no client-side dependencies.
- The Express server exists solely to serve the static files. It has no API routes and does not handle WebSocket connections.
- The ANSI parser is a **persistent state machine** that tracks bold, underline, inverse, foreground, and background state across messages. This handles ANSI escape sequences that may be split across multiple WebSocket frames.
- Output display uses a **requestAnimationFrame batching** strategy: incoming messages are queued and flushed to the DOM in a single operation per frame, preventing layout thrashing during rapid output.
- The **mapping system** is collaborative: every player's movement contributes room traversal data to a server-side daemon (`map_d.c`) which resolves coordinates via BFS and pushes complete area maps to all clients. New players get the full explored map immediately on login.
- **Panel snapping** detects proximity to sidebar edges, toolbar, and input bar. Snapped panels reposition automatically when sidebars are toggled or the browser is resized.

## Browser Support

Chrome 90+, Firefox 90+, Safari 15+, Edge 90+ -- all with native WebSocket API support.

## License

[Unlicense](https://unlicense.org/) -- public domain.
