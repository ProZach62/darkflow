# Darkflow MCP relay

`mud-test-mcp/` is a generic **MUD-over-MCP relay**: it lets an LLM (Claude Code,
Codex, …) drive *any* MUD — connect, log in, send commands, read **framed** output
(it knows when a command's output is "done"), and assert on structured GMCP state.
The target MUD is chosen per connection (host/port/username/password), so nothing
is hardcoded to one game or account.

It shares the same telnet/GMCP byte parser as the web client
(`lib/telnet-parser.js`), so on-the-wire behavior is identical to a real Darkflow
session.

- **CLI reference:** [`mcp-cli.md`](mcp-cli.md)
- **Test-script (YAML) reference:** [`mcp-test-scripts.md`](mcp-test-scripts.md)
- **Code:** [`../mud-test-mcp/`](../mud-test-mcp/) — tools in `core/mcp.js`, the
  telnet session in `core/session.js`, the CLI in `cli.js`, the standalone server
  in `mcp-server.js`.

## Why

When an LLM finishes a phase of work it can usually state the exact commands that
verify it — both the success path and the failure/edge cases. This relay lets the
LLM actually run them and get a pass/fail report instead of asking a human to test
by hand. The same machinery doubles as a CLI smoke-test / CI runner.

## MCP tools

| Tool | Purpose |
|------|---------|
| `mud_connect` | Connect to a MUD you specify (`host`, `port`, `character`/`username`, `password`, `tls`) and optionally log in. Returns `sessionId`, `loggedIn`, banner, landing room. Omit credentials to connect-only and drive login yourself with `mud_send`. |
| `mud_send` | Send one command; returns `{ text, raw, gmcp[], settledBy }`. |
| `mud_read` | Drain async output since the last read/send (combat rounds, chatter, timed events). |
| `mud_state` | Latest structured GMCP snapshot (`Room.Info`, `Char.Vitals`, …); pass a package name or omit for all. |
| `mud_run_script` | Run a step list (see [`mcp-test-scripts.md`](mcp-test-scripts.md)); returns a per-step pass/fail report. |
| `mud_disconnect` / `mud_sessions` | Close / list active sessions. |

Sessions persist across tool calls, keyed by `sessionId`. The MCP endpoint URL is
just the transport — the **target MUD is chosen per `mud_connect` call**, so one
deployment serves any MUD/account.

## Output framing

`mud_send` returns when a command's output is complete, decided in priority order:

1. **IAC GA** — some MUDs append a telnet `IAC GA` after each prompt (often when the
   client advertises GMCP `Core.Hello.client == "Mudlet"`, which this relay does).
   When present it's the clean signal (`settledBy: "ga"`). Many MUDs, including
   Darkwind, don't send it — the next rules cover that.
2. **Quiet debounce** — no new bytes for `MUD_QUIET_MS` (default 250 ms) after the
   first output (`settledBy: "quiet"`).
3. **Hard timeout** — `MUD_TIMEOUT_MS` (default 3000 ms) cap (`settledBy: "timeout"`).

## Wiring it up

The tools (`core/mcp.js`) can be served three ways:

### 1. Embedded in the Darkflow web client (recommended)

`server.js` dynamically mounts the relay at `/mcp` on the web client's own port, so
just starting the client serves both:

```sh
npm start          # serves the client AND http://localhost:3000/mcp
```

It logs `[mcp] mounted at /mcp (open)`. Controlled by env on the web-client process:

| Variable | Default | Effect |
|----------|---------|--------|
| `MCP_ENABLED` | `1` | Set to `0` to not mount `/mcp`. |
| `MCP_PATH` | `/mcp` | Route to serve on; use a long random path for a "hidden URL" in production. |
| `MCP_AUTH_TOKEN` | empty | If set, clients must send `Authorization: Bearer <token>`. If unset, the endpoint is open. |

Because mounting is gated and loaded dynamically with a graceful fallback, a
missing/broken relay can never stop the web client from serving.

### 2. Standalone stdio

The client spawns the server as a local child process:

```sh
node mud-test-mcp/mcp-server.js          # speaks MCP over stdio
```

### 3. Standalone Streamable HTTP

```sh
node mud-test-mcp/mcp-server.js --http   # listens on http://127.0.0.1:7423/mcp
```

Env: `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_PORT` (default `7423`),
`MCP_PATH`, `MCP_AUTH_TOKEN`. `GET /health` is unauthenticated for tunnel/uptime checks.

## Connecting an LLM client

The endpoint URL is just the transport; pass the target MUD as `mud_connect`
arguments (or set env defaults — see [`mcp-cli.md`](mcp-cli.md#environment)).

### Claude Code

```sh
# embedded or standalone HTTP:
claude mcp add --transport http darkflow http://localhost:3000/mcp
#   add --header "Authorization: Bearer <token>" if MCP_AUTH_TOKEN is set
#   add -s user to register globally instead of per-project

# standalone stdio:
claude mcp add darkflow -- node /ABSOLUTE/PATH/play.darkwind.ai/mud-test-mcp/mcp-server.js
```

### Codex (`~/.codex/config.toml`)

Codex GUI and CLI share this file (GUI: gear → Codex Settings → Open config.toml).

```toml
# Remote / embedded HTTP:
[mcp_servers.darkflow]
url = "http://localhost:3000/mcp"
# bearer_token_env_var = "DARKFLOW_MCP_TOKEN"   # only if MCP_AUTH_TOKEN is set
```

```toml
# Local stdio (use the ABSOLUTE node path — GUI apps don't inherit your shell PATH):
[mcp_servers.darkflow]
command = "/Users/you/.nvm/versions/node/vXX/bin/node"
args = ["/ABSOLUTE/PATH/play.darkwind.ai/mud-test-mcp/mcp-server.js"]
[mcp_servers.darkflow.env]
MUD_HOST = "127.0.0.1"
MUD_PORT = "4242"
```

`bearer_token_env_var` names an env var Codex reads and sends as
`Authorization: Bearer <value>`; set `export DARKFLOW_MCP_TOKEN=<token>` to match
the server's `MCP_AUTH_TOKEN`.

## Production & security

- The relay must run where it can reach the MUD. Embedded in the web client it
  naturally shares the client's `MUD_HOST`/`MUD_PORT`. Standalone, set those (and
  `MUD_TLS=1` if the MUD needs TLS).
- Behind a public tunnel (Cloudflare Tunnel / ngrok) keep the bind on `127.0.0.1`
  and front it; for a private setup use Tailscale.
- A hidden `MCP_PATH` is obscurity; a bearer token (`MCP_AUTH_TOKEN`) is the real
  control and costs nothing. **Anyone who reaches the endpoint can drive the test
  character**, so point credentials at a throwaway/test account in production, not
  a real one.
