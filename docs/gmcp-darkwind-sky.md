# Darkwind.Sky GMCP Protocol Specification

This document specifies the `Darkwind.Sky` package used by Darkflow's Sky
panel. The server sends occasional authoritative time and lunar snapshots; the
client animates locally between snapshots.

## Support Declaration

Clients that render the Sky panel advertise:

```json
["Darkwind.Sky 1"]
```

## Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Sky` | Server -> Client | Replace the current sky/time/lunar sync payload |

## Darkwind.Sky

The payload is sent when the `sky` panel is subscribed, immediately on full
subscription snapshots and when the panel is opened, then periodically while it
remains subscribed.

```json
{
  "server_time": 1778170000,
  "game_now": 10240000,
  "day_since_beginning": 427,
  "sync_interval": 60,
  "time_of_day": "day",
  "scale": {
    "second": 1,
    "minute": 20,
    "hour": 1200,
    "day": 24000,
    "week": 240000,
    "month": 720000,
    "year": 7200000
  },
  "time": {
    "year": 2,
    "month": 4,
    "month_name": "Tarsakh",
    "week": 1,
    "day": 3,
    "date": 3,
    "day_name": "Seaday",
    "day_of_year": 93,
    "hour": 12,
    "minute": 0,
    "second": 0,
    "season": "spring"
  },
  "almanac": {
    "sunrise": [5, 0],
    "morning": [6, 0],
    "twilight": [16, 0],
    "sunset": [17, 0]
  },
  "moons": [
    {
      "id": "dailos",
      "name": "Dailos",
      "description": "magenta moon",
      "cycle_days": 3.75,
      "phase": 5,
      "phase_name": "full"
    }
  ],
  "moon_light": 4
}
```

### Client Interpolation

The client computes the current game time as:

```text
payload.game_now + elapsed_real_seconds_since_payload_received
```

It uses `scale` and `almanac` to derive the current clock, sky phase, sun
position, and moon phase. The server remains authoritative; the next
`Darkwind.Sky` payload corrects any local drift.
