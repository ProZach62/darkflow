# Darkwind.Fishing GMCP Protocol Specification

`Darkwind.Fishing` drives Darkflow's interactive fishing pane. The server owns
the session, fish selection, validation, and rewards. The client runs the
real-time fight simulation from server parameters and reports its result.

## Support String

```text
Darkwind.Fishing 1
```

## Message Flow

| Message | Direction | Purpose |
| --- | --- | --- |
| `Darkwind.Fishing.Open` | Server -> Client | Open or reset a fishing session |
| `Darkwind.Fishing.Cast` | Client -> Server | Submit cast power |
| `Darkwind.Fishing.Bite` | Server -> Client | Start the hook-response window |
| `Darkwind.Fishing.Hook` | Client -> Server | Attempt to hook during that window |
| `Darkwind.Fishing.Fight` | Server -> Client | Start the deterministic reel fight |
| `Darkwind.Fishing.Result` | Client -> Server | Report the simulated outcome and measurements |
| `Darkwind.Fishing.Caught` | Server -> Client | Report the caught fish and rewards |
| `Darkwind.Fishing.Escaped` | Server -> Client | Report a failed attempt |
| `Darkwind.Fishing.Art` | Server -> Client | Supply late-generated species art |
| `Darkwind.Fishing.Cancel` | Client -> Server | End the current session |
| `Darkwind.Fishing.End` | Server -> Client | Close the session with an optional reason/message |

All session-bound messages carry the opaque `session` nonce from `Open`.
Messages for a different session are ignored by the client and server.

## Open And Cast

```json
{
  "session": "f-12ab34cd",
  "terrain": "lake",
  "skill": 250,
  "poleTier": 1,
  "baitTier": 2,
  "baited": true,
  "sceneArtUrl": "https://example.invalid/lake.png"
}
```

Darkflow opens the Fishing panel and begins the cast-power interaction. On
release it sends a value from 0 through 100:

```text
Darkwind.Fishing.Cast {"session":"f-12ab34cd","power":72}
```

## Bite And Hook

```json
{
  "session": "f-12ab34cd",
  "windowMs": 2500,
  "tease": "large"
}
```

The player must click, tap, or press Space before `windowMs` expires. Darkflow
sends:

```text
Darkwind.Fishing.Hook {"session":"f-12ab34cd"}
```

## Fight And Result

```json
{
  "session": "f-12ab34cd",
  "seed": 123456,
  "params": {
    "strength": 7,
    "erratic": 6,
    "stamina": 110,
    "barSize": 20,
    "progressRate": 9,
    "drainRate": 11,
    "tensionRise": 17,
    "tensionDecay": 12,
    "minFightMs": 6000
  },
  "fish": {
    "tease": "large",
    "rarityHint": "Rare",
    "artUrl": null
  }
}
```

The seed and parameters initialize the local simulation. On completion,
Darkflow sends:

```json
{
  "session": "f-12ab34cd",
  "outcome": "caught",
  "fightMs": 8450,
  "accuracy": 0.873,
  "tensionPeak": 71
}
```

`outcome` is `caught`, `snap`, or `slack`. The server validates timing and
measurement bounds before granting a catch.

## Caught, Escaped, Art, And End

```json
{
  "session": "f-12ab34cd",
  "fish": {
    "id": "silverfin",
    "name": "Silverfin",
    "short": "a pristine silverfin",
    "rarity": "Rare",
    "sizePct": 82,
    "sizeCm": 74,
    "weightKg": 13,
    "quality": 91,
    "pristine": true,
    "artUrl": null
  },
  "rewards": {
    "skillup": true,
    "newSkill": 251,
    "reagent": { "name": "fish scales", "amount": 1 }
  }
}
```

`Darkwind.Fishing.Escaped` carries `session` and `reason`, commonly `timeout`,
`snap`, `slack`, or `implausible`. Late artwork is:

```json
{
  "species": "silverfin",
  "artUrl": "https://example.invalid/silverfin.png"
}
```

`Darkwind.Fishing.End` carries `session`, `reason`, and optional `message`.
Closing the panel sends `Darkwind.Fishing.Cancel {"session":"..."}` before the
client clears local session state.
