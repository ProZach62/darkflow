# Darkwind.XPMon GMCP Protocol Specification

`Darkwind.XPMon` is the server-authoritative XP Monitor panel feed.

## Support String

```text
Darkwind.XPMon 1
```

Direction: `Server -> Client`

## Inactive Payload

```json
{ "active": 0 }
```

The panel displays an On button that sends the normal text command
`xpmon on`. XP Monitor controls are game commands, not GMCP responses.

## Active Payload

```json
{
  "active": 1,
  "xp": 12500,
  "gold": 3400,
  "elapsed_seconds": 900,
  "elapsed_minutes": 15,
  "xp_per_hour": 50000,
  "gold_per_hour": 13600,
  "started_at": 1784700000
}
```

| Field | Client behavior |
| --- | --- |
| `active` | Selects active or inactive panel state |
| `xp` | Total XP gained during the monitor session |
| `gold` | Total carried-plus-bank gold gained |
| `elapsed_seconds` | Formatted elapsed duration |
| `elapsed_minutes` | Accepted but not directly rendered |
| `xp_per_hour` | XP rate |
| `gold_per_hour` | Gold rate |
| `started_at` | Accepted server start timestamp; not directly rendered |

The active panel provides Reset and Off buttons that send `xpmon reset` and
`xpmon off` as normal commands. The entire payload replaces prior XP Monitor
state on each push.
