# Combatbrief Visual Combat Pane Plan

Status: Core implementation complete; rollout follow-ups remain

Prepared: 2026-07-25

Original planning snapshot:

- `darkwind-nextgen`: branch `v4.2.3`, commit `e5338f235`
- `play.darkwind.ai`: branch `main`, commit `dc919ca`

## Objective

Add an opt-in, saved player option:

```text
combatbrief visual
set combatbrief-visual on
set combatbrief-visual off
```

`visual` is a fifth, orthogonal boolean combatbrief setting. When it is off,
the existing text behavior applies; there is no separate `text` mode or value.
It does not replace, rename, reset, or reinterpret the four existing
combatbrief options:

```text
combatbrief short
combatbrief self
combatbrief hit
combatbrief damage
```

When visual mode is effective in a compatible Darkflow session, routine
per-swing combat prose no longer fills the terminal. Darkflow instead turns
the existing Enemy pane into a visual Combat pane showing the player, the
current target, authoritative health, hit/miss/dodge/block/critical feedback,
and a bounded summary of recent exchanges.

The mode must fail open to text. A saved preference alone is never enough to
suppress output.

## Required Player Behavior

### Command contract

- `combatbrief visual` toggles visual on or off, exactly like the four existing
  combatbrief toggles.
- `set combatbrief-visual on|off` provides the explicit saved-option form.
- `set` and `set list` show `combatbrief-visual` as `on` or `off`.
- `combatbrief` shows `Visual: Yes|No` plus the existing `short`, `self`,
  `hit`, and `damage` settings.
- Existing commands remain compatible and retain their current toggle
  behavior:
  - `combatbrief short`
  - `combatbrief self`
  - `combatbrief hit`
  - `combatbrief damage`
  - `set combatbrief-short <off|on>`
  - `set combatbrief-self <off|on>`
  - `set combatbrief-hit <off|on>`
  - `set combatbrief-damage <off|on>`
- Changing `combatbrief visual` changes only the new boolean slot. It must not
  change `short`, `self`, `hit`, or `damage`.
- Changing any of the four existing options must not change the saved
  visual option.
- Visual mode is opt-in. Existing and newly created characters default to
  text.

### Existing combatbrief modifiers in visual mode

The four existing settings remain independently saved and queryable whether
visual is on or off. Their established text behavior remains the fallback
authority.

| Setting | Visual-mode meaning |
| --- | --- |
| `short` | Retained for text fallback; it does not change the visual pane. |
| `self` | Hides third-party observed exchanges; attacks by or against the player still appear. |
| `hit` | Hides miss, dodge, and fully absorbed events just as the text path does today. |
| `damage` | Controls exact damage popups and numbers in accessible summaries. When off, the pane shows qualitative results only. |

### Effective-mode feedback

When the player selects visual mode:

- A ready Darkflow session reports that routine attacks will move to the
  Combat pane.
- An unsupported, negotiating, collapsed, or closed visual pane reports that
  the preference was saved but combat text will continue until a compatible
  pane is ready.
- Switching back to text takes effect immediately.
- Help text warns that terminal triggers, highlights, and client logs which
  depend on per-swing prose will not receive those replaced lines while visual
  mode is effective.

## Non-Negotiable Safety Contracts

Routine prose may be suppressed for a recipient only when all of these are
true:

1. The saved player preference is `visual`.
2. Screenreader mode is off.
3. The player is interactive and GMCP is active.
4. The connected client explicitly advertises `Darkwind.Combat 1`.
5. The current connection has sent a fresh, explicit
   `features.combatPane: true` subscription.
6. The relevant `attack-me`, `attack-opp`, or `attack-obs` channel is tuned on.
7. The structured event was successfully accepted by the presentation queue
   or coalesced into its bounded round summary.
8. The server-side visual suppression kill switch is enabled.

If any condition is false, the existing text path runs unchanged. In
particular:

- Telnet, Mudlet, old Darkflow releases, Zork-only mode, and other GMCP clients
  retain text.
- Linkdeath, takeover, character switching, GMCP restart, and reconnect clear
  visual readiness until the new connection subscribes again.
- Closing, hiding, or collapsing the only visual surface clears readiness and
  restores text for the current encounter.
- A queue rejection or presentation error cannot consume the original line.
- Screenreader combat summaries always take precedence over visual mode.
- Staff combat-number diagnostics and server combat-number logging remain
  available.

The server, not Darkflow, owns suppression. Darkflow currently receives plain
WebSocket text only after it has lost reliable combat semantics, and output
observers cannot cancel admitted lines. Regex-gagging combat in the browser
would be unsafe and would interfere with triggers and accessibility.

## Replacement Boundary

### Replaced in the first release

Only standard per-swing messages produced by
`codebase/secure/living.c::attack_write()`:

- outgoing attacks (`attack-me`);
- incoming attacks (`attack-opp`);
- nearby observed attacks (`attack-obs`);
- hit, critical, miss, dodge, and fully absorbed outcomes.

### Deliberately retained as terminal text

- boss telegraphs and room/NPC emotes;
- skill and spell activation, costs, cooldowns, and failures;
- status-effect warnings and dispels;
- death prose, flee notices, movement failures, and weapon breakage;
- loot, experience, quest, achievement, and reward output;
- prompts, errors, tells, chat, and staff diagnostics;
- any combat path which has not yet been converted to a structured semantic
  event.

Many abilities call `room_message()`, `tell_object()`, or `write()` directly.
Those general-purpose functions must never be globally muted. High-volume
abilities and damage-over-time sources can migrate later through a semantic
combat presentation helper, one audited family at a time.

## Current Repo Truth

### Mudlib

- `codebase/cmds/std/_combatbrief.c:3-30` accepts only `short`, `self`, `hit`,
  and `damage`.
- `codebase/cmds/std/_set.c:104-122,278-325,595-601` exposes those four values
  as independent on/off method options. `set combatbrief visual` is currently
  invalid.
- `codebase/secure/living.c:300-316,4102-4130` saves the four values in
  `combat_brief`; old three-slot saves are already normalized to add the
  default-on damage setting.
- The standard melee pipeline is
  `codebase/secure/living/combat.c:115-429` into
  `codebase/secure/living.c:3764-3958`.
- The three recipient branches, existing filters, combat-number logging, and
  screenreader interception all live in
  `codebase/secure/living.c:3903-3957`.
- `Char.Enemy` comes from
  `codebase/secure/daemons/telopt_d.c:1943-2000`. It supplies one current
  target, percentage health, a health description, SP percentage, and cached
  enemy art.
- Incoming client capabilities are cached by
  `codebase/secure/player/telopt.c:638-666`.
- `codebase/secure/daemons/telopt_d.c:149-195` deliberately treats a missing
  subscription map as broadly subscribed for legacy behavior. Combat readiness
  therefore needs its own strict check which returns false when no explicit
  subscription map exists.
- `gmcp_message()` returns success/failure and supports forced transient sends
  at `codebase/secure/player/telopt.c:1733-1843`.
- Reconnect/takeover replaces negotiated capability data but currently reuses
  pane subscriptions at `codebase/secure/player.c:3662-3685`; combat readiness
  must be cleared before that snapshot is restored.

### Darkflow

- The existing `enemy` pane is hidden by default, floating, sized 380 by 131,
  and on layer one in `public/js/panel-defs.js:15-18`.
- `public/js/panel-manager.js:1424-1539` already owns target normalization,
  auto-open, auto-close, geometry preservation, and stay-on-top behavior.
- `Char.Enemy` and `Char.Vitals.opponent` both feed the Enemy pane at
  `public/js/panel-manager.js:3089-3099,3305-3309`.
- The current renderer already has an in-place health update fast path, enemy
  art fallback behavior, and crossfade support at
  `public/js/panel-renderers.js:1412-1480` and
  `public/css/panels.css:1482-1512`.
- Player art is already supplied separately through
  `Darkwind.Char.Avatar` at `public/js/panel-manager.js:3330-3339`.
- Capability advertising is centralized in `public/js/gmcp.js:125-173`.
- Pane and feature subscriptions are built in
  `public/js/gmcp.js:32-47,187-203` and
  `public/js/panel-manager.js:300-323`.
- Plain game text reaches `appendOutput()` through
  `public/js/connection.js:696-708`; output line observers are notification
  hooks, not cancellation hooks.

## Target Architecture

```text
combat.c computes an outcome
        |
        v
living.c attack_write builds recipient perspective and applies existing filters
        |
        +--> visual predicate false ------> existing terminal text
        |
        +--> screenreader enabled --------> existing batched text summary
        |
        +--> visual predicate true
                 |
                 v
        COMBAT_PRESENTATION_D queues a recipient-safe event
                 |
                 v
        Darkwind.Combat.State / Darkwind.Combat.Events
                 |
                 v
        Darkflow combat visual manager
                 |
                 +--> existing enemy pane in visual Combat mode
                 +--> bounded animation/event ribbon
                 +--> pane-local accessible summary

Char.Vitals --------------------> authoritative player HP
Char.Enemy ---------------------> authoritative current-target HP and art
Darkwind.Char.Avatar -----------> authoritative player art
```

`COMBAT_PRESENTATION_D` is presentation infrastructure, not combat authority.
It must not alter hit chance, damage, targets, rewards, combat cadence, or
analytics.

## GMCP Contract

### Capability and readiness

Darkflow advertises:

```text
Darkwind.Combat 1
```

Darkflow includes this only when the combat manager and renderer are present.
It then sends an explicit feature subscription:

```json
{
  "features": {
    "combatPane": true
  }
}
```

`combatPane` means the pane is initialized and able to present events. It is
not a copy of the saved character preference.

The server must inspect the client-provided `Core.Supports` cache. It must not
add `Darkwind.Combat` to the server's outbound `Core.Supports.Set`; doing so
would make an unsupported client appear capable.

### `Darkwind.Combat.State`

This is a recoverable encounter snapshot, not an animation command.

```json
{
  "epoch": "opaque-connection-epoch",
  "encounter_id": "opaque-encounter-id",
  "seq": 17,
  "visual_enabled": true,
  "effective": true,
  "active": true,
  "current_target_id": "enemy-1",
  "actors": [
    { "id": "self", "name": "Acer", "role": "self" },
    { "id": "enemy-1", "name": "an ash drake", "role": "target" }
  ],
  "outcome": "",
  "summary": "Combat begins against an ash drake."
}
```

Rules:

- `epoch` changes on a new connection, takeover, or character switch.
- `encounter_id` changes even when a replacement target has the same display
  name.
- IDs are session-scoped and opaque; never send LPC object paths.
- `visual_enabled` is the saved boolean option; `effective` is the current
  fail-open result.
- `active: false` may include `outcome` such as `victory`, `defeat`, `fled`,
  `target-lost`, or `disconnected`.
- Actor names are recipient-safe display names.
- The current target's authoritative HP and art remain in `Char.Enemy`.
  `Char.Vitals` remains authoritative for the player.
- Additional attackers may be listed as roster entries or compact threat
  badges without exposing exact private stats.

### `Darkwind.Combat.Events`

Transient events are sent as bounded, ordered batches:

```json
{
  "epoch": "opaque-connection-epoch",
  "encounter_id": "opaque-encounter-id",
  "first_seq": 18,
  "last_seq": 20,
  "events": [
    {
      "seq": 18,
      "kind": "attack",
      "perspective": "outgoing",
      "actor_id": "self",
      "target_id": "enemy-1",
      "result": "hit",
      "damage": 42,
      "absorbed": 3,
      "summary": "You hit an ash drake for 42 damage."
    }
  ],
  "overflow": {
    "omitted": 0,
    "hits": 0,
    "damage": 0
  }
}
```

V1 results are `hit`, `critical`, `miss`, `dodge`, and `absorb`.

Rules:

- Use `refresh=1` so transient batches are never removed by the normal GMCP
  delta cache.
- Apply `self`, `hit`, and tuned-channel filters before queueing.
- Omit `damage`, `absorbed`, and numeric wording from `summary` when the
  recipient has combatbrief damage disabled.
- Batch the swings produced in one server cycle/round and cap retained detail.
  Coalesce overflow into totals rather than growing an unbounded queue.
- Never allow cosmetic backlog to delay current HP or state.
- State changes, target changes, death, flee, and encounter end are
  non-droppable.
- The initial release uses `kind: attack`; later semantic ability/status
  migrations may add `ability`, `status`, `death`, and `flee`.
- Client rendering uses `textContent` and validated numeric fields. Server
  strings must still be stripped of color/control codes and length-limited.

### Resynchronization

Add optional inbound:

```text
Darkwind.Combat.Resync
```

The server replies with a full `Darkwind.Combat.State`, `Char.Vitals`,
`Char.Enemy`, and player-avatar snapshot. It does not replay stale animations.
Control+K/full subscription refresh and reconnect use the same snapshot path.

## Server Implementation Plan

### 1. Add the saved visual option

- [ ] Extend the saved `combat_brief` array from four to five slots.
- [ ] Preserve indexes `0..3` exactly as `short`, `self`, `hit`, and `damage`;
  assign only index `4` to visual mode.
- [ ] Normalize old three-slot saves to
  `short,self,hit,damage=on,visual=off`.
- [ ] Normalize four-slot saves by appending `visual=off`.
- [ ] Make malformed or missing state default to text without disturbing the
  four existing values.
- [ ] Add `query_cmbt_brf("visual")` and
  `set_cmbt_brf("visual", value)`.
- [ ] Add a `_set.c` method option named `combatbrief-visual` with valid values
  `off|on`.
- [ ] Have the method option map `on` to the fifth slot and persist through the
  existing player save call.
- [ ] Ensure `set combatbrief-visual on|off` writes only slot four and that
  every existing combatbrief command writes only its historical slot.
- [ ] Update `_combatbrief.c` so `combatbrief visual` toggles the fifth slot
  and status output includes `Visual: Yes|No`, without changing the toggle
  behavior of the four old modifiers.

Likely files:

- `darkwind-nextgen/codebase/secure/living.c`
- `darkwind-nextgen/codebase/cmds/std/_set.c`
- `darkwind-nextgen/codebase/cmds/std/_combatbrief.c`

### 2. Add recipient-safe combat presentation infrastructure

- [ ] Add `COMBAT_PRESENTATION_D` to the shared daemon definitions.
- [ ] Give it small APIs for:
  - querying whether visual presentation is effective;
  - beginning/synchronizing an encounter;
  - accepting a standard attack outcome for one recipient;
  - ending or invalidating an encounter;
  - clearing session readiness/state;
  - returning operator counters and controlling the suppression kill switch.
- [ ] Keep nosave state per recipient: connection epoch, encounter ID, next
  sequence, current target, roster, bounded pending events, and overflow
  totals.
- [ ] Use opaque generated IDs rather than names or object paths.
- [ ] Cap event detail and coalesce repetitive swings. A reasonable initial
  target is no more than 32 retained transient records per recipient, with
  overflow reduced to hit/miss/damage totals.
- [ ] Return false when readiness/capability is absent, the channel is off, the
  queue cannot accept the event, or a GMCP send cannot be scheduled.
- [ ] Record aggregate counters only: visual events accepted, text fallbacks by
  reason, coalesced events, resyncs, and queue failures. Do not log combat
  payloads or player names per swing.

Likely files:

- `darkwind-nextgen/codebase/secure/daemons/combat_presentation_d.c`
- `darkwind-nextgen/codebase/secure/include/daemons.h`
- `darkwind-nextgen/codebase/secure/include/gmcp_defs.h`

### 3. Integrate at the structured attack boundary

- [ ] Refactor the active `attack_write()` calls to pass the actual target
  object, not only a target name. Use that object only for recipient-safe
  identity and encounter tracking.
- [ ] Preserve the current per-recipient order:
  1. combat-number file logging;
  2. `self`/`hit`/channel filters;
  3. screenreader batching;
  4. staff numeric diagnostic output;
  5. visual event acceptance;
  6. existing short/long terminal prose fallback.
- [ ] Continue to the next recipient only when visual event acceptance returns
  true.
- [ ] Leave the current text formatter intact as the fallback implementation.
- [ ] Do not move suppression into `catch_channel()`, `tell_object()`,
  `room_message()`, or Darkflow.

Likely files:

- `darkwind-nextgen/codebase/secure/living/combat.c`
- `darkwind-nextgen/codebase/secure/living.c`

### 4. Add GMCP capability, readiness, and snapshot handling

- [ ] Add a version-aware `query_supports_darkwind_combat()` which reads only
  the client-provided supports cache.
- [ ] Add a strict `query_gmcp_combat_ready()` which requires a real
  subscription mapping and `features.combatPane == true`.
- [ ] Do not reuse the legacy "missing subscriptions means all subscribed"
  fallback for combat suppression.
- [ ] Add send helpers for State and Events and an inbound Resync handler.
- [ ] On full subscription sync, send State plus required vitals/enemy/avatar
  snapshots when the client supports combat.
- [ ] Make `combatPane` readiness imply the avatar/enemy media snapshots needed
  by the visual pane, even when the separate Avatar pane is hidden.
- [ ] Trigger the existing asynchronous enemy image generation path when the
  current target has no cached image; immediately send a placeholder-capable
  State and let the existing late `Char.Enemy` refresh supply the art.
- [ ] Clear readiness and increment the connection epoch on linkdeath,
  takeover, switch, GMCP disable, new `Core.Hello`, and handshake reset.
- [ ] Ensure recovered sessions do not reuse the prior client's combat-pane
  subscription.

Likely files:

- `darkwind-nextgen/codebase/secure/daemons/telopt_d.c`
- `darkwind-nextgen/codebase/secure/include/gmcp_defs.h`
- `darkwind-nextgen/codebase/secure/player.c`
- `darkwind-nextgen/codebase/secure/player/telopt.c`
- `darkwind-nextgen/codebase/secure/daemons/image_d.c`

### 5. Wire encounter lifecycle

- [ ] Start State before the first accepted event.
- [ ] Update State when the current target changes, including same-named
  replacement objects.
- [ ] Track additional incoming attackers as compact roster/threat entries.
- [ ] Emit final State before combat cleanup or object destruction on death.
- [ ] End or resync encounters on flee, movement, `receive_stop_combat()`,
  `stop_all_combat()`, target loss, linkdeath, and reconnect.
- [ ] Keep non-replaced victory, defeat, flee, and death prose in the terminal
  during V1 even when a final visual state is also sent.
- [ ] Expire abandoned daemon state so NPC destruction and disconnected player
  objects cannot leak mappings.

Likely anchors:

- `darkwind-nextgen/codebase/secure/living.c:2019-2394`
- `darkwind-nextgen/codebase/secure/living.c:2474-2741`
- `darkwind-nextgen/codebase/secure/living.c:3720-3751`
- `darkwind-nextgen/codebase/secure/living/combat.c:952-980`

## Darkflow Implementation Plan

### 1. Keep one pane and one target authority

- [ ] Preserve panel ID `enemy`; do not create a competing `combat` panel.
- [ ] Keep the current compact Enemy renderer when visual is off.
- [ ] Dynamically title the pane `Combat` and use the visual renderer when
  State reports `visual_enabled: true`.
- [ ] Keep `Char.Enemy` authoritative for current-target HP, condition, and
  art.
- [ ] Keep `Char.Vitals` authoritative for player HP and
  `Darkwind.Char.Avatar` authoritative for player art.
- [ ] Use State only for encounter lifecycle/roster and Events only for
  transient presentation.
- [ ] Expand an untouched legacy 380 by 131 default on first visual activation,
  but never overwrite a player-resized pane. The visual renderer must also
  have a compact responsive layout for intentionally small panes.

Likely files:

- `play.darkwind.ai/public/js/panel-defs.js`
- `play.darkwind.ai/public/js/panel-manager.js`
- `play.darkwind.ai/public/js/panel-renderers.js`
- `play.darkwind.ai/public/css/panels.css`

### 2. Separate state reduction from DOM/animation

- [ ] Add `public/js/combat-visual-core.mjs` as a pure reducer for:
  - State normalization;
  - connection epoch and encounter reset;
  - sequence ordering and duplicate rejection;
  - bounded event queues;
  - burst coalescing;
  - stale cosmetic event dropping;
  - authoritative HP reconciliation;
  - reduced-motion selection.
- [ ] Add `public/js/combat-visual-manager.js` for GMCP handlers, pane
  lifecycle, timers, render health, mobile behavior, and animation scheduling.
- [ ] Initialize it beside `fishingManager` in `public/js/app.js`.
- [ ] Reset it on disconnect beside `fishingManager.handleDisconnect()` in
  `public/js/connection.js`.
- [ ] Advertise `Darkwind.Combat 1` only after this implementation exists.
- [ ] Send `combatPane: true` only after the visual renderer is initialized and
  visible; send false on close, hide, collapse, disconnect, or fatal render
  error.

### 3. Build the visual combat scene

- [ ] Show two responsive combatant cards:
  - player portrait/name/HP on the left;
  - current target art/name/condition/HP on the right.
- [ ] Reserve both art slots with bundled silhouettes so late images never
  shift layout.
- [ ] Crossfade successful late art; retain the placeholder on failure.
- [ ] Animate only current events:
  - lunge/impact for hit;
  - stronger flash and badge for critical;
  - offset/afterimage for dodge;
  - shield/ring for absorb;
  - miss trail for miss;
  - floating numbers only when damage is enabled.
- [ ] Show at most a small event ribbon or per-round tally, not a replacement
  wall of prose.
- [ ] Show additional attackers/participants as compact threat chips. The
  current `Char.Enemy` remains the staged opponent.
- [ ] Treat existing combat sounds as secondary cues only; they do not identify
  actors or carry authoritative outcomes.
- [ ] Do not make room art an MVP dependency. It may become an optional,
  blurred backdrop later.

### 4. Define pane lifecycle and fallback

- [ ] Auto-open without stealing keyboard focus when visual State becomes
  active.
- [ ] In visual mode, State owns start/end timing while `Char.Enemy` owns the
  target.
- [ ] On victory, defeat, flee, or target loss, retain the final frame for
  approximately 1.5 seconds, then hide if the pane was auto-opened.
- [ ] Cancel the linger timer when a new encounter begins.
- [ ] Save panel state only on real visibility/geometry changes, not on every
  HP packet.
- [ ] Closing, hiding, or collapsing the pane during an encounter sends
  `combatPane: false`, immediately restoring text fallback without changing
  the saved visual preference.
- [ ] Remember that manual close for the current encounter so the same State
  does not reopen it immediately. Auto-open again on the next encounter.
- [ ] Reopening during the same encounter sends ready true and requests a full
  State rather than replaying stale events.
- [ ] Promote Combat/Enemy into the primary mobile panel list and open the
  mobile sheet when visual combat begins.
- [ ] Zork-only mode always reports combatPane false.

### 5. Accessibility and motion

- [ ] Add semantic names and `role="progressbar"` with current/min/max values
  to both health bars.
- [ ] Add a pane-local polite live region using the server-provided summary,
  rate-limited to at most one combined announcement per presentation beat.
- [ ] Never depend on suppressed terminal lines for pane accessibility.
- [ ] Honor `prefers-reduced-motion` in both CSS and JavaScript.
- [ ] Reduced-motion mode removes lunges, shakes, flashes, floating movement,
  and crossfades; it updates static result badges and summaries immediately.
- [ ] Escape or assign all server text through `textContent`.
- [ ] Do not duplicate `combatbrief` in browser-local Darkflow settings.
  A future convenience control must send the in-game command and continue to
  treat server State as authoritative.

Likely additional files:

- `play.darkwind.ai/public/js/combat-visual-core.mjs`
- `play.darkwind.ai/public/js/combat-visual-manager.js`
- `play.darkwind.ai/public/css/combat-visual.css`
- `play.darkwind.ai/public/js/app.js`
- `play.darkwind.ai/public/js/connection.js`
- `play.darkwind.ai/public/js/gmcp.js`
- `play.darkwind.ai/public/index.html`

## Documentation Plan

Mudlib player documentation:

- [ ] `codebase/public/docs/helpdir/interface/combatbrief`
- [ ] `codebase/public/docs/helpdir/interface/set`
- [ ] `codebase/public/docs/helpdir/mechanics/combat`
- [ ] `codebase/public/docs/wiki/src/gameplay/interface.md`
- [ ] `codebase/public/docs/wiki/src/gameplay/combat.md`

Darkflow protocol documentation:

- [ ] Add `docs/gmcp-darkwind-combat.md`.
- [ ] Add the package to `docs/gmcp-darkwind-index.md`.
- [ ] Document `combatPane` and readiness semantics in
  `docs/gmcp-darkwind-client.md`.
- [ ] Document how State complements rather than replaces `Char.Enemy` in
  `docs/gmcp-char.md`.
- [ ] Document avatar/image dependencies and Resync behavior.
- [ ] Include exact State, Events, fallback, reconnect, close, and
  reduced-motion examples.

## Test Plan

### Mudlib focused tests

- [ ] Add a deterministic presentation test object covering:
  - old three-slot and four-slot save normalization;
  - exact visual on/off set values;
  - all 16 combinations of the existing short/self/hit/damage flags surviving
    visual off-to-on-to-off changes unchanged;
  - each existing combatbrief toggle surviving relogin without changing the
    visual option;
  - capability and explicit-readiness gates;
  - screenreader precedence;
  - channel, `self`, `hit`, and `damage` filtering;
  - attacker, defender, and observer perspectives;
  - opaque IDs and monotonically ordered sequences;
  - bounded queues and overflow coalescing;
  - failed enqueue returning to text;
  - connection epoch and encounter reset.
- [ ] Add `tests/combat/combatbrief-visual.yaml` for real command/GMCP/output
  integration.
- [ ] Keep existing per-swing text assertions as the unsupported-client
  regression baseline.
- [ ] Add multi-swing, multi-target, party observer, PvP, flee, movement,
  death, linkdeath, takeover, and reconnect coverage.
- [ ] Add high-volume validation proving event batching does not trigger GMCP
  large-payload or lost-output warnings.

### Darkflow unit and DOM tests

- [ ] Add `test/combat-visual-core.test.mjs` for epoch/encounter resets,
  sequence/deduplication, stale-event rejection, queue bounds, coalescing,
  reduced motion, and HP reconciliation.
- [ ] Add manager tests for:
  - mode state and capability negotiation;
  - auto-open without focus theft;
  - end linger and cancellation;
  - close/collapse readiness fallback;
  - reconnect and Resync;
  - same-name target replacement;
  - late/failed player and enemy art;
  - mobile activation;
  - renderer failure clearing readiness.
- [ ] Extend `test/panel-manager-layout.test.mjs` for the visual Enemy/Combat
  dual mode and default-size-only expansion.
- [ ] Add renderer tests for hostile strings, placeholders, accessible health
  bars, compact layout, and reduced-motion static state.
- [ ] Update the GMCP documentation test fixtures. The current suite checks
  advertised support strings and package documentation.

### Static validation

Mudlib:

```text
./tools/lpc-check \
  codebase/cmds/std/_set.c \
  codebase/cmds/std/_combatbrief.c \
  codebase/secure/living.c \
  codebase/secure/living/combat.c \
  codebase/secure/daemons/combat_presentation_d.c \
  codebase/secure/daemons/telopt_d.c \
  codebase/secure/player.c \
  codebase/secure/player/telopt.c

git diff --check
```

Darkflow:

```text
npm test
git diff --check
```

### Acceptance matrix

| Scenario | Expected terminal | Expected pane |
| --- | --- | --- |
| Darkflow, visual off | Existing combat prose | Existing compact Enemy pane |
| Darkflow, visual mode, ready pane | Routine swing prose absent; semantic text retained | Visual Combat pane |
| Darkflow, visual saved, pane closed/collapsed | Routine prose resumes | Hidden/collapsed until reopened or next encounter |
| Darkflow reconnect before fresh subscription | Routine prose resumes | No stale animation; snapshot after ready |
| Old Darkflow or unsupported GMCP client | Existing combat prose | No visual contract assumed |
| Plain telnet client | Existing combat prose | Not applicable |
| Screenreader enabled with visual saved | Existing batched screenreader summaries | Optional static pane; never required |
| Reduced-motion Darkflow | Routine prose suppressed only while ready | Static badges/summaries, no motion |
| Multi-target fight | Current-target prose replaced; retained semantic text remains | Current target staged, other threats compact |
| Skill/spell not yet migrated | Its existing prose remains | Standard swings still visualized |

## Phased Delivery

### Phase 0: Lock the contract

- [ ] Approve the exact command semantics, replaced-message boundary, payload
  schema, close/collapse fallback, screenreader priority, and kill switch.
- [ ] Add fixtures for the State and Events payloads before implementation.

Exit gate: both repos have the same versioned contract and no unanswered
condition can leave a player without text or a working pane.

### Phase 1: Ship Darkflow capability without suppression

- [ ] Implement the core, manager, dual-mode pane, accessibility, mobile
  behavior, documentation, and tests against fixtures.
- [ ] Advertise `Darkwind.Combat 1` and explicit readiness only in the release
  containing the complete renderer.

Exit gate: fixture-driven client tests pass, the pane can be opened/closed and
resynchronized safely, and older servers remain unaffected.

### Phase 2: Dual-emit server events while retaining text

- [ ] Add setting persistence, daemon infrastructure, capability gates,
  lifecycle snapshots, and structured attack events.
- [ ] Keep the global suppression kill switch off.
- [ ] Staff-test event/text parity and measure coalescing, ordering, payload
  sizes, image latency, and reconnect behavior.

Exit gate: every standard swing visible in terminal text has the intended
recipient-safe event or an explicit, measured fallback reason.

### Phase 3: Enable guarded suppression

- [ ] Enable the kill switch for staff/test characters first.
- [ ] Confirm text disappears only after a successful event acceptance.
- [ ] Exercise the full acceptance matrix with live PvE, PvP, party,
  multi-target, mobile, reduced-motion, and screenreader sessions.
- [ ] Expand gradually to all opt-in players.

Exit gate: no silent-combat cases, lost-output warnings, unbounded queues, or
cross-client regressions occur during the observation window.

### Phase 4: Migrate selected high-volume abilities

- [ ] Add a semantic `combat_message(...)` or presentation-event helper.
- [ ] Audit real telemetry for the highest-volume skills, AoE, and DoT paths.
- [ ] Convert one shared family at a time, retaining text until structured
  parity tests pass.
- [ ] Never convert boss telegraphs or actionable warnings without a
  non-droppable pane representation and accessible summary.

Exit gate: each converted family has explicit text fallback and independent
tests; general-purpose room/tell output remains untouched.

### Phase 5: General rollout and cleanup

- [ ] Publish player-facing help and release notes.
- [ ] Monitor fallback reasons, queue overflow, GMCP payload size, pane errors,
  and support/readiness rates.
- [ ] Tune visual pacing only after correctness and output safety are stable.

Exit gate: visual is a supported opt-in presentation option, the existing text
path remains complete when visual is off or unavailable, and the kill switch
can restore text without changing player saves.

## Rollback Plan

1. Disable the server suppression kill switch. All affected players return to
   text immediately while their saved preference remains intact.
2. Leave structured dual emission available for diagnosis, or disable it
   independently if transport pressure is suspected.
3. A Darkflow rollback is safe because absence of advertised support/fresh
   readiness forces text.
4. A mudlib rollback treats the extra saved visual slot as inert; existing
   short/self/hit/damage values remain intact.
5. Do not rewrite player saves during rollback.

## Definition of Done

- [ ] `combatbrief visual` and `set combatbrief-visual on|off` persist correctly
  across relogin.
- [ ] All existing `short`, `self`, `hit`, and `damage` commands, saved values,
  defaults, and text behavior remain backward compatible.
- [ ] Toggling visual never resets any existing combatbrief option, and
  toggling an existing option never resets visual.
- [ ] No client can lose routine combat text without both negotiated support
  and fresh visual readiness.
- [ ] The existing Enemy pane becomes a responsive, accessible Combat pane only
  while visual mode is active.
- [ ] Player/target HP and art stay synchronized through existing authoritative
  channels.
- [ ] Standard attacks produce ordered, bounded visual events with correct
  recipient perspective.
- [ ] Existing combatbrief filters retain their documented meaning.
- [ ] Screenreader, unsupported-client, reconnect, closed-pane, and queue-error
  paths all fall back to text.
- [ ] Death, flee, boss, reward, error, and other non-replaced semantic output
  remains in the terminal.
- [ ] Client and mudlib unit/integration suites pass.
- [ ] Live PvE, PvP, party, multi-target, mobile, reduced-motion, reconnect,
  and rollback acceptance passes.
- [ ] Staff can disable suppression immediately without editing player saves.
