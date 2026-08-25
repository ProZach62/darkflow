# MUD test scripts (YAML / JSON)

A test script is an ordered list of **steps**, each a single action plus
expectations. Run one with the [CLI](mcp-cli.md) or the MCP `mud_run_script` tool;
you get a per-step pass/fail report. Scripts are the durable, re-runnable form of
"here are the exact commands that verify this change."

```sh
node mud-test-mcp/cli.js run path/to/script.yaml
```

Point `run` at a **directory** to run every `.yaml` / `.yml` / `.json` script in it
(each in its own session, with an aggregate pass/fail summary) — see the
[CLI reference](mcp-cli.md). Handy for a whole suite, e.g. the Kingdom tests below.

## File shape

YAML or JSON. Top level is a `steps:` list (a bare array is also accepted):

```yaml
steps:
  - send: "look"
    expect_contains: ["You are", "exits"]
  - gmcp: "Room.Info"
    expect_equals: { name: "Temple Square" }
```

Set top-level `stop_on_fail: true` when later steps depend on earlier setup or
preflight checks. The runner then stops after the first failed step.

## Step kinds

Each step is exactly one of:

| Key | Action |
|-----|--------|
| `send: "<command>"` | Send a command; the step's text is the framed command output. |
| `gmcp: "Package.Name"` | Read the latest GMCP snapshot for that package (e.g. `Room.Info`, `Char.Vitals`). |
| `read: true` | Drain unsolicited/async output that arrived since the last step. |
| `wait_ms: <n>` | Pause `n` milliseconds (e.g. to let a timed event fire). `sleep:` is an alias. |

## Expectations

Apply to `send`, `read`, and `gmcp` steps. A step **passes** when *all* its
expectations hold.

| Field | Type | Passes when |
|-------|------|-------------|
| `expect_contains` | string or list | The output contains **every** listed substring. |
| `expect_not_contains` | string or list | The output contains **none** of the listed substrings. |
| `expect_regex` | string or list | The output matches **every** listed regex (case-insensitive). |
| `expect_equals` | object (`gmcp` only) | The GMCP data **recursively** matches the given key/value subset. |

For `send`/`read` steps the text expectations run against the command output. For
`gmcp` steps, `expect_contains`/`expect_regex` run against the JSON-stringified
payload, and `expect_equals` is a subset match against the structured data.

## Common optional fields

| Field | Applies to | Meaning |
|-------|-----------|---------|
| `label` | any | Human description shown in the report and announced as `gossip Test: <label>` before the step, followed by its success or failure result. |
| `quiet_ms` | `send` | Override the per-command quiet-settle window. |
| `timeout_ms` | `send` | Override the per-command hard timeout. |

## Report & exit code

`mud_run_script` returns `{ passed, total, run, failed, results[] }`; each result has
`{ index, label, kind, command/package, settledBy, pass, failures[], output }`. Via
the CLI, this prints as `[PASS]`/`[FAIL]` lines and the process exits `0` (all pass)
or `1` (any fail).

## Authoring guidance

- Cover **both** paths: at least one success step and one **graceful-failure** step
  (a bad input that should be rejected cleanly).
- Guard against engine errors leaking to the player: on failure-path steps add
  `expect_not_contains: ["*** ", "Uncaught"]` (an LPC traceback / error marker).
- Prefer `expect_contains`/`expect_regex` on stable message fragments rather than
  whole lines, so wording tweaks don't make tests brittle.
- Use `gmcp` steps to assert structured state (room name, vitals) instead of
  scraping text when the data is available.
- Labels are public test-progress messages on the gossip channel. Do not put
  secrets in them; line breaks and other control characters are normalized to
  spaces before the command is sent. Each labeled step follows with
  `Test result: Success` or `Test result: Failure - <reason>`. Announcement
  responses are isolated from assertions, including pending output consumed by
  a `read` step.

### Example

```yaml
steps:
  - send: "get sword"
    label: "pick up the sword"
    expect_contains: ["You take", "sword"]
    expect_not_contains: ["isn't here"]

  - send: "wield sword"
    expect_regex: "You wield .*sword"

  - send: "get nonexistent"            # failure path: rejected cleanly
    expect_contains: ["isn't here"]
    expect_not_contains: ["*** ", "Uncaught"]

  - gmcp: "Room.Info"                  # structured-state assertion
    expect_equals: { name: "Temple Square" }
```

---

## Test suite: Kingdom / homestead

`../darkwind-nextgen/tests/kingdoms/` is a worked suite for the player-kingdom
homestead system (`secure/daemons/homestead_d.c`, the commons NPCs
Marra/Orrin/Brant, `objects/homestead/room.c`). Use it as a model for stateful,
timer-driven systems.

### How the system works

- `homestead` moves you to the **Kingdom Commons** and remembers where you came
  from; `homestead return` walks back; `homestead status`/`survey` are read-only.
- In the commons you **speak aloud** to NPCs: Orrin (`say I accept the charter` →
  claims a plot, **1,000,000** coins, one permanent charter per character),
  Marra/Brant (`say take me to my plot` → walks you to your plot).
- On your plot, `build camp marker` (25k, 60 s), `build lean-to` (75k, 300 s, needs
  camp), `build foundation` (250k, 900 s, needs lean-to). Build jobs persist a
  `complete_at`, so completion survives a daemon reload.

### Scripts

| File | Scenario | Char needed | Runtime |
|------|----------|-------------|---------|
| `01-smoke-full.yaml` | Full loop: claim → visit → camp → lean-to → foundation | fresh, ≥1.4M | ~21 min |
| `01b-smoke-camp.yaml` | Fast loop through camp marker only | fresh, ≥1.025M | ~70 s |
| `02-persistence.yaml` | Build survives `update homestead_d`; completes from saved `complete_at` | fresh wizard, ≥1.025M | ~70 s |
| `03-edge-cases.yaml` | homestead-from-commons + skip-prerequisites refusals | fresh, ≥1M | ~10 s |
| `03b-edge-claim-poor.yaml` | claim without enough money | fresh, <1M | ~5 s |

### Prerequisites & gotchas

- **Charter claims are permanent and one-per-character** (no abandon command), so
  each claim-based script needs its **own fresh, unclaimed character**.
- Funds (bank + cash) must meet the script's need (see table). On a wizard char,
  `Money <amount>` grants cash — note the **capital M** (wizard verbs are
  capitalized; lowercase `money` returns "What ?").
- Start **outside** `domains/kingdoms/...`, or `homestead` is refused.
- `02-persistence` needs a **wizard** (it runs `update`). The ~21-min waits in
  `01-smoke-full` block a single `mud_run_script` call — prefer the CLI; use `01b`
  for routine checks.

### Edge cases that need manual / wizard setup

Reachable only with combat/death/`goto`, so they aren't scripted:

- **Build while fighting** → "Finish your fight before building."
- **Build while dead** → "The dead cannot raise frontier shelter."
- **Build on another player's plot** → "This is not your plot."
- **Build off-plot** → "Stand on your plot before building." (the `build` verb only
  exists in plot rooms, so unreachable in normal play; covered by code review).

### Validation status

All assertion strings were confirmed against the live server. The claim → visit →
build → status/timer → reload-persistence → completion path and the
skip-prerequisite and claim-without-money refusals were run end-to-end and pass.
Not exercised live (same code paths): lean-to/foundation *completion* timing and
the manual-only edge cases.

> Darkwind doesn't emit telnet `IAC GA`, so the harness frames via the
> quiet-debounce fallback (`settledBy: "quiet"`). GMCP negotiates normally, so
> `mud_state` (`Char.*`, `Room.Info`, …) is available for assertions.
