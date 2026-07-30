# Darkwind.Tutorial GMCP Protocol

`Darkwind.Tutorial 1` carries the server-authoritative new-player tutorial to
Darkflow's nonmodal tutorial hover. It does not replace the game's text
fallback: the server uses the hover only after the client explicitly advertises
`features.tutorialPane: true`.

## Readiness and lifecycle

Darkflow advertises tutorial capability through
`Darkwind.Client.Subscriptions`:

```json
{
  "reason": "login",
  "full": true,
  "features": {
    "tutorialPane": true
  }
}
```

Readiness means the tutorial manager and its render shell are initialized. It
does not depend on an active tutorial or on whether the player minimized the
card. Darkflow advertises `false` after a render failure and stops advertising
readiness while disconnected or in Zork-only mode. Renderer failures trigger a
bounded render retry, including a remount when the tutorial shell is missing or
detached. A successful recovery advertises readiness again and requests a fresh
authoritative State.

An active state opens the hover automatically without taking keyboard focus.
When the server sends an `awaiting_continue` state, Darkflow immediately sends
the authorized Continue action and presents the objective as one actionable
player-facing step. It does not announce or require a separate explanation
phase. If the automatic acknowledgement cannot be delivered or times out, the
Continue control returns as a recovery fallback. Finished, skipped, and
disconnected states remove the hover. Minimizing produces a small restore chip
and never changes server progress.

## `Darkwind.Tutorial.State`

Direction: server to client.

```json
{
  "epoch": "acer:1722109500",
  "seq": 8,
  "tutorial_version": 2,
  "status": "active",
  "awaiting_continue": true,
  "chapter": {
    "id": "orientation",
    "index": 1,
    "total": 5,
    "title": "Find your bearings"
  },
  "step": {
    "id": "look",
    "index": 1,
    "total": 21,
    "title": "Look around",
    "task": "Read the room description and exits.",
    "hint": "Type look to see the room again.",
    "help": "help look",
    "example_command": "look",
    "target": "command-input"
  },
  "route": null,
  "actions": ["continue", "hint", "skip"],
  "reason": "progress"
}
```

| Field | Meaning |
| --- | --- |
| `epoch` | Connection/tutorial generation identifier. A new value resets sequence comparison. |
| `seq` | Monotonically increasing state sequence within an epoch. Darkflow rejects equal or older frames. |
| `tutorial_version` | State schema version. Version 2 is required by `Darkwind.Tutorial 1`. |
| `status` | `not_started`, `active`, `skipped`, or `finished`. |
| `awaiting_continue` | The server is waiting for a Continue acknowledgement. Darkflow sends it automatically for the visual tutorial. |
| `chapter` | Stable chapter id plus one-based chapter progress and display title. |
| `step` | Stable objective id, overall progress, safe display copy, example command, and semantic target. |
| `route` | `null`, or `{place, directions, text}` for a server-computed route. |
| `actions` | Server-authorized action ids for the current state. |
| `reason` | Short state-update reason such as `snapshot`, `progress`, or `hint`. |
| `hint_visible` | Optional boolean asking the client to reveal the current hint. |

Darkflow recognizes only these semantic target tokens: `terminal`,
`command-input`, `panels-menu`, `inventory-panel`, `vitals-panel`, and
`enemy-panel`. They map to known client elements; arbitrary selectors and
unknown values are ignored.

Clicking `example_command` only copies the example into the command input. It
never executes the command.

## `Darkwind.Tutorial.Control`

Direction: server to client.

```json
{
  "visible": false,
  "reason": "screenreader"
}
```

The server sends a visibility control when a live preference, subscription, or
capability change makes the visual presentation inappropriate. Reasons include
`screenreader`, `subscription-disabled`, and `capability-removed`. Darkflow
immediately removes the hover, cancels pending actions, and leaves tutorial
progress unchanged. A later, newer State makes the hover visible again. This
also allows `set screenreader on|off` to switch between terminal and visual
presentation without reconnecting or leaving a stale card behind.

## `Darkwind.Tutorial.Action`

Direction: client to server.

```json
{
  "action": "continue",
  "epoch": "acer:1722109500",
  "seq": 8,
  "step_id": "look"
}
```

The client sends only an action listed by the current State. Supported action
ids are `continue`, `hint`, `directions`, `restart`, and `skip`. Epoch, sequence,
and step id let the server reject a click from a stale rendered state. Skip
requires a second, explicit confirmation in Darkflow before this message is
sent.

The client never advances progress locally. For visual tutorials it
automatically sends an authorized `continue` when an objective is gated, then
waits for the server's newer actionable State. This removes the redundant
Continue phase without bypassing server authority. Other repeated actions
remain disabled until the server returns a newer State.

## `Darkwind.Tutorial.Resync`

Direction: client to server.

```json
{
  "epoch": "acer:1722109500",
  "seq": 8,
  "reason": "reconnect"
}
```

Darkflow requests a current snapshot after advertising readiness, reconnecting,
recovering a session, or recovering from a renderer failure. The epoch and
sequence are advisory; the server remains authoritative.

## Accessibility and fallback

The hover is a labelled complementary region, uses native controls and
progress semantics, and announces each actionable State sequence once in a
dedicated polite live region. The automatically acknowledged compatibility
gate is not announced as a separate step. The hover does not bind Escape or
take focus when it opens. Motion and target pulsing stop under
`prefers-reduced-motion`.

If the package is unsupported or `tutorialPane` is false, the game continues
the complete text tutorial through the normal `tutorial` command surface.
