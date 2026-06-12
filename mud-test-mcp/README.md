# mud-test-mcp — Darkflow MCP relay

A generic MUD-over-MCP relay + CLI test harness. It lets an LLM (or a CI script)
connect to any MUD, send commands, read framed output, and run scripted pass/fail
tests. It shares the telnet/GMCP parser with the Darkflow web client and is mounted
at `/mcp` when that client starts.

**Full documentation lives in the web-client docs:**

- Overview, MCP tools, wiring, Claude Code / Codex setup — [`../docs/mcp.md`](../docs/mcp.md)
- CLI reference — [`../docs/mcp-cli.md`](../docs/mcp-cli.md)
- Test-script (YAML) format + Kingdom example suite — [`../docs/mcp-test-scripts.md`](../docs/mcp-test-scripts.md)

## Quick start

```sh
npm install
cp config.example.env .env       # optional defaults — all optional
node cli.js run examples/smoke.yaml
npm test                          # unit tests against a fake in-process MUD
```

## Layout

- `core/mcp.js` — the MCP tools (`createMcpServer`) + `attachMcp(app)` HTTP mount
- `core/session.js` — telnet/GMCP session (connect, login, send/read, framing)
- `core/framing.js`, `core/script.js`, `core/config.js`, `core/telnet.js`
- `mcp-server.js` — standalone entry (`stdio` default, `--http` for remote)
- `cli.js` — command-line runner (`send` / `state` / `run`)
- `examples/` — sample one-off scripts
- `../darkwind-nextgen/tests/` — reusable regression suites, incl. `kingdoms/` and `equipment/`
