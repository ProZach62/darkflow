# Darkwind.Achievements GMCP Protocol Specification

This document specifies the `Darkwind.Achievements` GMCP package, which carries achievement summary data and per-family progress for the achievements panel.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Achievements 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Achievements.List` | Server -> Client | Replace the full achievement summary and family progress |
| `Darkwind.Achievements.Update` | Server -> Client | Update the achievement summary and one or more family entries in place |

Both messages flow server -> client only. There is no companion client -> server request; the server pushes data when the player logs in, when an achievement family's progress changes, when a tier is unlocked, and after subscription hydration.

## Shared Snapshot Schema

Both messages share the same payload shape, scoped to the keys each variant carries.

```json
{
  "summary": {
    "unlockedTierCount": 14,
    "totalTierCount": 60,
    "completedFamilyCount": 1,
    "totalFamilyCount": 6,
    "equippedTitle": {
      "id": "explorer.tier3",
      "title": "the Wayfinder"
    },
    "leaderboardRank": 4
  },
  "families": [
    {
      "id": "explorer",
      "name": "Explorer",
      "category": "exploration",
      "scopeType": "global",
      "scopeKey": "",
      "statKey": "rooms_visited",
      "statLabel": "Rooms Visited",
      "titleStem": "Wayfinder",
      "currentValue": 312,
      "highestUnlockedTier": "tier3",
      "nextTierKey": "tier4",
      "nextTierThreshold": 500,
      "tiers": [
        {
          "key": "tier1",
          "label": "Apprentice Explorer",
          "threshold": 50,
          "unlocked": true,
          "unlockedAt": 1776600000,
          "titleId": "explorer.tier1",
          "title": "the Apprentice Explorer"
        }
      ]
    }
  ]
}
```

### Summary Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `summary.unlockedTierCount` | number | Yes | Number of tiers the player has unlocked across all families |
| `summary.totalTierCount` | number | Yes | Total number of tiers defined across all families |
| `summary.completedFamilyCount` | number | Yes | Families where the player has unlocked every tier |
| `summary.totalFamilyCount` | number | Yes | Total number of families defined on the server |
| `summary.equippedTitle` | object | No | The title currently equipped by the player |
| `summary.equippedTitle.id` | string | No | Server-side title id (`<family>.<tier>`) |
| `summary.equippedTitle.title` | string | No | Display string used in `Equipped:` line |
| `summary.leaderboardRank` | number\|string | No | Player's rank on the achievement leaderboard, or `Unranked` |

### Family Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | Yes | Stable family identifier; used as the merge key for `Update` payloads |
| `name` | string | Yes | Display name |
| `category` | string | No | Server-side categorization label |
| `scopeType` | string | No | `global`, `area`, etc. |
| `scopeKey` | string | No | Scope discriminator when `scopeType` is not global |
| `statKey` | string | No | Underlying stat that drives this family |
| `statLabel` | string | No | Display label for the underlying stat |
| `titleStem` | string | No | Title stem used to format awarded titles |
| `currentValue` | number | Yes | Current stat value used for progress |
| `highestUnlockedTier` | string | No | Key of the highest unlocked tier, or empty when none unlocked |
| `nextTierKey` | string | No | Key of the next tier to unlock; empty/missing when family is fully complete |
| `nextTierThreshold` | number | No | Stat value required for the next tier |
| `tiers` | array | No | Per-tier definitions and unlock state |
| `tiers[].key` | string | Yes | Tier key |
| `tiers[].label` | string | No | Display label |
| `tiers[].threshold` | number | Yes | Stat threshold for this tier |
| `tiers[].unlocked` | boolean | Yes | Whether the player has unlocked this tier |
| `tiers[].unlockedAt` | number | No | Unix timestamp when the tier was unlocked |
| `tiers[].titleId` | string | No | Title id awarded by this tier |
| `tiers[].title` | string | No | Display form of the title |

## Darkwind.Achievements.List

Direction: `Server -> Client`

Replaces the entire achievements snapshot for the current character.

### Schema

See "Shared Snapshot Schema" above. The payload includes both `summary` and `families`. The current client treats `families` as the authoritative ordered list and replaces its local cache wholesale.

### Client Behavior

- Stored as `gmcpData.achievements` and the `achievements` panel is re-rendered.
- The panel renders a summary block (Unlocked, Completed, Rank, Equipped) plus up to three "Closest Milestones" derived from families with a `nextTierThreshold > 0`. Milestones are sorted by descending progress percentage, then by ascending remaining count, and the top three are shown.

### Server Behavior

- Sent on character login and after an achievements panel subscription opens.
- Gated by `query_gmcp_panel_subscription(who, "achievements")`.

## Darkwind.Achievements.Update

Direction: `Server -> Client`

Updates the cached snapshot in place. May carry only `summary`, only `families`, or both.

### Schema

```json
{
  "summary": {
    "unlockedTierCount": 15,
    "totalTierCount": 60,
    "completedFamilyCount": 1,
    "totalFamilyCount": 6,
    "equippedTitle": {
      "id": "explorer.tier4",
      "title": "the Wayfinder"
    },
    "leaderboardRank": 4
  },
  "families": [
    {
      "id": "explorer",
      "name": "Explorer",
      "currentValue": 512,
      "highestUnlockedTier": "tier4",
      "nextTierKey": "tier5",
      "nextTierThreshold": 1000,
      "tiers": []
    }
  ]
}
```

### Client Behavior

- If `summary` is present, replaces `gmcpData.achievements.summary` wholesale.
- If `families` is present, merges each entry into the existing list using `id` as the merge key:
  - When `id` matches an existing family, the entry replaces the prior copy.
  - When `id` is new, the entry is appended.
- After merge, the families array is sorted by `name` (locale-aware ascending).
- The `achievements` panel is re-rendered.

### Server Behavior

- Sent when an achievement value changes, when a tier unlocks, when the equipped title changes, and when leaderboard rank shifts.
- Gated by `query_gmcp_panel_subscription(who, "achievements")`.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Achievements.Update {"summary":{"unlockedTierCount":15,"totalTierCount":60,"completedFamilyCount":1,"totalFamilyCount":6,"leaderboardRank":4},"families":[{"id":"explorer","name":"Explorer","currentValue":512,"nextTierKey":"tier5","nextTierThreshold":1000}]}
```
