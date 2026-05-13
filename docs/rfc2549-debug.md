# RFC 2549 Debug Mode

Darkflow includes an opt-in RFC 2549 debug overlay inspired by
`IP over Avian Carriers with Quality of Service`.

This is a diagnostics visualization only. It does not add a real transport,
change WebSocket or telnet proxy behavior, rewrite commands, or delay traffic.

## Enable

Open Darkflow with:

```text
?rfc2549=1
```

Or enable it from the browser console:

```js
window.rfc2549Debug.enable()
```

Disable it with:

```js
window.rfc2549Debug.disable()
```

The console toggle stores the preference in `localStorage` under
`darkflow-rfc2549`.

## Telemetry

The panel reuses existing socket health data and displays it with RFC-flavored
labels:

- `QoS class`: derived from connection state, backlog, reconnects, and recent
  command activity.
- `Route`: the existing Darkflow transport target.
- `Frequent flyer miles`: total bytes sent and received.
- `Carrier queue`: recent socket diagnostic events.
- `RED-marked packets`: reconnects or handler/send failures.
- `Pulse rate`: recent diagnostic event rate.

## Console API

```js
window.rfc2549Debug.snapshot()
window.rfc2549Debug.toggle()
window.rfc2549Debug.setQoS('First')
window.rfc2549Debug.markRed('manual test')
```

`setQoS('')` clears a manual QoS override.
