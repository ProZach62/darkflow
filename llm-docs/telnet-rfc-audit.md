# Darkflow ↔ telnet RFC audit

> Audit of the Darkflow web client against telnet RFCs and de-facto MUD
> protocol specs. Conducted 2026-05-11 against Darkflow `0.11.9` and the
> companion proxy in `server.js`. File this as a reference; no fixes
> were implemented as a result.

## Context

Deep evaluation of the Darkflow web client at
`/Users/jasonalexander/coding/darkwind/play.darkwind.ai/` against the
relevant telnet RFCs and de-facto MUD protocol specs.

Two transport topologies were considered because they have different
spec implications:

- **Direct WS → LDMud Darkwind**: client speaks WebSocket directly to
  LDMud, which has native WS support (`secure/player/telopt.c`
  `receive_websocket_binary` + WS-native prompt writes). The frame
  boundary itself serves as the line boundary; LDMud handles GMCP
  over binary WS frames.
- **WS → proxy → telnet MUD** (added by commit `296452d` "Add WS<->TCP
  telnet proxy and four-protocol selector"): the same client connects
  to `server.js`, which opens an upstream TCP/TLS telnet session and
  bridges (`server.js` lines 227–349). The proxy speaks full telnet
  IAC negotiation upstream and translates GMCP between binary WS
  frames and `IAC SB 201 ... IAC SE` subnegotiation.

Most "RFC violation" candidates dissolve once you see the proxy adds
CR LF to outbound commands (`server.js:339–340`) and translates GMCP
correctly. The findings below are what's left after accounting for
both topologies.

---

## Spec violations / real problems

### 1. RFC 1073 NAWS — window size never reported

`public/js/connection.js` and `public/js/gmcp.js` never measure or
transmit terminal dimensions. There is no NAWS subnegotiation
(impossible over native WS, but the proxy could synthesize one if we
sent dimensions in `Core.Hello`), and there is no `width`/`height`
field in `Core.Hello` either (`gmcp.js:100-103`).

Consequence: server-side pagers, `wrap()`-style helpers, and the
column-aware help system have to guess at width. On a non-Darkwind
proxied MUD this means pagers commonly hardcode 80 cols regardless
of viewport.

**Recommendation**: add `width`, `height` to `Core.Hello`, and emit a
new `Core.Hello.Resize` (or equivalent Darkwind GMCP) when the window
resizes via `ResizeObserver` on the terminal pane.

### 2. RFC 1091 / MTTS — terminal type and capability bitvector missing

`Core.Hello` only sends `{client, version}`. Missing per MTTS de-facto
standard:

- `MTTS` bitvector (UTF-8 = 4, 256-color = 8, OSC color palette = 16,
  screen-reader = 64, true-color = 256, MNES = 512, …)
- `terminal_type` (e.g. `"xterm-256color"`)
- `charset` (e.g. `"UTF-8"`)

Without these the server can't gate features per client capability —
right now it has to assume Darkflow can handle anything, which works
because Darkflow does, but the moment another client connects to the
same server the server has no way to differentiate.

**Recommendation**: extend `gmcp.js::sendHandshake()` to include
`mtts: <bitvector>`, `terminal_type: 'xterm-256color'`, and
`charset: 'UTF-8'`. Reasonable bitvector for Darkflow today:
`4 | 8 | 16 | 256 = 284` (UTF-8 + 256-color + OSC palette + true-color).

### 3. RFC 857 ECHO — no echo suppression for password / sensitive prompts

In a real telnet flow the server sends `IAC WILL ECHO` to take over
echo (so passwords aren't visible). Darkflow has no equivalent.

- `public/js/input.js::sendCommandText` (line 488–505) always calls
  `appendEcho(trimmed)` for non-empty commands.
- The login modal uses an HTML `<input type="password">` for initial
  auth, so the initial login is safe.
- BUT any **mid-session** password prompt — admin tools, item-bind
  passwords, switch-character flow — will be echoed verbatim into the
  terminal as `> hunter2`, and saved into history (`pushHistory(trimmed)`
  at input.js:496 → `localStorage` via `saveHistory`).

This is the most security-relevant finding.

**Recommendation**: introduce a server-driven "private input" signal.
Options: (a) a new GMCP package
`Darkwind.Input.Mode {mode: "password"}` that toggles the input field
to type=password and skips echo + history; (b) a regex on inbound
text that detects common password prompt patterns
(`/password:?\s*$/i`) and auto-engages private mode for one submission.
(a) is robust; (b) is hacky but no server changes needed.

### 4. WS text frame UTF-8 strictness

RFC 6455 §5.6: WebSocket text frames **must** be valid UTF-8 or the
connection MUST be failed. There is no client-side recovery.

The Darkwind server uses `to_bytes(str, "UTF-8")` in
`secure/player/telopt.c:1567` and similar — safe. But if any
server-side code path emits Latin-1 bytes (legacy player descriptions,
imported zone files, untrusted player input that wasn't sanitized) the
WS connection will be killed mid-stream by the browser.

The proxy path (`server.js:269` `upstreamTextDecoder.decode(text, {stream: true})`)
is more robust — invalid bytes become U+FFFD via the `TextDecoder`
fatal=false default. So direct WS is more brittle than proxied for
this case.

**Recommendation**: audit server-side code paths that emit text for
strict UTF-8 (or normalize via a `tell_object`-level decoder shim on
the server). Lower priority unless we've seen actual WS drops.

---

## Spec-permitted but worth knowing

### 5. Inbound CR is stripped unconditionally

`public/js/output.js::splitFragmentsIntoLines` (line 321) does
`.replace(/\r/g, '')`. RFC 854 §2 says bare CR (without LF) is its own
NVT operation — "move the printer to the left margin of the current
line." Some MUDs use bare CR for progress bars or in-line line
overwrites (`Loading...\rDone     \n`).

Stripping all CR turns those into `Loading...Done`. Cosmetic on a MUD,
but if Darkwind ever adds a download progress widget or a streaming
emote effect it'll render wrong.

**Action**: leave as-is unless we add a Darkwind feature that needs
CR-overwrite semantics. Note in code that this is intentional.

### 6. Outbound bare command (no CR LF)

`public/js/input.js::sendRawCommand` sends the bare command via
`sendSocketPayload`. Strictly violates RFC 854 NVT, BUT:

- Direct WS to LDMud: the WS handler treats the frame as the line
  boundary. No terminator needed. Working as designed.
- Proxied: `server.js:339-340` adds `\r\n` if missing. Working.

So this is a "looks wrong in isolation, works correctly given the
two known topologies." Worth a comment in `sendRawCommand` explaining
the convention so a future maintainer doesn't add a `\r\n` and break
LDMud-direct.

### 7. Empty Enter zero-length frame

Same story as #6. Direct WS: LDMud handles via WS-aware code path.
Proxied: `server.js` normalizes empty → `"\r\n"`. Both compliant given
their layer.

The `0.11.7→0.11.8→0.11.9` arc resolved the visible side effects:
prompt pile-up is fixed at the merge layer (`closeOpenOutputLine`),
and no spurious local echo.

### 8. Telnet IAC byte (0xFF) in WS text

Cannot occur in well-formed UTF-8 (0xFF is never a valid UTF-8 start
byte). If somehow injected, browser drops the connection (RFC 6455
§5.6). Safe by design.

---

## Looks correct

| Aspect | Files | Note |
|---|---|---|
| RFC 858 SGA | n/a | WS is full-duplex; SGA meaningless |
| RFC 1184 LINEMODE | n/a | Native browser line editing; LINEMODE not needed |
| RFC 2066 CHARSET | n/a | WS guarantees UTF-8 |
| MCCP/MCCP2 compression | n/a | WS `permessage-deflate` covers it |
| Stateful ANSI parser across frames | `public/js/ansi.js:30-34` | Buffer correctly carried via module-level state |
| Reconnect handshake | `connection.js:300-323` + `gmcp.js:135-160` | `Core.Hello` and `Core.Supports.Set` replayed on each open |
| GMCP `Core.Supports.Set` package list | `gmcp.js:104-131` | Comprehensive (`Char.*`, `Room`, `Comm`, `Group`, `Game`, plus Darkwind extensions) |
| Bell / C0 controls | rendered invisibly | Acceptable; could optionally play audio bell |
| Proxy IAC negotiation | `server.js:227-263` | Proactively `DO GMCP`, falls back to text-only on `WONT`. Sane. |

---

## Additional gaps not strictly RFC-driven

### 9. `localStorage` command history retains everything

`public/js/input.js::pushHistory` → `saveHistory` writes
`localStorage[HISTORY_STORAGE_KEY]` for every non-empty submission,
including anything typed at a password prompt that the server didn't
flag.

Tied to finding #3 — if we add a private-input mode it must also
skip history insertion.

### 10. No `Char.Login` GMCP path

`Core.Supports.Set` advertises `Char 1` but there's no `Char.Login`
send path. Initial authentication still goes in-band as text frames
typed into the login modal. Switching to `Char.Login` GMCP (the
standard auth path among GMCP MUDs) would let us drop the plaintext
auth round trip entirely and resolves the password-echo class of
issues for the login flow at least.

Future enhancement; not a bug.

### 11. Bracketed paste mode

Server-side could opt in via CSI `?2004h` and wrap pasted content in
`ESC[200~ ... ESC[201~`. Darkflow doesn't generate these escapes
locally (the browser's paste handler is unaware), so a multi-line
paste lands as multiple commands or as a single mangled command
depending on input element settings. Not a telnet RFC issue but
worth noting if multi-line input is desired.

### 12. CSI handling beyond SGR

`ansi.js:62-66` parses any final-byte CSI but only acts on `m` (SGR).
Other CSI codes (`K` erase-line, `H` move-cursor, `J` erase-screen,
`6n` DSR) are silently dropped. For a scrollback-only client this is
correct — we don't want the server moving the cursor around in our
rendered DOM — but it means any "live status line" attempt by the
server will render as garbage. Likely intentional.

---

## Priority recommendations

If a follow-up commit is desired, in order of value:

1. **Fix #3 password handling** — security. Add `Darkwind.Input.Mode`
   GMCP package, plus a client-side input mode that drops echo and
   history when active.
2. **Fix #1 NAWS** — wire up `Core.Hello` width/height + a resize
   GMCP message. One day of work; immediately useful for pagers.
3. **Fix #2 MTTS** — extend `Core.Hello` with `mtts`,
   `terminal_type`, `charset`. Trivial; nice future-proofing.
4. **Document #6, #7** — inline comments noting the bare-command and
   empty-frame conventions, so future contributors don't "fix" them
   into RFC compliance and break the LDMud-direct path.

Everything else is "fine" or "interesting but optional."

---

## References

- [RFC 854 — Telnet Protocol Specification](https://datatracker.ietf.org/doc/html/rfc854)
- [RFC 855 — Telnet Option Specifications](https://datatracker.ietf.org/doc/html/rfc855)
- [RFC 857 — Telnet Echo Option](https://datatracker.ietf.org/doc/html/rfc857)
- [RFC 858 — Telnet Suppress Go Ahead](https://datatracker.ietf.org/doc/html/rfc858)
- [RFC 1073 — Telnet Window Size Option (NAWS)](https://datatracker.ietf.org/doc/html/rfc1073)
- [RFC 1091 — Telnet Terminal-Type Option / MTTS](https://datatracker.ietf.org/doc/html/rfc1091)
- [RFC 1184 — Telnet Linemode Option](https://datatracker.ietf.org/doc/html/rfc1184)
- [RFC 2066 — Telnet Charset Option](https://datatracker.ietf.org/doc/html/rfc2066)
- [RFC 6455 — The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- MTTS de-facto bitvector: <https://tintin.mudhalla.net/protocols/mtts/>
- GMCP de-facto spec: <https://tintin.mudhalla.net/protocols/gmcp/>
