# Darkwind.LinuxRescue GMCP Protocol Specification

`Darkwind.LinuxRescue` opens Darkflow's local privacy screen: a simulated Linux
terminal that covers the game UI. It does not execute a shell and does not send
entered commands to Darkwind.

## Support String

```text
Darkwind.LinuxRescue 1
```

## Darkwind.LinuxRescue.Open

Direction: `Server -> Client`

```json
{ "fullscreen": true }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `fullscreen` | boolean | No | If true, Darkflow also requests browser full-screen mode |

The client resets the simulated terminal state each time it opens. Commands,
history, paths, and output are implemented locally by `linux-rescue-core.mjs`.
`exit`, `logout`, Ctrl+D, or Escape closes the screen. Browser full-screen may
be denied because browsers require a user gesture; the privacy overlay still
opens when that request fails.

There are no client-to-server messages in this package.
