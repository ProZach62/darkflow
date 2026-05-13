# Darkwind.Snoop GMCP

`Darkwind.Snoop` lets Darkflow render builder snoop sessions in a graphical
modal instead of dumping snooped text into the main terminal.

Darkflow advertises support with:

```json
"Darkwind.Snoop 1"
```

## Server -> Client

### `Darkwind.Snoop.Open`

Opens or replaces the active snoop modal.

```json
{
  "id": "snoop",
  "target": "Denian",
  "targetRealName": "denian",
  "snooper": "Acer",
  "startedAt": 1778582400
}
```

### `Darkwind.Snoop.Append`

Appends one line or text chunk to the snoop stream. `text` may contain ANSI
SGR color sequences.

```json
{
  "id": "snoop",
  "type": "output",
  "text": "Center of Town!\\n",
  "timestamp": 1778582401
}
```

Supported `type` values are:

| Type | Meaning |
|------|---------|
| `output` | Output sent to the snooped player. |
| `input` | Command text typed by the snooped player. |
| `command` | Command submitted from the snoop modal. |
| `status` | Session status text. |

### `Darkwind.Snoop.Status`

Shows a status line in the modal.

```json
{
  "id": "snoop",
  "text": "Command was not accepted.",
  "timestamp": 1778582402
}
```

### `Darkwind.Snoop.Close`

Closes the modal. `reason` is informational.

```json
{
  "id": "snoop",
  "reason": "stopped"
}
```

## Client -> Server

### `Darkwind.Snoop.Command`

Runs a command either as the snooped target or as the snooping builder.

```json
{
  "id": "snoop",
  "mode": "target",
  "command": "look"
}
```

`mode` is `target` for the snooped player or `self` for the builder.

### `Darkwind.Snoop.Stop`

Stops the active snoop session.

```json
{
  "id": "snoop"
}
```

### `Darkwind.Snoop.Closed`

Sent when the user dismisses the modal. The server treats this as stopping
the active snoop session.

```json
{
  "id": "snoop"
}
```
