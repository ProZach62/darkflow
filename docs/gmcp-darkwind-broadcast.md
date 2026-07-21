# Darkwind.Broadcast GMCP Protocol Specification

`Darkwind.Broadcast` displays a temporary high-priority announcement overlay.

## Support String

```text
Darkwind.Broadcast 1
```

## Darkwind.Broadcast.Show

Direction: `Server -> Client`

```json
{
  "title": "World Event",
  "sender": "Darkwind",
  "message": "The city gates are now open.",
  "durationMs": 12000
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | string | Yes | Trimmed display text; an empty value closes the current broadcast |
| `title` | string | No | Defaults to `Broadcast` |
| `sender` | string | No | Defaults to `Darkwind` |
| `durationMs` | number | No | Display duration; defaults to 10,000 ms and is clamped to at least 1,000 ms |

The overlay is an assertive live region and has a manual Close button. A newer
broadcast replaces the current content and timer; an older timer cannot close
a newer message.
