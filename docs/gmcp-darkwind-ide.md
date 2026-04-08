# Darkwind.IDE GMCP Protocol Specification

This document specifies the `Darkwind.IDE` GMCP package as implemented by the current web client.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.IDE 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.IDE.Open` | Server -> Client | Open the editor with file content and editor metadata |
| `Darkwind.IDE.Save` | Client -> Server | Submit the current file content for save/compile |
| `Darkwind.IDE.SaveResult` | Server -> Client | Return save/compile status and optional diagnostics |
| `Darkwind.IDE.Close` | Client -> Server | Notify the server that the editor was closed for a specific path |

## Darkwind.IDE.Open

Direction: `Server -> Client`

Opens the IDE for one file.

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "content": "// file content here...",
  "language": "lpc",
  "readOnly": false
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `path` | string | Yes | File path shown in the editor header and echoed in later save/close messages |
| `content` | string | Yes | Full file contents |
| `language` | string | No | Language hint for syntax mode selection |
| `readOnly` | boolean | No | When true, save controls are omitted and editing is disabled |

## Darkwind.IDE.Save

Direction: `Client -> Server`

Sent when the user activates save from the IDE UI.

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "content": "// updated file content..."
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `path` | string | Yes | Current editor path |
| `content` | string | Yes | Full document contents |

## Darkwind.IDE.SaveResult

Direction: `Server -> Client`

Returns the result of a previous save request.

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "success": false,
  "message": "Compilation failed.",
  "errors": [
    { "line": 15, "column": 0, "message": "Missing ';' before end of line" }
  ]
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `path` | string | No | Present in existing docs and reasonable for correlation, but the current client does not read it |
| `success` | boolean | Yes | Determines success vs compile-failed UI state |
| `message` | string | No | Used when no structured errors are available, and may also be shown alongside errors |
| `errors` | array | No | Compile diagnostics |
| `errors[].line` | number | Yes | 1-based line number expected by the client UI |
| `errors[].column` | number | No | Column hint; `0` or omitted is tolerated |
| `errors[].message` | string | Yes | Diagnostic text |

### Client Behavior

- On success, clears diagnostics, updates the saved-content baseline, and shows a success state.
- On failure, keeps the buffer dirty, shows compile errors, and maps diagnostics into editor lint markers.

## Darkwind.IDE.Close

Direction: `Client -> Server`

Sent when the user closes the editor UI.

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c"
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `path` | string | Yes | Current editor path |

The current client always includes `path` in the close message.

## Client Notes

- The IDE is lazy-loaded on first use.
- `Open` and `SaveResult` are the only IDE messages the current client listens for.
- The client sends `Save` and `Close` from callbacks bound to the active editor instance.
- Closing can be triggered by the Close button or `Escape`; unsaved-change confirmation is handled inside the editor UI before `Darkwind.IDE.Close` is sent.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.IDE.Close {"path":"/domains/darkwind/rooms/tavern.c"}
```
