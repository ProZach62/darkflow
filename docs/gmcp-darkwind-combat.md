# Darkwind.Combat GMCP Protocol

`Darkwind.Combat 1` carries recipient-safe combat presentation data for
Darkflow's visual Combat pane. It complements the standard `Char` packages; it
does not replace combat authority or provide a second set of hit points.

The client advertises `Darkwind.Combat 1` only when the visual combat manager
and renderer are available. The server does not advertise this package back to
the client.

## Messages

| Message                  | Direction        | Purpose                                               |
| ------------------------ | ---------------- | ----------------------------------------------------- |
| `Darkwind.Combat.State`  | Server -> Client | Recoverable encounter lifecycle and actor snapshot    |
| `Darkwind.Combat.Events` | Server -> Client | Ordered, bounded batches of transient outcomes        |
| `Darkwind.Combat.Resync` | Client -> Server | Request current state without replaying stale effects |

## Readiness And Text Fallback

Advertising the package is necessary but is not permission to suppress combat
text. Darkflow also sends a fresh, explicit client subscription:

```json
{
  "features": {
    "combatPane": true
  }
}
```

`combatPane: true` means that the renderer is initialized and the only visual
combat surface is visible and able to present events. Darkflow sends
`combatPane: false` when that surface is closed, hidden, collapsed, disabled
by Zork-only mode, disconnected, or unable to render.

The server suppresses a routine swing for one recipient only after accepting
its corresponding event and only when every server-side eligibility gate
passes. Missing capability, stale or absent readiness, screenreader mode,
channel filters, queue failure, reconnect, and the operator kill switch all
fail open to the existing terminal text.

To bootstrap a hidden pane without creating a readiness deadlock, the server
may send an active State with `visual_enabled: true` and `effective: false`.
Darkflow opens the pane without stealing command focus, sends
`combatPane: true`, and requests a Resync. The swing that triggered that
bootstrap still appears as terminal text; suppression can begin only after the
fresh readiness update succeeds.

## `Darkwind.Combat.State`

State is a recoverable snapshot, not an animation command:

```json
{
  "epoch": "connection-7",
  "encounter_id": "encounter-12",
  "seq": 17,
  "visual_enabled": true,
  "effective": true,
  "active": true,
  "current_actor_id": "self",
  "current_target_id": "actor-2",
  "actors": [
    { "id": "self", "name": "Acer", "role": "self" },
    { "id": "actor-2", "name": "an ash drake", "role": "target" }
  ],
  "outcome": "",
  "summary": "Combat begins against an ash drake."
}
```

| Field               | Notes                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `epoch`             | Opaque connection epoch. A change invalidates all earlier encounter and event data.                                                                              |
| `encounter_id`      | Opaque, session-scoped encounter identity. It changes for a new target object even when the display name is unchanged.                                           |
| `seq`               | Latest sequence covered by the snapshot.                                                                                                                         |
| `visual_enabled`    | Saved character preference from `combatbrief visual`.                                                                                                            |
| `effective`         | Whether guarded visual presentation is currently effective.                                                                                                      |
| `active`            | Whether an encounter is active.                                                                                                                                  |
| `current_actor_id`  | Actor id staged on the left side. It is `self` while the recipient is fighting; a passive observer receives the stable identity of the actual combatant instead. |
| `current_target_id` | Actor id staged on the right side opposite `current_actor_id`. An observed pair retains the same orientation when its attack direction reverses.                 |
| `actors`            | Recipient-safe roster. IDs never expose LPC object paths.                                                                                                        |
| `outcome`           | Empty while active; final values may include `victory`, `defeat`, `fled`, `target-lost`, or `disconnected`.                                                      |
| `summary`           | Short accessible lifecycle summary.                                                                                                                              |

In observed group combat, the server may update `current_actor_id` as another
player acts against the same right-side focus without changing
`encounter_id`. This preserves pane position, history, and manual-close state
instead of presenting every group swing as a new encounter.

When `current_actor_id` is `self`, `Char.Vitals` remains authoritative for
player HP, `Char.Enemy` remains authoritative for the current target's HP,
condition, and art, and `Darkwind.Char.Avatar` remains authoritative for
player art. The sticky `Char.Status` snapshot supplies the recipient's race,
class, and gender as descriptor text under the player token, and maps that
race and gender pair to the bundled portrait used only while no avatar URL
is available or the generated portrait fails to load. A passive observer must not reuse those recipient-private
snapshots for somebody else's fight: actor names come from the State roster,
while health and art remain unavailable or use non-private placeholders.
Additional actor entries are compact context or threat indicators, not a
private-stat feed.

## `Darkwind.Combat.Events`

Events are transient and arrive in ordered, bounded batches:

```json
{
  "epoch": "connection-7",
  "encounter_id": "encounter-12",
  "first_seq": 18,
  "last_seq": 20,
  "events": [
    {
      "seq": 18,
      "kind": "attack",
      "perspective": "outgoing",
      "actor_id": "self",
      "target_id": "actor-2",
      "result": "critical",
      "damage": 42,
      "absorbed": 3,
      "summary": "You critically hit an ash drake for 42 damage."
    }
  ],
  "overflow": {
    "omitted": 0,
    "hits": 0,
    "damage": 0
  }
}
```

Version 1 uses `kind: "attack"` and the results `hit`, `critical`, `miss`,
`dodge`, and `absorb`. `perspective` is `outgoing`, `incoming`, or
`observed`. Numeric fields and numeric wording are omitted when the player's
existing `combatbrief damage` toggle is off.

Darkflow rejects events from an older epoch or encounter, ignores duplicate or
out-of-order sequence numbers, and bounds its presentation history. Overflow
is summarized instead of expanding into another combat log. Current HP and
State snapshots take priority over cosmetic event playback.

## `Darkwind.Combat.Resync`

Direction: `Client -> Server`

```text
Darkwind.Combat.Resync
```

An empty object is also valid:

```text
Darkwind.Combat.Resync {}
```

The server replies with the current `Darkwind.Combat.State` and refreshes the
authoritative `Char.Vitals`, `Char.Enemy`, and player-avatar snapshots. It does
not replay old attack animations. Darkflow requests this after reopening the
pane during an encounter and as part of a full handshake/subscription refresh.

## Pane And Accessibility Behavior

The existing `enemy` panel id is retained; the panel is titled Scene. It is a
persistent workspace panel (World group of the Panels menu) that shows the
player's figure in the current room, with the room's image as the backdrop
when the server has sent one. An active visual State turns it into the duel:
the opponent's token pops onto the stage with its name and health, and the
exchange line, threats, and history appear below. When the encounter ends the
opponent leaves the stage, the outcome lingers under the scene, and the panel
stays open for the next fight. A fight opens the panel if it is closed, under
Room Image when that panel is in the grid and to the right of the terminal
otherwise, without stealing command focus. Closing it during combat restores
server text fallback without changing the saved character preference; closing
it between fights simply hides the scene.

Between fights the scene also acts out what the player does: a `look` (or
`l`, `glance`) command makes the figure glance left and right and shade its
eyes, and a room change walks the figure in from the edge of the stage, facing
the way it travelled. The direction comes from the movement command the player
sent just before the room changed, or failing that from the previous room's
exits; westward and downward travel enters from stage right, everything else
from stage left. These play only on the idle scene and never during a fight,
and reduced motion suppresses them.

Both health bars expose progressbar semantics. Server-provided summaries feed
a rate-limited polite live region. Reduced-motion mode removes lunges, shakes,
flashes, moving damage numbers, and crossfades while preserving static outcome
badges and summaries.

Other players in the room stand in a band behind the scene while it is
idle: smaller, further back, in muted colours, unarmed, facing the player,
each named under its feet. They come from `Room.Players` and its add and
remove messages, so an arrival fades in and a departure fades out; the
band holds six and counts the rest as "+N". A fight clears the band and
the idle scene brings it back. Nothing but a name is known about another
player, so they draw as the initial-lettered silhouette; NPCs are not
listed by any package and do not appear.

## Canvas Stage

When the browser provides a 2D canvas, the Combat pane draws its stage on a
canvas: a backdrop that is the room's own image when a Darkwind.Room.Image
has arrived for the current room (the canonical terrain tile stands in until
it loads and takes over if it fails, or when the room has no art), two
procedural fighter figures whose heads are the player and target portraits,
and per-event effects (lunge,
slash arcs and burst for `hit`/`critical`, a whiff arc for `miss`, a sidestep
with afterimage for `dodge`, and a shield bubble for `absorb`). Damage numbers
and result badges are drawn on the canvas; names, health bars, condition text,
the current exchange, threats, history, and the live region stay in the DOM so
the accessibility contract above is unchanged.

The figures are drawn from a pose rig rather than image assets. The player's
wielded and worn items from `Char.Items` shape the figure: the main-hand
item's name picks the weapon (blade, knife, axe, blunt, polearm, staff, bow,
or bare hands when nothing is wielded), an off-hand item is drawn in the
left hand, a shield rides the left forearm, head armor draws a helmet, and
body armor thickens the torso. Weapon kind is a keyword heuristic over the
item name because the protocol carries no weapon type; an unrecognized name,
or no inventory yet, falls back to the guild's weapon. Race scales the body,
and NPC targets use a hunched beast form. Each event blends the actor
through windup and strike poses and the victim through recoil, dodge, or guard
poses; bows and staves add a projectile between the figures. Pose names are
the seam for future sprite sheets.

Bodies are shaded shapes rather than strokes: tapered limbs with an outline
and a shade band, a torso that is wider at the shoulders than the hips, boots,
hands, a belt, a cloak on humanoids and a tail on beasts that lag the body by
a spring. Legs are solved by inverse kinematics toward planted feet, so a
lunge moves the body while the rear foot stays put. Strikes anticipate, snap,
and hold; a landed blow freezes both figures for a beat (hit-stop), squashes
the victim, stretches the striker, draws a smear behind a melee swing, and
kicks dust at the victim's feet. Reduced motion removes all of it and leaves
the figures at rest.

When a sprite sheet is shipped for a figure kind (see
[combat-sprites.md](combat-sprites.md)), it replaces the procedural body
while weapons, shield, helmet, cloak, and the portrait head keep drawing on
top. A missing or invalid sheet falls back to the rig.

The stage plays each accepted event once, keyed by `seq` within the epoch and
encounter, and ignores repeated publishes of the same beat. Portraits come from
`Darkwind.Char.Avatar` and `Char.Enemy`; a failed image falls back to the
bundled player or NPC placeholder. The frame loop stops when the pane is
hidden, the tab is not visible, the encounter ends and no effect is still
playing, or the canvas leaves the document. Without canvas support the pane
renders the DOM card stage instead; readiness reporting is identical in both
modes.

### Sound and time of day

The stage names a sound for what it is about to show and hands it to the
pane, which plays it through the session's audio runtime in the `combat`
category, so the player's volume, mute, and category toggles apply. An attack
sounds by its result (`hit`, `critical`, `miss`, `dodge`, `absorb`)
at the moment the blow lands, not when the event arrives; a fight the player
is only watching is quieter. The start of a fight, a victory, and a death
sound once each, and a fight already under way when the pane first sees it
gets no start sound.

The game stays in charge of scoring: once the server has played any
`Darkwind.Sound` in the `combat` category on a connection, the stage stays
silent for the rest of it, so nothing doubles up. The player can also turn
the sounds off under Settings, Audio.

While the sky is known, the stage tints the room by `Darkwind.Sky`: amber at
dawn, violet at twilight, blue at night, lighter under more `moon_light`,
and nothing by day. The room's tint is baked into the cached backdrop and a
lighter pass covers the figures, so effects and numbers stay at full
brightness. Rooms whose terrain has no sky (`inside`, `underground`,
`underwater`) are left alone, and the tint can be turned off under
Settings, Appearance. The `moon_light` scale is not specified, so the stage
folds any positive value into a 0 to 1 lift with a saturating curve.

### The party and auras

Members of the player's `Group` whose `info.here` says they are in the room
stand behind the player, in the player's colours, facing the fight. Unlike
bystanders they stay while a fight is on. Each carries a health bar from
`info.hp` and `info.maxhp`, coloured by how hurt they are, and the leader is
starred. With room to spare, as on the idle scene where the player stands
mid-stage, they form a rank with name captions. In a fight the player stands
near the edge, so the rank recedes diagonally instead, each ally further
back, higher, and smaller, without captions; the initial on each head and
the bars carry it. At most four are drawn and the rest are counted. A party
member is never also drawn as a bystander, and bystanders take ground the
party is not standing on.

The player's `Char.Defences` show as glows on the ground under their feet:
warm for buffs, brighter with more of them up to four, and murky for
debuffs. Entries of kind `unknown` are ignored. A timed buff in its last ten
seconds makes the glow flicker, or shows a dashed ring when motion is
reduced. The server sends a countdown once, so the pane remembers when each
entry arrived and checks once a second. The idle scene settles to a still
frame, so at rest the glow is steady; it breathes and flickers while a fight
keeps the stage running.

### Bosses

The game appends `(BOSS)` to the name of every boss, as in "Aurora, Captain
of the Dawnbound (BOSS)", and that tag is what flags a boss fight; nothing
else in `Char.Enemy` or the combat roster marks one. A tagged enemy shows a
fixed gold Boss badge under its health. The tag is matched in any case and
with loose spacing, anywhere in the name, from `enemy_name` or, for a fight
the player is watching, from the roster.

In play the tag turned out to be part of how the game prints a boss, not part
of the name `Char.Enemy` and the roster carry, so the Scene also reads it off
the game text. Every name seen wearing the tag in the terminal this session
is a sighting (the scrollback is read when the Scene opens, so a boss
announced earlier still counts), and an enemy is a boss when its name matches
one: either name may be a run of whole words inside the other, so "Aurora"
matches "Aurora, Captain of the Dawnbound", but a single word must open or
close the longer name, so a plain "captain" does not. Sightings are not
stored; they last for the session.

The player can also flag an untagged enemy: while a fight against an NPC is
showing, a star under the enemy's health marks or unmarks it as a boss. Marks are kept per character in
`localStorage["darkflow-scene-bosses:<characterProfileId>"]` and compared
without the name's leading article, case, or spacing, so "A swamp troll" and
"the Swamp Troll" are one enemy.

The boss battle music that these marks once started is parked on the fork's
`boss-music-parked` branch until it is taken up again; for now a boss shows
its gold badge, or its gold star when marked, and nothing more.

The audio runtime's local loops can fade, which that music used and which
any loop may:
`loopLocal(category, sound, id, volume, { fadeInMs })` and
`stopLocal(category, id, { fadeOutMs })`, each at most ten seconds. A loop
that is fading out is already gone by ID, so the same ID can start again over
its tail, and it fades from wherever it is if it was stopped part way up. A
reset, a hidden page, or a disconnect cuts a tail at once.

### Low health, criticals, streaks, and the summary

From 35% of the player's health down, a red vignette closes in from the
edges, full at 10%, and the player's figure breathes harder and slower and
sags. While a fight keeps the stage running the vignette beats like a heart,
faster as things get worse; at rest, and with reduced motion, it holds
steady and the figure is still. The `alert/low-hp` sound plays once as health
drops through 25% in a fight and re-arms only after health recovers past
40%, so a fighter hovering at the line does not set it off repeatedly. It
follows the Alert volume, the Scene's sound setting, and the same rule as
the combat sounds: if the server has played an alert of its own on this
connection, the stage leaves alerts to it.

A critical that lands punches the camera in about the fighters by 5% and
whites the frame for an instant, on top of the longer hit-stop and larger
burst it already had. Neither happens with reduced motion.

The stage keeps what the DPS meter does not: damage taken, and runs of luck.
A hit streak is outgoing attacks landed in a row; an untouched streak is
incoming attacks that did not land; a fight the player is only watching
counts for neither. From three in a row a chip shows under the current
exchange. The model's history fills as events arrive while the stage
presents them a beat at a time, so the tally counts only as far as the beat
on show and a streak never appears ahead of the blows that made it.

When a fight ends, a summary card follows the outcome line. What the player
dealt, accuracy, best hit, criticals, time, and DPS come from the session's
DPS meter, so the card never disagrees with the DPS panel; damage taken and
the best streaks come from the stage's tally. Rows with nothing to report
are left out, and when the game sends no damage numbers the card shows no
confident zeroes. The card stays until the next fight begins.
