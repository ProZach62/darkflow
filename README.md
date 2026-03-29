# Darkwind MUD Web Client

A browser-based WebSocket client for connecting to the [Darkwind](https://darkwind.ai) MUD game server, powered by [LDMud](http://www.ldmud.eu/) with native WebSocket support (RFC 6455).

## How It Works

The LDMud driver auto-detects WebSocket connections on the same port used for telnet -- no separate WebSocket port is needed. The browser's native `WebSocket` API connects directly to the MUD server. This web app simply serves the static HTML client; it does **not** proxy WebSocket traffic.

```
Browser  ──WebSocket──>  LDMud (port 4242)
Browser  ──HTTP──>       This app (port 3000, serves the client page)
```

## Features

- **ANSI color rendering** -- Parses SGR escape sequences (standard 8-color, bright, and 256-color) into styled HTML
- **Partial sequence buffering** -- Handles ANSI escape sequences that span multiple WebSocket messages
- **Command history** -- Up/down arrow navigation through previous commands, persisted across page refreshes via sessionStorage
- **Scroll-lock** -- Auto-scrolls to new output unless you've scrolled up to read history
- **Auto-reconnect** -- Optional exponential backoff reconnection (1s to 30s)
- **Performance** -- Batches DOM updates via `requestAnimationFrame` with `DocumentFragment`; prunes output at 5000 lines
- **GMCP over WebSocket** -- Negotiates GMCP (Generic MUD Communication Protocol) via binary WebSocket frames; dockable GUI panels for vitals, stats, room info, inventory, combat, group, and chat
- **Dockable panel system** -- Panels dock to left/right sidebars or float freely; drag-and-drop reordering; state persisted in localStorage
- **Keyboard shortcuts** -- Enter (send), Up/Down (history), Ctrl+L (clear), Escape (clear input), Page Up/Down (scroll)
- **Dark terminal theme** -- Monospace font, dark background, responsive down to 320px
- **Zero dependencies on the client** -- Native ES modules, no build tools, no frameworks

## Quick Start

### Local Development

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser. Enter the MUD host and port (default: current hostname, port 4242) and click **Connect**.

### Docker

```bash
docker build -t darkwind-webclient .
docker run -p 3000:3000 darkwind-webclient
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
├── server.js              # Express server (serves static files from public/)
├── public/
│   ├── index.html         # HTML shell (~50 lines)
│   ├── css/
│   │   ├── main.css       # Core layout, toolbar, ANSI color classes
│   │   └── panels.css     # Dock columns, panel widgets, panel-specific styles
│   └── js/
│       ├── app.js         # Entry point, event wiring, init
│       ├── constants.js   # Color tables, limits, keys
│       ├── state.js       # Shared mutable state (ws, DOM refs)
│       ├── gmcp.js        # GMCP event bus, handshake
│       ├── ansi.js        # ANSI parser state machine
│       ├── output.js      # Terminal output with RAF batching
│       ├── connection.js  # WebSocket connect/disconnect/reconnect
│       ├── input.js       # Command input, history, keyboard shortcuts
│       ├── panel-defs.js  # Panel definitions
│       ├── panel-manager.js   # Panel lifecycle, drag/drop, GMCP handlers
│       └── panel-renderers.js # 9 panel render functions
├── Dockerfile             # node:22-alpine production image
├── package.json           # Express as the only dependency
└── docs/
    └── PLAN-webclient.md
```

## Architecture Notes

- The webclient uses **native ES modules** with no build step, no frontend framework, and no client-side dependencies.
- The Express server exists solely to serve the static file. It has no API routes and does not handle WebSocket connections.
- The ANSI parser is a **persistent state machine** that tracks bold, underline, inverse, foreground, and background state across messages. This is necessary because the MUD server may split ANSI escape sequences across multiple WebSocket frames.
- Output display uses a **requestAnimationFrame batching** strategy: incoming messages are queued and flushed to the DOM in a single operation per frame, preventing layout thrashing during rapid output (e.g., combat spam).

## Browser Support

Chrome 90+, Firefox 90+, Safari 15+, Edge 90+ -- all with native WebSocket API support.

## License

[Unlicense](https://unlicense.org/) -- public domain.
