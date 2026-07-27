# Darkwind.Visual GMCP Protocol

`Darkwind.Visual 1` carries optional semantic cues for Darkflow's cosmetic
visual-effects layer. It never suppresses terminal text, changes gameplay, or
alters the separate `combatbrief visual` Combat pane.

Darkflow advertises the capability in `Core.Supports.Set`. Delivery is also
gated by the explicit `features.visualEffects` client subscription, which is
`true` only while the player's local **Game visual effects** setting is
enabled. The setting defaults to off.

The server sends only allowlisted semantic facts. Darkflow owns all CSS,
colors, timing, motion, and intensity clamping; messages cannot inject markup,
selectors, URLs, or arbitrary style values.

## Persistent world state

`Darkwind.Visual.State` describes the current world context:

```json
{
  "epoch": "connection-7",
  "seq": 18,
  "reason": "move",
  "planet": "markas",
  "terrain": ["desert", "outside"]
}
```

| Field | Notes |
| --- | --- |
| `epoch` | Opaque connection epoch. Changing it resets state sequence deduplication. |
| `seq` | Monotonic visual sequence within the epoch, shared with event delivery. |
| `reason` | One of `snapshot`, `move`, `wayshard`, or `refresh`. Only `wayshard`, emitted for accepted wayshard travel, triggers the transition. Ordinary `move` states update ambience without animating. |
| `planet` | Semantic planet identity. Darkflow recognizes `darkwind`, `dailos`, `markas`, and `tekal`. |
| `terrain` | Stable recognized canonical terrain tokens. Darkflow uses up to three and applies the same priority vocabulary as its map. |

The server emits `wayshard` after travel is accepted so the transition covers
the shard's dissolve and arrival. The destination's subsequent `move` state
updates ambience without restarting the transition.

The ambience remains until a newer accepted state arrives, the setting is
disabled, or the session ends. If a compatible server does not send
`Darkwind.Visual.State`, Darkflow uses normalized `Room.Info.planet` and
`Room.Info.terrain`/`environment` as a graceful fallback. Once authoritative
Visual state arrives in a session, it wins over that fallback.

## Transient events

The canonical batch message is `Darkwind.Visual.Events`. Darkflow also accepts
`Darkwind.Visual.Event` as a temporary singular compatibility alias for mixed
development builds.

```json
{
  "epoch": "connection-7",
  "first_seq": 42,
  "last_seq": 44,
  "events": [
    {
      "seq": 42,
      "kind": "damage",
      "perspective": "incoming",
      "cue": "impact",
      "intensity": 2
    },
    {
      "seq": 43,
      "kind": "damage",
      "perspective": "outgoing",
      "cue": "impact",
      "intensity": 1
    },
    {
      "seq": 44,
      "kind": "spell-cast",
      "perspective": "self",
      "cue": "cast",
      "school": "fire",
      "intensity": 3
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `epoch` | Opaque connection epoch. Changing it resets event sequence deduplication. |
| `seq` | Monotonic event sequence within the epoch. |
| `kind` | `damage` or `spell-cast`. |
| `perspective` | `incoming` or `outgoing` for damage; `self` for a successful spell cast. |
| `cue` | `impact` for damage and `cast` for spells. |
| `school` | For spells: `arcane`, `cold`, `divine`, `fire`, `healing`, `lightning`, `nature`, or `shadow` (with a small fixed alias set). |
| `intensity` | Integer from 1 through 3; Darkflow clamps out-of-range values. |

Darkflow maps incoming damage to a red edge vignette and restrained shake,
outgoing damage to a quick warm forward beat, and spells to school-specific
presentation. Fire raises animated flames around the lower and side edges,
cold briefly grows a translucent frost sheet and ice crystals over the screen,
and lightning sends a staggered set of electrical arcs across the display.
Other recognized spell schools retain their lighter school-colored flash.
These treatments are generated entirely with local HTML and CSS; spell events
do not carry image assets or presentation instructions.

Event batches are capped at 12, sequence-deduplicated, and independently
rate-limited by category. Fire, cold, and lightning use slightly longer local
lifetimes than the standard spell flash so their treatment can complete, but
they share the existing spell-event cooldown.

## Low-health state

Low health is derived locally from authoritative normalized `Char.Vitals`, not
from a visual event. While effects are enabled and the character is alive,
Darkflow shows a slow red edge pulse at `hp / maxhp <= 0.40`. It clears
immediately above 40%, at zero HP, on disable, disconnect, or session reset.
Partial vitals updates reuse the most recent valid HP or maximum.

## Builder previews

`Darkwind.Visual.Preview` lets an authorized server-side builder tool exercise
the presentation layer without changing character HP or authoritative room
state. Darkflow accepts only these exact payloads:

```json
{ "kind": "planet", "value": "tekal" }
{ "kind": "terrain", "value": "arctic" }
{ "kind": "low-health" }
{ "kind": "transition" }
{ "kind": "clear" }
```

| Kind | Allowed values or behavior |
| --- | --- |
| `planet` | `darkwind`, `dailos`, `markas`, or `tekal`. |
| `terrain` | `arctic`, `city`, `coast`, `desert`, `forest`, `inside`, `jungle`, `mountain`, `plains`, `road`, `swamp`, `underground`, `underwater`, or `water`. |
| `low-health` | Shows the low-health treatment without changing cached vitals. It takes no `value`. |
| `transition` | Replays the transition over the current world ambience without changing cached room state. It takes no `value`. |
| `clear` | Ends an active preview immediately and restores current authoritative presentation. It takes no `value`. |

Non-clear previews require the local **Game visual effects** setting to be
enabled and expire after a fixed client-owned five seconds. The server cannot
choose selectors, URLs, styles, or timing; extra presentation fields are
ignored, and unknown or incorrectly shaped `kind`/`value` pairs are rejected.
Planet and terrain previews temporarily replace only their rendered class.
Incoming `Darkwind.Visual.State` and `Char.Vitals` messages continue updating
their normal client models, and the newest real state is rendered when the
preview ends.

Preview state also clears on disable, page hiding, disconnect, and
`Darkwind.Session.Recovered`. Preview-only low-health and transition classes
are separate from their authoritative equivalents, so preview cleanup cannot
erase a real warning or movement transition.

## Accessibility and lifecycle

With `prefers-reduced-motion: reduce`, ambient drift, pulses, shake, lunge,
flame movement, frost growth, and moving electrical arcs are replaced by
restrained static tints. In forced-colors mode the cosmetic overlay is hidden.
The overlay is `aria-hidden`, never receives pointer input, and does not affect
game controls or terminal output.

Transient events are not replayed after reconnect. Hiding the page clears
active transient treatments. Disabling clears every rendered treatment but
keeps the latest normalized room and vitals context warm so re-enabling applies
the correct ambience and low-health state immediately. Disconnect and
`Darkwind.Session.Recovered` clear all cached presentation state; session
recovery also republishes the current `features.visualEffects` subscription.
