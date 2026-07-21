# Darkwind.Lag GMCP Protocol Specification

`Darkwind.Lag` reports server-side driver health so Darkflow can distinguish a
slow network path from MUD heartbeat or event-loop delay.

## Support String

```text
Darkwind.Lag 1
```

## Messages

| Message | Direction | Purpose |
| --- | --- | --- |
| `Darkwind.Lag.Get` | Client -> Server | Request one current driver-health snapshot |
| `Darkwind.Lag.Status` | Server -> Client | Return the driver-health snapshot |

Darkflow polls every 15 seconds while connected, visible, enabled, and only
when the server has advertised `Darkwind.Lag` support.

## Darkwind.Lag.Get

The request carries no payload:

```text
Darkwind.Lag.Get
```

## Darkwind.Lag.Status

```json
{
  "uptime_s": 86400,
  "window_s": 60,
  "hb_interval_ms": 2000,
  "hb_drift_avg_ms": 4,
  "hb_drift_max_ms": 35,
  "hb_missed": 0,
  "cmds_per_sec_x100": 145,
  "lines_per_sec_x100": 820,
  "hb_processed_pct": 100,
  "obj_processed_pct": 100
}
```

| Field | Meaning |
| --- | --- |
| `uptime_s` | Seconds since the server health daemon started |
| `window_s` | Number of heartbeat samples in the current window |
| `hb_interval_ms` | Self-calibrated normal heartbeat interval |
| `hb_drift_avg_ms` | Average positive heartbeat drift |
| `hb_drift_max_ms` | Maximum positive heartbeat drift |
| `hb_missed` | Samples delayed more than the server threshold |
| `cmds_per_sec_x100` | Driver command rate multiplied by 100 |
| `lines_per_sec_x100` | Driver processed-line rate multiplied by 100 |
| `hb_processed_pct` | Relative heartbeat processing percentage |
| `obj_processed_pct` | Relative object processing percentage |

Darkflow combines this payload with `Core.Ping` RTT, an HTTP `/ping` probe,
browser event-loop drift, long-task observations, socket buffering, and recent
reconnects. `Darkwind.Lag.Status` alone is not interpreted as end-to-end
latency.
