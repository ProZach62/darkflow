# Darkflow

Darkflow is the official browser client for Darkwind. It is a fast, terminal-first WebSocket client with Darkwind-specific panels, mapping, media, builder tools, settings, and GMCP integrations layered around the live MUD session.

The app is intentionally lightweight: Express serves static files, the browser connects directly to the MUD over WebSocket, and the frontend is native ES modules with no build step or client-side framework.

## What Darkflow Supports

- **Direct WebSocket play**: browser-native `WebSocket` connects to the game server; the Node server does not proxy MUD traffic.
- **ANSI terminal rendering**: persistent ANSI parser for SGR colors/styles, split escape sequences, URL links, highlights, Giphy replay controls, scrollback virtualization, pause mode, and split history/live mode.
- **Connection resilience**: client version fetch before connect, auto-reconnect, stalled-socket watchdog, byte counters, diagnostics via `window.wsDebug`, and Ctrl+K full GMCP/media resync.
- **Dockable interface**: left/right sidebars, floating panels, drag/drop ordering, snapping, collapse/close controls, mobile panel sheet, and persisted panel layout.
- **Player panels**: avatar, status, vitals, worth, stats, room, room image, group, inventory, enemy, chat, quests, achievements, and dynamic server-driven panels.
- **Map system**: local movement tracking plus `Darkwind.MapData` sync, area versions, incremental updates, server coordinate corrections, and tile-based rendering.
- **Server-driven windows**: `Darkwind.Window` modals/panels for login and in-game UI, including forms, buttons, updates, submits, actions, and close notifications.
- **Builder IDE**: `Darkwind.IDE` opens files in the browser, supports save/compile feedback, diagnostics, and close notifications.
- **Command ergonomics**: command history, optional history-based Tab completion, server-authoritative completion, aliases, triggers, custom key mappings, and highlight rules.
- **Announcements and media**: announcement inbox with unread state, Giphy popups, avatar media, room imagery, and media refresh support.
- **Portable settings**: settings, aliases, highlights, triggers, and panel layouts can be exported/imported as JSON.
- **Darkflow branding**: app icon, favicons, manifest, About modal, and hidden brand asset page at `/darkflow-brand.html`.
- **LLM test harness (MCP)**: an embedded MCP relay at `/mcp` lets an LLM (Claude Code, Codex) drive the MUD — connect, run commands, assert on output/GMCP, and run scripted pass/fail tests. See [docs/mcp.md](docs/mcp.md).

## How It Works

```
Browser  --WebSocket-->  Darkwind game server, usually darkwind.ai:4242
Browser  --HTTP-->       Darkflow static app, usually localhost:3000
```

Darkflow identifies itself in GMCP as:

```json
{ "client": "Darkflow", "version": "0.9.26" }
```

The custom protocol packages remain `Darkwind.*` for compatibility.

## Quick Start

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/jasona/play.darkwind.ai.git
cd play.darkwind.ai
npm install
npm start
```

Open `http://localhost:3000`. If no host is configured by the server, enter the MUD host and port manually and click **Connect**.

## Configuration

The Express server serves static files and exposes `/config.json` and `/api/version`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for Darkflow |
| `MUD_HOST` | empty | Default host shown in the toolbar; if set, the client auto-connects |
| `MUD_PORT` | `4242` | Default MUD port |
| `MUD_WSS` | enabled | Set to `0` to default to plain `ws://` |
| `GAME_NAME` | empty | Optional game name appended to the browser title |
| `MCP_ENABLED` | `1` | Set to `0` to not mount the MCP relay at `/mcp` |
| `MCP_PATH` | `/mcp` | Route the MCP relay is served on (use a long random path in production) |
| `MCP_AUTH_TOKEN` | empty | If set, MCP clients must send `Authorization: Bearer <token>` |

The runtime client version is stored in `public/version.json` and returned by `/api/version` with `Cache-Control: no-store`.

## MCP / MUD test harness

Starting the web client also exposes an **MCP relay** at `/mcp` on the same port,
so an LLM (Claude Code, Codex, …) can drive a MUD: connect, log in, send commands,
read framed output, assert on GMCP state, and run scripted pass/fail tests. The
target MUD is chosen per connection, so it works against any MUD — not just Darkwind.

```bash
npm start        # serves the client AND http://localhost:3000/mcp
```

A standalone CLI (`mud-test-mcp/cli.js`) runs the same checks for manual smoke
tests and CI.

- Overview, tools, wiring, and client (Claude Code / Codex) setup — [docs/mcp.md](docs/mcp.md)
- CLI reference — [docs/mcp-cli.md](docs/mcp-cli.md)
- Test-script (YAML) format — [docs/mcp-test-scripts.md](docs/mcp-test-scripts.md)

Disable with `MCP_ENABLED=0`; secure a public deployment with a hidden `MCP_PATH`
and an `MCP_AUTH_TOKEN` bearer token.

## Docker

```bash
docker build -t darkflow-client .
docker run -p 3000:3000 darkflow-client
```

## Project Layout

```
.
├── server.js                    # Express static server plus config/version endpoints
├── public/
│   ├── index.html               # Darkflow app shell
│   ├── darkflow-brand.html      # Hidden brand asset download page
│   ├── site.webmanifest         # PWA/app metadata
│   ├── version.json             # Runtime client version
│   ├── assets/
│   │   ├── brand/               # Darkflow logos, favicons, app icons
│   │   ├── tiles/               # Terrain and player map tiles
│   │   └── login-background.jpg
│   ├── css/
│   │   ├── main.css             # App shell, toolbar, settings, terminal chrome
│   │   ├── panels.css           # Dock columns, panel widgets, map styling
│   │   ├── windows.css          # Server-driven modal/window styles
│   │   └── ide.css              # Browser IDE styles
│   └── js/
│       ├── app.js               # App init, status bar, toolbar wiring
│       ├── brand.js             # Darkflow product constants
│       ├── about-modal.js       # Top-left icon About modal
│       ├── connection.js        # WebSocket lifecycle, watchdog, reconnect
│       ├── gmcp.js              # GMCP bus, handshake, subscriptions
│       ├── output.js            # Terminal output, scrollback, replay controls
│       ├── input.js             # Command input, history, shortcuts
│       ├── settings-manager.js  # Settings, import/export, aliases/triggers/highlights UI
│       ├── panel-manager.js     # Panel lifecycle, layout, GMCP panel handlers
│       ├── panel-renderers.js   # Built-in panel renderers
│       ├── map-data.js          # Room graph, map sync, map debug tools
│       ├── map-renderer.js      # Tile map renderer
│       ├── window-manager.js    # Darkwind.Window renderer
│       ├── ide-manager.js       # Darkwind.IDE GMCP bridge
│       ├── ide-editor.js        # Browser code editor
│       ├── completion.js        # Local/server Tab completion
│       ├── announcements-manager.js
│       └── giphy-manager.js
├── docs/                        # GMCP protocol + MCP/test-harness documentation
├── mud-test-mcp/                # MCP relay + CLI MUD test harness (see docs/mcp.md)
├── Dockerfile
├── package.json
└── CLAUDE.md
```

## GMCP Packages

Darkflow advertises these standard GMCP packages:

| Package | Purpose |
|---------|---------|
| `Char 1` | Character identity and profile data |
| `Char.Vitals 1` | HP/SP and vital state |
| `Char.Items 1` | Inventory, room, and container item state |
| `Room 1` | Room info and room player updates |
| `Comm 1` | Channel/chat messages |
| `Group 1` | Party/group state |
| `Game 1` | Game name, version, uptime, reboot state |

Darkflow also advertises these Darkwind-specific packages:

| Package | Purpose | Docs |
|---------|---------|------|
| `Darkwind.Char.Avatar 1` | Player avatar image data | [index](docs/gmcp-darkwind-index.md) |
| `Darkwind.Room.Image 1` | Generated room image panel data | [index](docs/gmcp-darkwind-index.md) |
| `Darkwind.Sky 1` | Animated sky, time, and lunar sync data | [sky](docs/gmcp-darkwind-sky.md) |
| `Darkwind.Client.Subscriptions 1` | Client-side panel/feature visibility subscriptions | [index](docs/gmcp-darkwind-index.md) |
| `Darkwind.Window 1` | Server-driven modals, panels, forms, actions | [window](docs/gmcp-darkwind-window.md) |
| `Darkwind.IDE 1` | Builder file editor open/save/result/close | [ide](docs/gmcp-darkwind-ide.md) |
| `Darkwind.MapData 1` | Collaborative map sync and coordinate correction | [mapdata](docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.Completion 1` | Server-authoritative command/argument completion | [completion](docs/gmcp-darkwind-completion.md) |
| `Darkwind.Quests 1` | Quest list, active quest, objective updates, completion | [quests](docs/gmcp-darkwind-quests.md) |
| `Darkwind.Achievements 1` | Achievement panel and update data | [index](docs/gmcp-darkwind-index.md) |
| `Darkwind.Announcements 1` | Announcement inbox and read-state updates | [announcements](docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Giphy 1` | In-client animated GIF reactions | [index](docs/gmcp-darkwind-index.md) |

Client-originated helper packages include `Darkwind.Client.RefreshMedia` and `Darkwind.Client.Subscriptions`.

## Brand Assets

The current Darkflow logo/icon exports live under `public/assets/brand/`.

Open `/darkflow-brand.html` in a running local or deployed client to view and download:

- horizontal logo
- compact logo
- standalone mark
- wordmark
- app icon
- favicon source
- 512/256/192/180/128/64/32/16 icon exports

The generated source sheet is stored as `Gemini_Generated_Image_itemzcitemzcitem.jpeg`.

## Development Notes

- No frontend build step is required; edit files in `public/` directly.
- Keep `/api/version` backed by `public/version.json`; the client uses it for update detection and GMCP `Core.Hello`.
- Keep the visible product name as **Darkflow**, but do not rename existing `Darkwind.*` GMCP packages without a coordinated server compatibility plan.
- The settings export format remains `darkwind-client-settings-export` for backward compatibility, even though download filenames now use `darkflow-settings-...json`.
- Use `window.wsDebug.snapshot()` and `window.wsDebug.exportAll()` for connection diagnostics.
- Use `window.mapDebug.summary()`, `window.mapDebug.exportAll()`, and `window.mapDebug.clearData()` for map diagnostics.

## Browser Support

Chrome 90+, Firefox 90+, Safari 15+, Edge 90+ with native WebSocket support.

## License

`darkflow-client` is released under the [Unknown](LICENSE).

This package includes or depends on third-party components under their own
licenses:

| Dependency | License |
| --- | --- |
| [express](https://github.com/expressjs/express) | MIT |
| [ws](https://github.com/websockets/ws) | MIT |
