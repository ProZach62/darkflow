# Darkwind.StreetSamurai GMCP Protocol

`Darkwind.StreetSamurai 1` carries the live state for the Street Samurai Cortex
dashboard. The game opens the dashboard through `Darkwind.Window.Open`, then
sends this root package whenever relevant guild state changes while that window
remains open.

## Package Overview

Support declaration advertised by Darkflow:

```json
["Darkwind.StreetSamurai 1"]
```

| Message | Direction | Purpose |
| --- | --- | --- |
| `Darkwind.StreetSamurai` | Server -> Client | Replace the current live dashboard snapshot |

There are no client-to-server messages in this package. Window closure uses
`Darkwind.Window.Closed`.

## Dashboard Negotiation

The graphical dashboard requires both:

```json
["Darkwind.Window 1", "Darkwind.StreetSamurai 1"]
```

When both packages are supported, the game responds to `dashboard` with a
`Darkwind.Window.Open` payload whose root layout node is:

```json
{
  "type": "street_samurai_dashboard",
  "id": "street-samurai-dashboard-root",
  "active_tab": "implants",
  "state": {}
}
```

The initial complete state is embedded in `state`. Later
`Darkwind.StreetSamurai` messages replace that state without reopening the
window. The client owns tab selection, so live updates preserve the player's
current Overview, Implants, or Diagnostics tab.

`dashboard -text` always requests the terminal report. The game also falls
back to terminal output for screen-reader mode or clients that do not advertise
both required packages.

## State Schema

Representative payload:

```json
{
  "protocol_version": 1,
  "maintenance_version": 3,
  "cortex_version": "3.1",
  "firmware_version": "Ronin-sama",
  "grade": "ghost",
  "active": true,
  "guild_level": 16,
  "guild_level_max": 16,
  "cortex_rank": 42,
  "cortex_rank_max": 200,
  "guild_xp": 1930,
  "guild_xp_needed": 7000,
  "cortex_effect": "105%",
  "edge": 5,
  "edge_max": 10,
  "heat": 2,
  "heat_max": 10,
  "heat_percent": 20,
  "heat_band": "Clean",
  "thermal_lockout": false,
  "biological": {
    "current": 920,
    "max": 1000,
    "percent": 92
  },
  "strain": {
    "used": 32,
    "total": 36,
    "free": 4,
    "percent": 88,
    "breakdown": {}
  },
  "target_locks": [],
  "target_lock_summary": "none",
  "alerts": [],
  "monitor_flags": {
    "OC": false,
    "OD": true
  },
  "active_firmware": ["Overclock"],
  "automation_remaining": 120,
  "processes": [],
  "updated_at": 1785180000
}
```

### Top-Level Fields

| Field | Type | Notes |
| --- | --- | --- |
| `protocol_version` | number | Package schema version; currently `1` |
| `version` | number | Compatibility alias for the maintenance schema version |
| `maintenance_version` | number | Guild maintenance-record schema version |
| `cortex_version` | string | Player-facing Cortex OS release |
| `firmware_version` | string | Current progression title without a leading article |
| `grade` | string | Installed Cortex grade, or `no-os` |
| `active` | boolean | Whether the guild contract is active |
| `guild_level`, `guild_level_max` | number | Hardware/routine progression |
| `cortex_rank`, `cortex_rank_max` | number | Long-term Cortex progression |
| `guild_xp`, `guild_xp_needed` | number | Current rank XP and next-rank requirement |
| `cortex_effect` | string | Server-calculated Cortex throughput label |
| `edge`, `edge_max` | number | Current and maximum Edge |
| `heat`, `heat_max`, `heat_percent` | number | Thermal resource state |
| `heat_band` | string | Server-defined thermal band |
| `thermal_lockout` | boolean | Whether thermal lockout is active |
| `biological` | object | Current HP, maximum HP, and bounded percentage |
| `strain` | object | Used, total, free, percentage, and capacity breakdown |
| `target_locks` | array | Active targets with `name` and `remaining` seconds |
| `target_lock_summary` | string | Terminal-compatible target summary |
| `alerts` | array | Structured system and implant alerts |
| `monitor_flags` | object | Compact firmware flag names mapped to booleans |
| `active_firmware` | string array | Active runtime effect display names |
| `automation_remaining` | number | Seconds until maintenance automation is ready |
| `processes` | array | Installed signature implants in canonical order |
| `updated_at` | number | Server Unix timestamp for the snapshot |

## Process Records

Each installed signature implant produces one process record:

```json
{
  "id": "targeting_suite",
  "name": "Photon Targeting",
  "grade": "military",
  "family": "optical",
  "load": 2,
  "durability": 170,
  "integrity": 100,
  "fragmentation": 12,
  "effectiveness": 100,
  "alerts": [],
  "patches": [],
  "vulnerabilities": [],
  "faults": [],
  "state": "TARGET LOCK",
  "state_severity": "healthy"
}
```

`state_severity` is `healthy`, `warning`, or `danger`. Process state, alert
messages, and effectiveness are calculated by the game; clients should display
them rather than deriving alternate gameplay rules.

## Alert Records

```json
{
  "severity": "warning",
  "marker": "!",
  "code": "strain_high",
  "message": "Cybernetic strain is above 75% capacity.",
  "process": "targeting_suite"
}
```

`process` is present only for implant-specific alerts. `marker` is normally
`!`; queued patches use `*`. Alert severity uses the same three values as
process state.

## Lifecycle

The game sends full replacement snapshots rather than partial deltas. It gates
live package pushes to an open dashboard session and stops them when:

- Darkflow sends `Darkwind.Window.Closed`;
- the player leaves the guild; or
- the guild soul is destroyed.

Opening `dashboard` again replaces the existing window with the same stable
window id.

## Client Safety

The renderer normalizes missing and malformed fields, clamps percentages, and
inserts server strings with DOM `textContent`. It does not interpret HTML from
process names, alert messages, target names, or firmware labels.
