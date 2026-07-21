# Group And Game GMCP Protocol Support

Darkflow advertises `Group 1` and `Game 1`. Both use root package messages
rather than subpackage messages.

## Group

Direction: `Server -> Client`

```json
{
  "groupname": "Expedition",
  "leader": "Nacho",
  "count": 2,
  "members": [
    {
      "name": "Nacho",
      "info": {
        "hp": 420,
        "maxhp": 500,
        "sp": 180,
        "maxsp": 220,
        "lvl": 50,
        "here": "Yes"
      }
    }
  ]
}
```

Darkflow renders `groupname`, `leader`, `count`, and `members`. Each member uses
`name` plus `info.hp`, `info.maxhp`, `info.lvl`, and `info.here`; SP fields are
retained even though the compact panel currently renders only the HP bar.

The GMCP normalizer applies the same vital aliases used by `Char.Vitals` to
each member's `info` object. A missing group, an empty string, or an object with
no members renders the not-in-a-group state.

## Game

Direction: `Server -> Client`

```json
{
  "game_name": "Darkwind",
  "game_version": "4.2.2",
  "game_uptime": 86400,
  "game_reboot": 0
}
```

| Field | Client behavior |
| --- | --- |
| `game_name` | Updates the browser title while keeping Darkflow as the visible client brand |
| `game_version` | Displays the server version in the status bar |
| `game_uptime` | Formats seconds as days, hours, minutes, and seconds |
| `game_reboot` | Accepted as part of the standard payload but not currently rendered |

Unknown fields remain available through the GMCP debug panel, wildcard event
handler, and live GMCP variable registry.
