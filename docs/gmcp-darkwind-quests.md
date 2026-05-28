# Darkwind.Quests GMCP Protocol Specification

This document specifies the `Darkwind.Quests` GMCP package from the current web client's point of view. No prior protocol document exists in this repository, so payload shapes below are documented from client usage in the quest manager and renderer.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Quests 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Quests.List` | Server -> Client | Replace the accepted quest list shown in the quests panel |
| `Darkwind.Quests.Active` | Server -> Client | Legacy compatibility payload; currently ignored by the panel |
| `Darkwind.Quests.Update` | Server -> Client | Incrementally update one objective for one accepted quest |
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

`Darkwind.Quests.List` replaces the stored accepted quest list. `Darkwind.Quests.Update` is applied incrementally against the matching quest in `list`, using `questId`/`questPath` plus the objective `name`.

## Darkwind.Quests.List

Direction: `Server -> Client`

Replaces the quest list used for the panel summary view.

The client expects an array. The following fields are read by the renderer:

```json
[
  {
    "name": "A Simple Task",
    "status": "Started",
    "current": 2,
    "total": 5,
    "objectives": [
      {
        "name": "Gather herbs",
        "current": 2,
        "required": 5,
        "status": "started"
      }
    ]
  }
]
```

| Field | Type | Required By Client | Notes |
|-------|------|--------------------|-------|
| `name` | string | Yes | Display name |
| `status` | string | Yes | Rendered verbatim; `Finished` gets completed styling |
| `current` | number | No | Progress numerator |
| `total` | number | No | Progress denominator |
| `objectives` | array | No | Objective list rendered under the quest row |
| `objectives[].name` | string | Yes | Objective identifier for display and incremental updates |
| `objectives[].current` | number | Yes | Current objective progress |
| `objectives[].required` | number | Yes | Required objective progress |
| `objectives[].status` | string | No | `finished` renders a completed checkmark and completed bar state |

If `total > 0`, the client renders a progress bar using `current / total`.

## Darkwind.Quests.Active

Direction: `Server -> Client`

Legacy compatibility payload.

The current quest panel does not require this payload. The server may send an empty object or array:

```json
[]
```

## Darkwind.Quests.Update

Direction: `Server -> Client`

Updates one objective inside the currently stored accepted quest list.

The client expects, at minimum:

```json
{
  "questId": "/quests/darkwind/l01_10/farmyard_roundup.c",
  "questPath": "/quests/darkwind/l01_10/farmyard_roundup.c",
  "questName": "Farmyard Roundup",
  "objective": "Gather herbs",
  "current": 3,
  "required": 5
}
```

| Field | Type | Required By Client | Notes |
|-------|------|--------------------|-------|
| `questId` | string | Recommended | Matched against `list[].id` or `list[].questPath` |
| `questPath` | string | No | Same logical quest path as `questId` |
| `questName` | string | No | Human-readable quest name |
| `objective` | string | Yes | Matched against `list[].objectives[].name` |
| `current` | number | Yes | New current value |
| `required` | number | Yes | New required value |

### Client Behavior

- Stores the payload as `lastUpdate`.
- Finds the matching quest in `list` by `questId`/`questPath`.
- If the matching quest has an `objectives` array, finds the first objective whose `name` equals `objective`.
- Replaces that objective's `current` and `required` values.
- Sets `status` to `finished` when `current >= required`, otherwise `started`.
- Recalculates the quest row's aggregate `current` from objective progress.

If no matching quest or objective exists, the message is still stored as `lastUpdate`, but no in-place quest mutation occurs.

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
Darkwind.Quests.Update {"questId":"/quests/darkwind/l01_10/farmyard_roundup.c","objective":"Gather herbs","current":3,"required":5}
```
