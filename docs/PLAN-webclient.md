# Plan: Build WebSocket MUD Client

## Context

The project needs a web-based client that connects to an LDMud game server (play.darkwind.ai) via WebSocket. The LDMud driver auto-detects WebSocket connections on the same telnet port, so no special server config is needed. The full spec is in `BLUEPRINT-webclient.md`. The app will be hosted on Coolify via Docker.

## Project Structure

```
play.darkwind.ai/
├── package.json          # Node project with Express dependency
├── server.js             # Minimal Express server serving static files
├── Dockerfile            # Simple Node Alpine image
├── .dockerignore         # node_modules, .git, etc.
├── public/
│   └── index.html        # Self-contained webclient (all CSS+JS embedded)
├── docs/
│   └── PLAN-webclient.md # This file
├── BLUEPRINT-webclient.md
└── CLAUDE.md
```

## Step 1: Node + Express Server (`server.js`)

Minimal Express app:
- Serve `public/` as static files
- Listen on `PORT` env var (default 3000) — Coolify sets this
- No WebSocket proxying needed (client connects directly to the MUD server, not through Express)

## Step 2: Docker Setup

**`Dockerfile`:**
- Base: `node:22-alpine`
- `WORKDIR /app`
- Copy `package.json` + `package-lock.json`, run `npm ci --omit=dev`
- Copy `server.js` and `public/`
- `EXPOSE 3000`
- `CMD ["node", "server.js"]`

**`.dockerignore`:** `node_modules`, `.git`, `*.md` (except public assets)

**`package.json`:** name, version, `"main": "server.js"`, `"start": "node server.js"`, Express as only dependency.

## Step 3: Webclient HTML (`public/index.html`)

Single self-contained HTML file with embedded CSS and JS (no build tools, no external dependencies).

### 3.1 HTML Layout (flex column, 100dvh)

- **Toolbar**: host input (default: `location.hostname`), port input (default: 4242), WSS checkbox, Connect button, auto-reconnect checkbox, connection state label
- **Output div**: `flex-grow: 1`, scrollable, lines appended as child divs
- **Input bar**: text input + Send button, at bottom of flex (not `position: fixed`)
- **Status bar footer**: URL, duration, bytes sent/received

### 3.2 CSS

- Dark theme: bg `#0d1117`, text `#c9d1d9`, monospace font stack (`"Cascadia Code", "Fira Code", "Source Code Pro", monospace`)
- Output area: `pre-wrap`, `break-word`, `overflow-y: auto`, `user-select: text`
- ANSI color classes: 8 standard fg/bg + 8 bright fg/bg + bold/underline/inverse
- 256-color handled via inline styles (not CSS classes)
- System messages: dim green italic; echo lines: gray
- Connection state indicator: green/yellow/red
- Responsive `@media (max-width: 600px)` for toolbar stacking

### 3.3 JavaScript (single IIFE)

#### Constants & Config
- `MAX_LINES = 5000`, `PRUNE_BATCH = 500`, `MAX_HISTORY = 200`
- Reconnect backoff: base 1s, max 30s
- 256-color lookup table (256 hex strings: 0-7 standard, 8-15 bright, 16-231 = 6x6x6 cube, 232-255 grayscale)

#### ANSI Parser (state machine)
- Persistent state across messages: `buffer` (incomplete escape), `bold`, `underline`, `inverse`, `fg`, `bg`
- Parse whole message first (not per-line), then split fragments by `\n` into line arrays
- CSI parsing: scan from `\x1b[` through digits/semicolons to terminating letter
- If message ends mid-sequence, buffer from `\x1b` onward for next message
- SGR codes: 0=reset, 1=bold, 4=underline, 7=inverse, 22/24/27=off, 30-37/40-47 standard, 90-97/100-107 bright, 38;5;n / 48;5;n 256-color, 39/49 default
- Build DOM nodes with `createElement`/`createTextNode` (no innerHTML)
- Inverse mode: resolve fg/bg to concrete hex, swap, apply inline

#### Output Display Manager
- Scroll-lock: `scrollHeight - scrollTop - clientHeight < 5` on scroll events
- `appendOutput(text, cssClass)`: parse ANSI → fragments per line → push to `pendingFragments` → schedule RAF
- `flushOutput()`: DocumentFragment, append all pending divs, prune if over MAX_LINES, auto-scroll if not locked
- `clearOutput()`: remove all children, reset lineCount
- Binary frames: hex dump via `Uint8Array`, display as system message

#### Connection Manager
- State: `ws`, `connectionState`, `connectTime`, `bytesSent`, `bytesReceived`, `reconnectAttempts`, `reconnectTimer`
- `connect()`: guard duplicates, construct `ws[s]://host:port/`, set `binaryType = 'arraybuffer'`, wire events
- `onclose`: 1006 → "Connection lost", 1000 → "Disconnected", 1001 → "Server closed"; schedule reconnect if enabled
- `disconnect()`: clear reconnect timer, `ws.close(1000, "User disconnect")`
- Exponential backoff: `min(1000 * 2^(attempts-1), 30000)`

#### Command Input & History
- History in array, persisted to sessionStorage, max 200
- `historyIndex` at `commandHistory.length` = current input
- Up/Down arrow navigation with current-input preservation
- `sendCommand()`: `ws.send()`, push to history, echo `> ` prefix, clear & focus input

#### Status Bar
- `setInterval` 1s: duration, bytes sent/received, URL

#### Keyboard Shortcuts
- Document: Ctrl+L → clear output, Escape → clear input, Page Up/Down → scroll
- Input: Enter → send, Up/Down → history

#### Init (DOMContentLoaded)
- Cache DOM refs, load history, set defaults, attach listeners, start status interval
- `beforeunload`: save history, close WS

## Key Implementation Details

1. **ANSI parse-then-split**: parse across the whole message first, then split fragments by `\n` into per-line arrays
2. **RAF batching**: multiple `onmessage` events between frames accumulate; single RAF flushes via DocumentFragment
3. **DOM construction** (no innerHTML): `createElement` + `createTextNode` for auto HTML escaping
4. **256-color `38;5;n`**: when iterating SGR params and hitting 38/48, advance index by 2 to consume `5, n`

## Verification

1. `npm install && node server.js` — confirm server starts on port 3000
2. Open `http://localhost:3000` in browser
3. `docker build -t mudclient . && docker run -p 3000:3000 mudclient` — confirm Docker works
4. Enter MUD host/port, click Connect, verify WebSocket upgrade in DevTools
5. Verify ANSI colors render, commands work, Up/Down history works
6. Test scroll-lock: scroll up, verify no auto-scroll; scroll to bottom, verify auto-scroll resumes
7. Test Ctrl+L, Escape, disconnect/reconnect, sessionStorage persistence
8. Test responsive layout at 320px width
