# Darkwind.Announcements GMCP Protocol Specification

This document specifies the `Darkwind.Announcements` GMCP package as implemented by the current mudlib and web client announcement inbox.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Announcements 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Announcements.List` | Server -> Client | Replace the client's active and archived announcement inbox data |
| `Darkwind.Announcements.New` | Server -> Client | Push a newly posted announcement to logged-in players |
| `Darkwind.Announcements.State` | Server -> Client | Update unread badge state without replacing the full inbox |
| `Darkwind.Announcements.MarkRead` | Client -> Server | Mark one announcement read for the current character |

## Shared Announcement Item Schema

The server exposes announcements to clients as public items derived from the canonical server-side record.

```json
{
  "id": 42,
  "status": "active",
  "title": "Spring Festival Begins",
  "summary": "The festival is now live in all major cities.",
  "author": "Elyndar",
  "authorRealName": "elyndar",
  "createdAt": 1776834302,
  "archivedAt": 0,
  "markdown": "# Spring Festival Begins\n\nThe festival is now live.",
  "isRead": 0
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | number | Yes | Stable announcement identifier |
| `status` | string | Yes | `active` or `archived` |
| `title` | string | Yes | Inbox title shown in the list and detail header |
| `summary` | string | Yes | One-line summary shown in the list |
| `author` | string | Yes | Display name shown in the inbox UI |
| `authorRealName` | string | Yes | Canonical mudlib author name |
| `createdAt` | number | Yes | Unix timestamp |
| `archivedAt` | number | Yes | Unix timestamp or `0` when not archived |
| `markdown` | string | Yes | Full Markdown body rendered in the detail pane |
| `isRead` | number | Yes | `0` for unread, `1` for read in the current implementation |

## Darkwind.Announcements.List

Direction: `Server -> Client`

Replaces the full inbox state for the current character.

### Schema

```json
{
  "active": [
    {
      "id": 42,
      "status": "active",
      "title": "Spring Festival Begins",
      "summary": "The festival is now live in all major cities.",
      "author": "Elyndar",
      "authorRealName": "elyndar",
      "createdAt": 1776834302,
      "archivedAt": 0,
      "markdown": "# Spring Festival Begins\n\nThe festival is now live.",
      "isRead": 0
    }
  ],
  "archived": [],
  "unreadCount": 1
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `active` | array | Yes | Active announcements, newest first |
| `archived` | array | Yes | Archived announcements, newest first |
| `unreadCount` | number | Yes | Count of unread active announcements only |

### Runtime Behavior

- The current web client replaces its cached `active`, `archived`, and `unreadCount` state with this payload.
- The client keeps its current filter if possible and reselects the first visible item when nothing is selected.
- The server sends this message during GMCP startup and again after `Darkwind.Announcements.MarkRead`.

## Darkwind.Announcements.New

Direction: `Server -> Client`

Pushes one newly posted announcement to online GMCP-capable players.

### Schema

```json
{
  "item": {
    "id": 43,
    "status": "active",
    "title": "Patch Notes",
    "summary": "Combat balance and quest fixes are now live.",
    "author": "Elyndar",
    "authorRealName": "elyndar",
    "createdAt": 1776834920,
    "archivedAt": 0,
    "markdown": "# Patch Notes\n\n## Combat\n\n- Damage adjusted.",
    "isRead": 0
  },
  "unreadCount": 2
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `item` | object | Yes | The newly posted announcement as a shared announcement item |
| `unreadCount` | number | Yes | The recipient character's unread active count after publication |

### Runtime Behavior

- The current client prepends `item` to `active`, removing any older cached copy with the same `id`.
- If `unreadCount` is absent, the current client increments locally; the current server implementation does send it.
- The server also sends a plain text alert to all connected players when a new announcement is posted.

## Darkwind.Announcements.State

Direction: `Server -> Client`

Updates unread state without replacing the current inbox arrays.

### Schema

```json
{
  "unreadCount": 2
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `unreadCount` | number | Yes | Count of unread active announcements only |

### Runtime Behavior

- The current client updates only the bell badge and alert styling from this message.
- The mudlib sends this during login sync, after new announcement broadcast, and after read-state changes.

## Darkwind.Announcements.MarkRead

Direction: `Client -> Server`

Marks a single announcement read for the current character.

### Schema

```json
{
  "id": 42
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | number | Yes | Announcement ID to mark read |

### Runtime Behavior

- The current client sends this when the user selects an unread announcement in the detail view.
- The current client also marks the selected item read locally and decrements the badge optimistically for active announcements before the server responds.
- The server persists read state per character, then sends `Darkwind.Announcements.List` and `Darkwind.Announcements.State` back to the same client to refresh canonical state.

## Client Rendering Notes

- `summary` is rendered as plain text in the inbox list.
- `markdown` is rendered in the detail pane using the current web client's safe Markdown renderer.
- Raw HTML is not rendered by the current client Markdown path.
- The unread badge reflects unread active announcements only; archived unread items do not contribute to the badge count.
