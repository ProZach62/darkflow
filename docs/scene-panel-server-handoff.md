# Scene Panel Server Handoff

## Goal

Darkflow's Scene panel presents the current room between fights and becomes an
animated combat stage during an encounter. To expand it with accurate NPCs,
equipment, movement, abilities, conditions, and environmental effects, the
client needs recipient-safe information from the game server.

The required information should extend the existing protocol boundaries:

```text
Room.Info + Darkwind.Room.Occupants
        room and visible activity
                    |
                    v
              Scene panel
                    ^
                    |
Darkwind.Combat.State + Darkwind.Combat.Events
       encounter actors and actions
```

A separate Scene-specific GMCP package is not currently necessary.

## First Step: Reuse Information Already Available

The server-side room work already defines most of the information needed to
improve the idle Scene:

- `Darkwind.Room.Occupants 1` supplies visible players, NPCs, pets, appearance,
  activity, equipment, factions, anchors, and engagement information.
- `Room.Info.looks` supplies visible scenery and interactable objects.
- `Room.Info.scene` supplies time, weather, and lighting.
- `Room.Info.exit_details` supplies typed exits.

The Scene client currently uses `Room.Players` for name-only player
silhouettes. It does not yet use the richer occupant snapshot, room looks, or
the complete room scene metadata. Wiring those existing payloads into Scene is
client work and does not require new server information.

See `isometric-room-server-handoff.md` and
`gmcp-darkwind-room-occupants.md` for those payloads.

## Rich Combat Actor Presentation

`Darkwind.Combat.State.actors` currently carries only `id`, `name`, and
`role`. Add optional appearance, visible equipment, and public state to each
actor.

```json
{
  "id": "actor-2",
  "name": "an ash drake",
  "role": "target",
  "appearance": {
    "race": "drake",
    "family": "dragon",
    "gender": "unknown",
    "size": "large",
    "form": "beast",
    "sprite": "ash-drake",
    "portrait": "https://example.invalid/ash-drake.png"
  },
  "equipment": {
    "main_hand": "iron longsword",
    "off_hand": "",
    "weapon_type": "sword",
    "weapon_style": "slash",
    "two_handed": 0,
    "shield": "round-shield",
    "helmet": "iron-helm",
    "armor": "chainmail"
  },
  "public_state": {
    "condition": "wounded",
    "hp_percent": 38,
    "stance": "aggressive",
    "effects": ["burning"],
    "faction": "Ashen Brood",
    "elite": 0,
    "boss": 1,
    "position": { "x": 72, "y": 48 },
    "engaged_with": "self"
  }
}
```

### Appearance fields

| Field      | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `race`     | Specific race used for sprite and body selection.                     |
| `family`   | Broader fallback family, such as `human`, `dragon`, or `arachnid`.    |
| `gender`   | Visible gender when applicable to available character artwork.        |
| `size`     | Public size category used to scale the actor.                         |
| `form`     | Broad body form, such as `humanoid`, `beast`, `serpent`, or `spirit`. |
| `sprite`   | Stable optional artwork key. Unknown keys use normal fallbacks.       |
| `portrait` | Optional approved portrait URL.                                       |

### Equipment fields

| Field          | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `main_hand`    | Short visible item or appearance identifier.                      |
| `off_hand`     | Short visible item or appearance identifier.                      |
| `weapon_type`  | Typed category such as `sword`, `axe`, `bow`, `staff`, or `claw`. |
| `weapon_style` | Animation style such as `slash`, `thrust`, `smash`, or `cast`.    |
| `two_handed`   | Whether the visible weapon occupies both hands.                   |
| `shield`       | Visible shield type or empty when none is visible.                |
| `helmet`       | Visible helmet type or empty when none is visible.                |
| `armor`        | Visible body armor type or empty when none is visible.            |

These fields should describe what the recipient can see, not expose complete
equipment records or private inventory data.

### Public state fields

| Field          | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `condition`    | Existing player-facing condition label.                                     |
| `hp_percent`   | Optional recipient-safe percentage; omit when the recipient cannot know it. |
| `stance`       | Visible stance such as `idle`, `guarded`, `aggressive`, or `casting`.       |
| `effects`      | Visible public effects only.                                                |
| `faction`      | Player-visible faction label.                                               |
| `elite`        | Explicit elite marker.                                                      |
| `boss`         | Explicit boss marker.                                                       |
| `position`     | Optional `{x,y}` stage percentage used to form ranks or clusters.           |
| `engaged_with` | Stable actor ID of the visible current opponent.                            |

This replaces several unreliable client guesses. The current client infers
weapons from item-name keywords, guesses NPC body forms, supplies guild
fallback weapons, and discovers bosses from terminal text or local marks.

## Rich Combat Events

`Darkwind.Combat.Events` version 1 supports only `kind: "attack"`. A newer
version should use a discriminated event union so Scene can accurately depict
abilities and changes that are not ordinary weapon attacks.

Recommended event kinds:

- `attack`
- `skill`
- `spell`
- `heal`
- `effect`
- `move`
- `interrupt`
- `death`
- `summon`
- `despawn`
- `emote`

Example spell event:

```json
{
  "seq": 24,
  "kind": "spell",
  "perspective": "incoming",
  "actor_id": "actor-2",
  "target_id": "self",
  "targets": ["self", "ally-4"],
  "ability_id": "spell:fireball",
  "ability_name": "Fireball",
  "damage_type": "fire",
  "projectile": "fire-orb",
  "result": "hit",
  "amount": 42,
  "absorbed": 3,
  "effect": "burning",
  "duration": 6,
  "from_position": { "x": 72, "y": 48 },
  "to_position": { "x": 28, "y": 55 },
  "summary": "The ash drake hurls a fireball at you."
}
```

### Common event fields

| Field                          | Meaning                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `ability_id`, `ability_name`   | Stable identity and player-facing name of a skill or spell.         |
| `weapon_type`, `weapon_style`  | Weapon and motion used for this event.                              |
| `damage_type`                  | Damage presentation type such as `fire`, `cold`, or `physical`.     |
| `projectile`                   | Optional safe projectile/effect artwork key.                        |
| `targets`                      | Stable actor IDs affected by a multi-target action.                 |
| `amount`, `absorbed`           | Recipient-safe numeric outcome, respecting combatbrief preferences. |
| `effect`, `duration`           | Visible status change and optional public duration.                 |
| `from_position`, `to_position` | Stage movement for charges, knockback, retreat, or teleportation.   |
| `summary`                      | Short accessible description suitable for the Scene live region.    |

Existing epoch, encounter, sequence, ordering, overflow, resync, and text
fallback rules should continue to apply. Version 1 clients must continue to
receive events they can safely understand or fall back to combat text.

## Authoritative Activity Outside Combat

The idle Scene currently infers the player's movement and look animations from
outbound commands and room changes. To animate all visible actors reliably,
the server should eventually publish recipient-visible activity events.

Useful activities include:

- entering, leaving, or moving to a position
- looking at or interacting with a room object
- sitting, sleeping, guarding, working, wandering, or patrolling
- speaking or emoting
- picking up, dropping, opening, or using a visible object

Each event should include a stable actor ID, activity kind, optional target ID
or `Room.Info.looks[].id`, and optional destination. These events may extend
`Darkwind.Room.Occupants` in a later protocol version rather than creating an
unrelated package.

## Optional Effect and Audio Hints

Events may include stable presentation hints:

```json
{
  "effect": "fire-burst",
  "sound": "combat/fire-impact",
  "impact_position": { "x": 65, "y": 42 }
}
```

These are hints only. Unknown values must be ignored safely. The server remains
authoritative for sound, and the client must continue to avoid playing a local
duplicate after server-driven combat sound has been observed.

## Visibility and Security Requirements

All Scene data must be generated separately for each recipient and follow the
same visibility and permission rules as normal game output.

- Use stable opaque IDs; never expose LPC object paths or clone names.
- Do not expose invisible, concealed, hidden, or undiscovered actors or items.
- Do not expose private inventories or equipment the recipient cannot see.
- Prefer condition labels or permitted percentages over exact private HP.
- Include only visible statuses, activities, targets, and ability information.
- Respect darkness, blindness, perception, disguise, and similar mechanics.
- Continue respecting `combatbrief damage` when deciding whether to include
  numeric combat outcomes.
- Keep accessible `summary` text recipient-safe as well as the structured data.

## Recommended Implementation Order

1. Client: feed the existing `Darkwind.Room.Occupants` and richer `Room.Info`
   data into Scene.
2. Server: add optional actor appearance and typed visible equipment to
   `Darkwind.Combat.State`.
3. Server: add public condition, stance, boss, position, and engagement state.
4. Protocol: introduce versioned combat event kinds for skills, spells,
   healing, effects, movement, death, and summons.
5. Server: publish authoritative visible activity events outside combat.
6. Optionally add stable visual-effect and sound hints.

Every new field should be optional and versioned so current Darkflow clients
retain their existing fallbacks and terminal combat output remains reliable.
