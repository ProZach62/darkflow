# Darkwind.GuildVitals GMCP Protocol Specification

`Darkwind.GuildVitals` supplies guild-specific resources and states for the
Guild Vitals panel. Darkflow advertises version 2 and remains compatible with
the version 1 meter format.

## Support String

```text
Darkwind.GuildVitals 2
```

Direction: `Server -> Client`

## Version 2 Payload

```json
{
  "items": [
    {
      "id": "street_samurai.heat",
      "guild": "Street Samurai",
      "label": "Heat",
      "kind": "meter_reverse",
      "cur": 35,
      "max": 100,
      "pct": 35,
      "severity": "warn",
      "tip": "Higher heat is more dangerous."
    }
  ]
}
```

Every item requires a stable `id` and display `label`. `guild` groups rows
under section headers when more than one guild is present. `tip` becomes the
row tooltip. `severity` may be `ok`, `warn`, or `danger` and colors applicable
non-meter indicators.

## Item Kinds

| Kind | Fields | Rendering |
| --- | --- | --- |
| `meter` | `cur`, `max`, optional `pct` | Normal resource bar |
| `meter_reverse` | `cur`, `max`, optional `pct` | Danger-when-full reverse meter |
| `boolean` | `on` | Labeled LED state |
| `flags` | `flags[]` | Ordered labeled flag chips |
| `state` | `value`, optional `display` | State badge; `display` falls back to `value` |
| `counter` | `cur`, `max` | Up to 12 filled/empty pips |
| `cooldown` | `remaining`, optional `max` | Duration text and optional remaining-time bar |

Flag entries use `{ "label": "A", "on": true, "tip": "..." }`. Invalid
items, unknown kinds, meters with non-numeric values, and meters with a
non-positive maximum are ignored. Rows update by `id`, and rows omitted from a
new snapshot are removed.

The `street_samurai.heat` item has a dedicated low-to-high heat color ramp.
Other reverse meters use the generic danger-when-full ramp.

## Version 1 Compatibility

Version 1 servers send:

```json
{
  "bars": [
    {
      "id": "guild.resource",
      "guild": "Example Guild",
      "label": "Resource",
      "cur": 5,
      "max": 10,
      "pct": 50,
      "kind": "warning"
    }
  ]
}
```

`bars` entries are treated as meters. `kind: "warning"` maps to a reverse
meter; other or missing kinds map to a normal meter. Darkflow accepts either
`items` or `bars`, preferring `items` when both are present.
