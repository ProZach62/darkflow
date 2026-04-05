# Darkwind.Completion GMCP Protocol Specification

This document specifies the `Darkwind.Completion` GMCP package, a server-authoritative tab-completion system used by the web client command input.

---

## Package Overview

| Package | Direction | Description |
|---------|-----------|-------------|
| `Darkwind.Completion.Request` | Client -> Server | Request completion candidates for a command line and cursor position |
| `Darkwind.Completion.Result` | Server -> Client | Return updated line/cursor and completion candidates |

The client declares support via `Core.Supports.Set`:
```json
["Darkwind.Completion 1"]
```

---

## Design Goals

- Server-authoritative completion logic
- Linux shell style tab behavior
- Command completion based on the player's actual command path
- Argument completion using game semantics
- Filesystem completion only for apprentice+ commands with filesystem access

---

## Darkwind.Completion.Request

Sent by the client when the user presses Tab in the command input.

### Schema

```json
{
  "line": "look sw",
  "cursor": 7
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `line` | string | Yes | Full input line currently in the command box |
| `cursor` | number | Yes | 0-based cursor index into `line` |

---

## Darkwind.Completion.Result

Sent by the server in response to each request.

### Schema

```json
{
  "line": "look sword ",
  "cursor": 11,
  "matches": ["sword"],
  "kind": "object",
  "ambiguous": false
}
```

Ambiguous result example:

```json
{
  "line": "ls a",
  "cursor": 4,
  "matches": ["areas/", "autoconf/"],
  "kind": "path",
  "ambiguous": true
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `line` | string | Yes | Updated command line after applying unique/common-prefix completion |
| `cursor` | number | Yes | Updated 0-based cursor index |
| `matches` | array of strings | Yes | Candidate completion tokens |
| `kind` | string | Yes | Completion category: `command`, `object`, `path`, or `argument` |
| `ambiguous` | boolean | Yes | True when multiple candidates still match |

---

## Completion Modes

### Command Completion

- Active while cursor is inside the first token
- Uses runtime command path from the current player
- Includes command aliases

### Object Completion (look-style)

For look-family verbs (`look`, `l`, `exa`, `examine`, `glance`, `gl`, `sl`), target completion order follows current game semantics:

1. Visible inventory
2. The current room object itself
3. Visible room contents

### Filesystem Path Completion

Enabled only for apprentice and above, and only for known filesystem verbs.

Current filesystem verbs:

- `cat`, `cd`, `color_ls`, `cp`, `ed`, `ide`, `ls`, `lso`, `mkdir`, `more`, `mv`, `popd`, `pushd`, `rm`, `rmdir`, `tail`

Write-required subset:

- `ed`, `ide`, `mkdir`, `mv`, `rm`, `rmdir`

Directory-only subset:

- `cd`, `mkdir`, `popd`, `pushd`, `rmdir`

---

## Client Behavior

The web client uses Linux shell style interaction:

- First Tab: apply unique match or longest common prefix
- Repeated Tab on the same ambiguous state: print candidate list to output
- Any non-modifier edit key resets repeated-tab ambiguity state

---

## Notes

- Completion is request-driven; the server responds to incoming `Darkwind.Completion.Request` messages.
- Package support is declared during GMCP handshake via `Core.Supports.Set`.
- Results are transported as GMCP JSON payloads over WebSocket binary frames, consistent with other Darkwind GMCP extensions.
