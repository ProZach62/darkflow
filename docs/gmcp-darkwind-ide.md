# Darkwind.IDE GMCP Protocol Specification

This document specifies the `Darkwind.IDE` GMCP package, an in-browser code editor for builders that allows editing MUD source files (LPC) directly from the web client.

---

## Package Overview

| Package | Direction | Description |
|---------|-----------|-------------|
| `Darkwind.IDE.Open` | Server -> Client | Open the editor with a file's content |
| `Darkwind.IDE.Save` | Client -> Server | Save edited file content back to server |
| `Darkwind.IDE.SaveResult` | Server -> Client | Compilation/save result with errors |
| `Darkwind.IDE.Close` | Client -> Server | Notify server that the editor was closed |

The client declares support via `Core.Supports.Set`:
```json
["Darkwind.IDE 1"]
```

---

## Darkwind.IDE.Open

Server sends this to open the editor with a file. Triggered by the in-game `ide <filepath>` command.

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

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | - | Full file path on the MUD server |
| `content` | string | Yes | - | File content (may be empty for new files) |
| `language` | string | No | `"lpc"` | Language for syntax highlighting |
| `readOnly` | boolean | No | `false` | If true, editing is disabled (view only) |

---

## Darkwind.IDE.Save

Client sends this when the user saves the file (Ctrl+S or Save button).

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "content": "// updated file content..."
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | File path (echoed from Open) |
| `content` | string | Yes | Full file content to write |

---

## Darkwind.IDE.SaveResult

Server sends this after processing a Save request.

### Schema

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "success": true,
  "message": "Saved and compiled successfully.",
  "errors": []
}
```

With errors:

```json
{
  "path": "/domains/darkwind/rooms/tavern.c",
  "success": false,
  "message": "Compilation failed.",
  "errors": [
    { "line": 15, "column": 0, "message": "Missing ';' before end of line" },
    { "line": 23, "column": 0, "message": "Undefined variable 'foo'" }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | File path |
| `success` | boolean | Yes | Whether save and compile succeeded |
| `message` | string | No | Human-readable status message |
| `errors` | array | No | Array of compile error objects |
| `errors[].line` | number | Yes | Line number of the error |
| `errors[].column` | number | No | Column number (0 if unknown) |
| `errors[].message` | string | Yes | Error message text |

---

## Darkwind.IDE.Close

Client sends this when the user closes the editor (Escape key, Close button, or typing "close" in the terminal).

### Schema

```json
{}
```

No fields required. The server uses this to clean up any input handler state.

---

## Server-Side Implementation

### In-Game Command

The `ide <filepath>` command:

1. Resolves the file path (absolute, relative, or `here` for current room's file)
2. Checks read/write permissions
3. Reads file content (empty string for new files)
4. Sends `Darkwind.IDE.Open` via GMCP
5. Handles incoming `Darkwind.IDE.Save` messages via the telopt dispatch

### Save Handler (in telopt_d.c)

On receiving `Darkwind.IDE.Save`:

1. Writes file content to disk
2. Attempts to compile/reload the LPC object
3. Parses compiler output for errors
4. Sends `Darkwind.IDE.SaveResult` back to the client

### GMCP Dispatch (in telopt.c)

```
case GMCP_PKG_DARKWIND_IDE_SAVE:
case GMCP_PKG_DARKWIND_IDE_CLOSE:
    TELOPT_D->receive_darkwind_ide(this_object(), package,
        value ? json_decode(value) : ([]));
    break;
```

---

## Client-Side Implementation

### Editor UI (ide-editor.js, ide-manager.js)

- Full-screen modal overlay with code editor
- Syntax highlighting for LPC
- Save via Ctrl+S keybinding
- Error panel with clickable error items (jumps to line/column)
- Status bar showing file path, modified indicator, save status
- Unsaved changes confirmation on close

### CSS (ide.css)

- Modal positioned fixed over entire viewport (z-index: 2000)
- Editor fills available height
- Error panel at bottom with max-height, scrollable
- Dark theme matching the client's color scheme

---

## GMCP Definitions (gmcp_defs.h)

```c
#define GMCP_PKG_DARKWIND_IDE                        "Darkwind.IDE"
#define GMCP_PKG_DARKWIND_IDE_OPEN                   "Darkwind.IDE.Open"
#define GMCP_PKG_DARKWIND_IDE_SAVE                   "Darkwind.IDE.Save"
#define GMCP_PKG_DARKWIND_IDE_SAVE_RESULT            "Darkwind.IDE.SaveResult"
#define GMCP_PKG_DARKWIND_IDE_CLOSE                  "Darkwind.IDE.Close"
```

---

## Transport

GMCP messages are sent as binary WebSocket frames. Format:

```
PackageName JSONPayload
```

Example:
```
Darkwind.IDE.Open {"path":"/domains/darkwind/rooms/tavern.c","content":"...","language":"lpc"}
```
