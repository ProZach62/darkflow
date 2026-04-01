# Darkwind.Window GMCP Protocol Specification

This document specifies the `Darkwind.Window` GMCP package, a server-driven GUI system for rendering modal windows, panels, and dynamic content over WebSocket connections. It allows a MUD server to send rich UI layouts to a web client without the client needing game-specific knowledge.

---

## Package Overview

| Package | Direction | Description |
|---------|-----------|-------------|
| `Darkwind.Window.Open` | Server -> Client | Open a new window (modal or panel) |
| `Darkwind.Window.Update` | Server -> Client | Update elements in an open window |
| `Darkwind.Window.Close` | Server -> Client | Close a window |
| `Darkwind.Window.Submit` | Client -> Server | Submit form data from a window |
| `Darkwind.Window.Action` | Client -> Server | Button action (non-submit) |
| `Darkwind.Window.Closed` | Client -> Server | Notify server that user closed a window |

The client declares support via `Core.Supports.Set`:
```json
["Darkwind.Window 1"]
```

---

## Darkwind.Window.Open

Opens a new window. If a window with the same `id` already exists, it is replaced.

### Schema

```json
{
  "id": "string",
  "type": "modal" | "panel",
  "title": "string",
  "closable": true | false,
  "width": "string | number",
  "height": "string | number",
  "dock": "left" | "right",
  "order": 0,
  "layout": { ... }
}
```

### Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | Yes | - | Unique window identifier. Used for updates, close, and callbacks. |
| `type` | string | No | `"modal"` | `"modal"` for overlay dialog, `"panel"` for docked sidebar panel. |
| `title` | string | No | `""` | Window title bar text. |
| `closable` | boolean | No | `true` | Whether the user can close the window (X button, Escape, backdrop click). |
| `width` | string/number | No | auto | CSS width. Number treated as pixels. String passed as-is (e.g., `"400px"`, `"80vw"`). |
| `height` | string/number | No | auto | CSS height. Same rules as width. |
| `dock` | string | No | `"right"` | Panel only. Which sidebar to dock in. |
| `order` | number | No | `99` | Panel only. Sort order within the dock. |
| `layout` | object | Yes | - | Root layout node (see Layout Nodes below). |

### Example

```json
{
  "id": "item_view",
  "type": "modal",
  "title": "Iron Longsword",
  "closable": true,
  "width": 420,
  "layout": {
    "type": "vertical",
    "style": { "gap": "10px", "padding": "8px" },
    "children": [
      {
        "type": "image",
        "id": "item_image",
        "src": "https://cdn.example.com/images/sword.png",
        "alt": "Iron Longsword"
      },
      { "type": "divider" },
      {
        "type": "paragraph",
        "text": "A well-forged iron longsword with a leather-wrapped hilt."
      }
    ]
  }
}
```

---

## Layout Nodes

The `layout` field is a recursive tree of nodes. Each node has a `type` and optional properties.

### Layout Containers

Containers hold `children` arrays of other nodes.

#### `vertical`
Flexbox column layout.

```json
{
  "type": "vertical",
  "style": { "gap": "8px" },
  "children": [ ... ]
}
```

#### `horizontal`
Flexbox row layout.

```json
{
  "type": "horizontal",
  "style": { "gap": "8px", "justifyContent": "center" },
  "children": [ ... ]
}
```

#### `grid`
CSS grid layout.

```json
{
  "type": "grid",
  "columns": 3,
  "style": { "gap": "8px" },
  "children": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `columns` | number or string | Number of equal columns, or a CSS `grid-template-columns` string. |

---

### Display Elements

Read-only content elements.

#### `heading`

```json
{
  "type": "heading",
  "id": "title",
  "text": "Enter the Realm",
  "style": { "color": "#58a6ff", "textAlign": "center" }
}
```

#### `paragraph`

```json
{
  "type": "paragraph",
  "id": "desc",
  "text": "A long description of the item...",
  "style": { "lineHeight": "1.5" }
}
```

#### `text`

Inline text span.

```json
{
  "type": "text",
  "id": "label",
  "text": "Some text"
}
```

#### `divider`

Horizontal rule.

```json
{ "type": "divider" }
```

#### `progress`

Progress bar with optional label.

```json
{
  "type": "progress",
  "id": "hp_bar",
  "value": 75,
  "color": "#3fb950",
  "label": "75%"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `value` | number | 0-100 percentage. |
| `color` | string | CSS color for the fill bar. |
| `label` | string | Text overlay on the progress bar. |

#### `image`

Displays an image with optional loading state.

```json
{
  "type": "image",
  "id": "item_image",
  "src": "https://cdn.example.com/images/sword.png",
  "alt": "Iron Longsword"
}
```

Loading state (no image yet):

```json
{
  "type": "image",
  "id": "item_image",
  "loading": true,
  "loadingText": "Generating image..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `src` | string | Image URL. Can be HTTPS URL, S3 URL, or data URI. |
| `alt` | string | Alt text for accessibility. |
| `loading` | boolean | Show loading spinner instead of image. |
| `loadingText` | string | Text shown during loading state. Default: `"Generating image..."` |

The image fades in when loaded. On error, displays "Image unavailable". When an `Update` sets `src` on a loading image, the spinner is replaced with the image.

---

### Input Elements

Form elements that collect user input. Each has an `id` used for data collection.

#### `text`

```json
{
  "type": "text",
  "id": "username",
  "label": "Character Name",
  "placeholder": "Enter your name...",
  "value": ""
}
```

#### `password`

```json
{
  "type": "password",
  "id": "password",
  "label": "Password",
  "placeholder": "Enter your password..."
}
```

#### `number`

```json
{
  "type": "number",
  "id": "quantity",
  "label": "Amount",
  "value": 1,
  "min": 0,
  "max": 100,
  "step": 1
}
```

#### `select`

```json
{
  "type": "select",
  "id": "race",
  "label": "Race",
  "value": "human",
  "options": [
    { "value": "human", "label": "Human" },
    { "value": "elf", "label": "Elf" },
    { "value": "dwarf", "label": "Dwarf" }
  ]
}
```

#### `checkbox`

```json
{
  "type": "checkbox",
  "id": "remember",
  "label": "Remember me",
  "checked": false
}
```

#### `button`

```json
{
  "type": "button",
  "id": "login",
  "text": "Login",
  "action": "submit"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `"submit"` (primary/green, triggers `Window.Submit`), `"close"` (closes window, triggers `Window.Closed`), or `"action"` (triggers `Window.Action`). |

#### `hidden`

```json
{
  "type": "hidden",
  "id": "token",
  "value": "abc123"
}
```

---

### Style Property

Any node can have a `style` object with allowlisted CSS properties:

```
color, background, backgroundColor, fontSize, fontWeight, fontStyle,
textAlign, padding, paddingTop, paddingBottom, paddingLeft, paddingRight,
margin, marginTop, marginBottom, marginLeft, marginRight,
gap, justifyContent, alignItems, flexDirection,
width, maxWidth, minWidth, height, maxHeight, minHeight,
border, borderRadius, opacity, gridTemplateColumns, overflow,
lineHeight, textTransform
```

Any node can also have an `id` field for targeting with `Window.Update`.

---

## Darkwind.Window.Update

Updates elements in an already-open window by their `id`.

### Schema

```json
{
  "id": "window_id",
  "updates": [
    {
      "id": "element_id",
      "text": "new text",
      "style": { "color": "red" },
      "value": 50,
      "src": "https://...",
      "placeholder": "...",
      "disabled": true,
      "options": [ ... ]
    }
  ]
}
```

### Update Fields

| Field | Type | Applies To | Description |
|-------|------|-----------|-------------|
| `id` | string | All | Required. The `id` of the element to update. |
| `text` | string | heading, paragraph, text, button | Replace text content. |
| `style` | object | All | Merge CSS styles. |
| `value` | number | progress | Update progress bar fill (0-100). |
| `color` | string | progress | Update progress bar fill color. |
| `label` | string | progress | Update progress bar label text. |
| `src` | string | image | Set/replace image URL. Removes loading spinner. |
| `alt` | string | image | Update image alt text. |
| `value` | any | text, number, select, checkbox | Update input value. |
| `placeholder` | string | text, password, number | Update placeholder text. |
| `disabled` | boolean | text, password, number, select | Enable/disable input. |
| `options` | array | select | Replace dropdown options (array of `{value, label}`). |

### Example: Async image delivery

Server opens window with loading placeholder:
```json
{
  "id": "item_view",
  "type": "modal",
  "title": "Iron Longsword",
  "layout": {
    "type": "vertical",
    "children": [
      { "type": "image", "id": "item_image", "loading": true, "loadingText": "Generating image..." },
      { "type": "paragraph", "text": "A well-forged longsword." }
    ]
  }
}
```

After image generation completes (~2-3 seconds), server sends update:
```json
{
  "id": "item_view",
  "updates": [
    { "id": "item_image", "src": "https://cdn.example.com/images/generated/abc123.png" }
  ]
}
```

The client swaps the loading spinner for the image with a fade-in transition.

### Example: Show error message

```json
{
  "id": "login",
  "updates": [
    { "id": "error", "text": "Invalid password. Please try again." }
  ]
}
```

### Example: Update progress bar

```json
{
  "id": "crafting",
  "updates": [
    { "id": "progress_bar", "value": 75, "label": "75% complete" }
  ]
}
```

---

## Darkwind.Window.Close

Server requests the client to close a window.

```json
{
  "id": "window_id"
}
```

---

## Darkwind.Window.Submit

Client sends form data when a `"submit"` button is clicked, or Enter is pressed while a submit button exists in the window.

```json
{
  "id": "window_id",
  "button": "button_id",
  "data": {
    "username": "Gandalf",
    "password": "mellon",
    "remember": true
  }
}
```

Form data is collected from all input elements with an `id`. Checkboxes send `true`/`false`. Numbers send numeric values. Everything else sends strings.

---

## Darkwind.Window.Action

Client sends when a button with `action: "action"` (non-submit, non-close) is clicked.

```json
{
  "id": "window_id",
  "button": "button_id"
}
```

---

## Darkwind.Window.Closed

Client notifies server that the user closed a window (via X button, Escape key, or backdrop click). Only sent for closable windows.

```json
{
  "id": "window_id"
}
```

---

## Transport

GMCP messages are sent as binary WebSocket frames. Format:

```
PackageName JSONPayload
```

Example raw frame:
```
Darkwind.Window.Open {"id":"item_view","type":"modal","title":"Iron Longsword","layout":{...}}
```

For telnet clients, GMCP uses the standard IAC SB/SE subnegotiation wrapping (TELOPT 201).

---

## Keyboard Behavior

| Key | Behavior |
|-----|----------|
| Escape | Close the window (if `closable` is true) |
| Enter | Click the primary submit button (if one exists and focus is not in a textarea or non-primary button) |

---

## Implementation Notes

1. **Window IDs must be unique.** Opening a window with an existing ID replaces it.
2. **Updates only work on elements with an `id` field** set in the original layout.
3. **The `image` type** supports both static URLs and async loading patterns -- send with `loading: true`, then `Update` with `src` when the image is ready.
4. **Styles are allowlisted** for security -- arbitrary CSS properties are silently ignored.
5. **Unknown element types** should render as `[typename]` for debugging.
6. **The server should track window state** and register callbacks to handle `Submit`, `Action`, and `Closed` messages from the client.
7. **Modal windows** display as centered overlays with a dark backdrop. Panel windows dock in left/right sidebars.
8. **Form data collection** traverses all elements with an `id` in the window's DOM subtree.
