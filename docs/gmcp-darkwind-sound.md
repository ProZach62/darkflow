# Darkwind.Sound GMCP Protocol Specification

`Darkwind.Sound` lets the mudlib trigger client-side audio while leaving
volume, mute, category filtering, and file resolution under the player's
browser settings.

## Support String

```json
["Darkwind.Sound 1"]
```

## Message

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Sound` | Server -> Client | Play, loop, or stop a categorized sound |

## Payload

```json
{
  "type": "play",
  "category": "combat",
  "sound": "hit",
  "volume": 0.8,
  "id": "optional-id"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | string | Yes | `play`, `loop`, or `stop` |
| `category` | string | Yes | One of `combat`, `spell`, `skill`, `potion`, `quest`, `celebration`, `discussion`, `alert`, `ambient`, `ui` |
| `sound` | string | Required for `play` and `loop` | Sound name, `.mp3` filename, or path under `assets/sounds/` |
| `volume` | number | No | Multiplier from `0.0` to `1.0`; client clamps invalid values |
| `id` | string | Required for `loop`, optional for `play` and `stop` | Loop identifier used to stop or replace a looping sound |

## Client Behavior

- The audio widget is embedded in the top toolbar, immediately left of the bell
  icon. It is not part of the movable panel system.
- The widget stays hidden until the server advertises `Darkwind.Sound` through
  `Core.Supports.Set` or `Core.Supports.Add`.
- The compact toolbar view shows the current sound category and a mute button.
- The expanded view opens downward from the toolbar and shows master volume and
  category toggles.
- All sound categories are enabled by default; player settings can still mute
  or disable individual categories.
- One-shot activity fades back to `Ready`; loop activity remains visible until
  stopped.
- Player settings are stored in `localStorage["darkwind-sound-settings"]` and
  are included in Darkflow settings export/import.
- Missing files are non-fatal; the browser console may warn, but no player-facing
  error is shown.

## File Resolution

The client resolves `sound` in this order:

1. Built-in map of known `category/sound` pairs.
2. Explicit `.mp3` filename under `assets/sounds/`.
3. Path-style names under `assets/sounds/`, with `.mp3` appended.
4. Fallback `assets/sounds/{category}-{sound}.mp3`.

Combat aliases mirror the MudForge naming where possible. For example,
`combat/riposte` currently resolves to the parry asset because there is no
separate riposte file in the imported MudForge sound set.

## Examples

```json
Darkwind.Sound {"type":"play","category":"quest","sound":"accept"}
Darkwind.Sound {"type":"play","category":"skill","sound":"bard/harp_C4","volume":1.0}
Darkwind.Sound {"type":"loop","category":"ambient","sound":"rain","id":"room-ambience","volume":0.3}
Darkwind.Sound {"type":"stop","category":"ambient","sound":"","id":"room-ambience"}
```
