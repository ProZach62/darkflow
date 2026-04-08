# Darkwind.Quests GMCP Protocol Specification

This document specifies the `Darkwind.Quests` GMCP package from the current web client's point of view. No prior protocol document exists in this repository, so payload shapes below are documented from client usage in the quest manager and renderer.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Quests 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Quests.List` | Server -> Client | Replace the quest summary list shown in the quests panel |
| `Darkwind.Quests.Active` | Server -> Client | Replace the active quest detail shown in the quests panel |
| `Darkwind.Quests.Update` | Server -> Client | Incrementally update one active objective by name |
| `Darkwind.Quests.Complete` | Server -> Client | Notify the client that a quest completed |

## Client State

The client stores quest data in memory under `gmcpData.quests` with these keys:

```json
{
  "list": [],
  "active": {},
  "lastUpdate": {},
  "lastComplete": {}
}
```

`Darkwind.Quests.List` and `Darkwind.Quests.Active` replace their respective stored payloads. `Darkwind.Quests.Update` is then applied incrementally against `active.objectives`, matching on the objective `name` field.

## Darkwind.Quests.List

Direction: `Server -> Client`

Replaces the quest list used for the panel summary view.

The client expects an array. The following fields are read by the renderer:

```json
[
  {
    "name": "A Simple Task",
    "status": "Started",
    "active": 1,
    "current": 2,
    "total": 5
  }
]
```

| Field | Type | Required By Client | Notes |
|-------|------|--------------------|-------|
| `name` | string | Yes | Display name |
| `status` | string | Yes | Rendered verbatim; `Finished` gets completed styling |
| `active` | number | No | `1` marks the row as the active quest |
| `current` | number | No | Progress numerator |
| `total` | number | No | Progress denominator |

If `total > 0`, the client renders a progress bar using `current / total`.

## Darkwind.Quests.Active

Direction: `Server -> Client`

Replaces the detailed active quest payload.

The client expects an object with at least:

```json
{
  "name": "A Simple Task",
  "description": "Collect five herbs for the apothecary.",
  "objectives": [
    {
      "name": "Gather herbs",
      "current": 2,
      "required": 5,
      "status": "started"
    }
  ]
}
```

| Field | Type | Required By Client | Notes |
|-------|------|--------------------|-------|
| `name` | string | Yes | Used to decide whether an active quest exists |
| `description` | string | No | Rendered when present |
| `objectives` | array | No | Objective list for detailed progress rendering |
| `objectives[].name` | string | Yes | Objective identifier for display and incremental updates |
| `objectives[].current` | number | Yes | Current progress |
| `objectives[].required` | number | Yes | Required progress total |
| `objectives[].status` | string | No | `finished` renders a completed checkmark and completed bar state |

## Darkwind.Quests.Update

Direction: `Server -> Client`

Updates one objective inside the currently stored active quest.

The client expects, at minimum:

```json
{
  "objective": "Gather herbs",
  "current": 3,
  "required": 5
}
```

| Field | Type | Required By Client | Notes |
|-------|------|--------------------|-------|
| `objective` | string | Yes | Matched against `active.objectives[].name` |
| `current` | number | Yes | New current value |
| `required` | number | Yes | New required value |

### Client Behavior

- Stores the payload as `lastUpdate`.
- If an active quest exists and has an `objectives` array, finds the first objective whose `name` equals `objective`.
- Replaces that objective's `current` and `required` values.
- Sets `status` to `finished` when `current >= required`, otherwise `started`.

If no matching active objective exists, the message is still stored as `lastUpdate`, but no in-place quest mutation occurs.

## Darkwind.Quests.Complete

Direction: `Server -> Client`

Notifies the client that a quest has completed.

The current client stores this payload as `lastComplete` and re-renders the quests panel, but does not read specific fields from it yet. Its wire shape is therefore only partially constrained by client behavior.

Example payload shape, inferred as reasonable but not required by the current code:

```json
{
  "name": "A Simple Task"
}
```

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Quests.Update {"objective":"Gather herbs","current":3,"required":5}
```
