# MUD test CLI (`mud-test-mcp/cli.js`)

A thin command-line front-end over the same core as the [MCP relay](mcp.md). Use it
for manual smoke tests and CI — it logs into a MUD, runs commands or a scripted
sequence, frames the output, checks expectations, and sets an exit code.

All commands below are run from the repo root (`play.darkwind.ai/`):

```sh
node mud-test-mcp/cli.js <command> [args] [connection flags]
```

> Requires Node 18+. If `node` isn't on PATH (e.g. launched outside your shell),
> use its absolute path. The CLI reads `mud-test-mcp/.env` fresh on every run.

## Commands

### `send "<command>"`

Connect, log in, send one command, and print the framed (ANSI-stripped) output to
stdout. A diagnostic line (`[settledBy=…, gmcp frames=N]`) goes to stderr.

```sh
node mud-test-mcp/cli.js send "look"
```

### `state [Package]`

Connect, log in, wait briefly for GMCP, and print the structured GMCP state as
JSON. With a package name (e.g. `Room.Info`) prints just that package; with no
argument prints the whole snapshot.

```sh
node mud-test-mcp/cli.js state Room.Info
node mud-test-mcp/cli.js state            # full snapshot
```

### `run <script.yaml|script.json>`

Load a test script (see [`mcp-test-scripts.md`](mcp-test-scripts.md)), run every
step, and print a per-step `[PASS]`/`[FAIL]` report with captured output for
failures. **Exit code is `0` if all steps pass, `1` if any fail** (so it drops
straight into CI).

```sh
node mud-test-mcp/cli.js run mud-test-mcp/examples/smoke.yaml
```

Example output:

```
[PASS] #0 send "look"  (look at the room)  <quiet>
[FAIL] #1 send "get sword"  (pick up the sword)  <quiet>
    - expected to contain "You take"
    output:
      There is no sword here.
PASSED/FAILED summary: 1/2 steps passed.
```

## Connection flags

By default the target comes from `.env`. Any flag overrides the corresponding env
value, so you can point the CLI at any MUD ad-hoc:

| Flag | Aliases | Meaning |
|------|---------|---------|
| `--host <h>` | | Target MUD hostname/IP |
| `--port <p>` | | Target MUD port (default 4242) |
| `--user <name>` | `--character`, `--char`, `--username` | Character/account to log in as |
| `--password <pw>` | `--pass` | Password |
| `--tls` | | Connect over TLS instead of plain telnet |
| `--name-prompt <regex>` | | Override the login name-prompt pattern for an unusual MUD |
| `--password-prompt <regex>` | | Override the password-prompt pattern |

Flags accept `--key value` or `--key=value`. Everything that isn't a flag is
positional (the command text, package name, or script path).

```sh
node mud-test-mcp/cli.js send "look" \
  --host mud.example.com --port 5000 --user bob --password pw --tls

node mud-test-mcp/cli.js run mytest.yaml --host 127.0.0.1 --port 4242
```

## Environment

Set in `mud-test-mcp/.env` (copy from `config.example.env`) — all optional:

| Variable | Purpose |
|----------|---------|
| `MUD_HOST`, `MUD_PORT` | Default target host/port |
| `MUD_CHARACTER`, `MUD_PASSWORD` | Default login (aliases: `MUD_TEST_CHAR`, `MUD_TEST_PASS`) |
| `MUD_TLS` | `1` to default to TLS |
| `MUD_NAME_PROMPT`, `MUD_PASSWORD_PROMPT` | Login prompt regex defaults |
| `MUD_CLIENT_NAME` | GMCP `Core.Hello.client` (default `Mudlet`) |
| `MUD_QUIET_MS`, `MUD_TIMEOUT_MS` | Output-framing defaults (250 / 3000 ms) |
| `MUD_DEBUG` | `1` logs connection/login diagnostics to stderr |

The CLI needs a host **and** credentials (from flags or env); otherwise it exits
with a clear error. `.env` is gitignored.

## Tests

The package's own unit tests run against a fake in-process MUD (no live game needed):

```sh
cd mud-test-mcp && npm test
```
