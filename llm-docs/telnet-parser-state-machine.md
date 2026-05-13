# Refactor `makeTelnetParser` to a byte-by-byte state machine

> Design notes for replacing the index-scanning telnet parser in
> `server.js` with a proper state machine. Not yet implemented.
> Drafted 2026-05-12 against Darkflow `0.11.9`. Pick this up in a
> later session.

## Why

The current parser at `server.js:79-160` (`makeTelnetParser`) works
in *most* corner cases — it carries a `pending` buffer across
chunks and slices it back in when more bytes arrive — but the
design is wrong for two reasons our protocol author (musicmud.org
docs, plus the chrysalis MUD client author) called out:

1. **O(n²) on long subnegotiations split across many small chunks.**
   Each `parse(chunk)` call concatenates `pending + chunk` into a
   fresh buffer and re-walks the whole thing looking for `IAC SE`.
   A 10 MB GMCP frame arriving in 1500-byte TCP segments re-scans
   gigabytes total. The connection appears wedged for many seconds
   or hits an upstream timeout, with the symptom looking exactly
   like "long GMCP messages get dropped and their tail leaks into
   the text stream."

2. **Index-and-look-ahead style hides invariants.** The parser is
   really a state machine, but the states are implicit in `i`, `j`,
   and a tangle of `if (i + N >= buf.length)` checks. Every one of
   those checks is a hand-rolled "do we have enough bytes?" guard;
   one off-by-one in a future edit collapses to the failure mode
   above. The musicmud protocol docs make this explicit: *"The
   telnet parser MUST be written as a state machine on a layer on
   its own."*

There are also real-edge-case wrongs in the current code:

- No cap on `pending`. A buggy or hostile upstream that emits
  `IAC SB 201` and never sends `IAC SE` makes us accumulate and
  re-walk an unbounded buffer.
- `IAC <unrecognized 2-byte cmd>` inside an SB falls through and
  advances by 1 instead of being properly state-tracked. Works in
  practice for compliant servers; doesn't tolerate the docs' rule
  that *"there's no reason why telnet sequences are not allowed to
  come in the middle of an escape sequence."*

## References

- musicmud.org telnet protocol notes:
  <https://www.musicmud.org/mud-protocol.html>
  - "Do not assume that telnet or ansi sequences are not split
    across packets."
  - "The telnet parser MUST be written as a state machine on a
    layer on its own."
  - "There's no reason why telnet sequences are not allowed to
    come in the middle of an escape sequence."
- chrysalis (TypeScript MUD client) telnet parser at
  <https://github.com/Cryosphere-MUD/chrysalis/blob/b1dce5dd02516ec5a486325f33f5aa917e04652e/src/telnet.ts#L225>
  — model implementation, byte-by-byte state machine with
  `telnetState` + `subMode` + `subData` accumulation.

## Public interface (unchanged)

The caller in `server.js` lines 227–260 must keep working. So the
external shape stays:

```js
const telnet = makeTelnetParser({ onGmcpAgreed });
const { text, reply, gmcpFrames } = telnet.parse(chunk);
const isAgreed = telnet.isGmcpAgreed();
```

- `parse(chunk: Buffer)` returns:
  - `text: Buffer` — UTF-8 bytes destined for the WS text frame
  - `reply: Buffer | null` — IAC negotiation reply to send upstream
  - `gmcpFrames: Buffer[]` — extracted GMCP payloads, one per `IAC
    SB 201 ... IAC SE` block (already IAC-IAC-unescaped)
- `onGmcpAgreed()` fires once when the upstream WILL GMCP arrives
  (or replies WILL to our DO GMCP).
- Constants (`IAC = 0xFF`, `DONT = 0xFE`, `DO = 0xFD`, `WONT =
  0xFC`, `WILL = 0xFB`, `SB = 0xFA`, `SE = 0xF0`, `TELOPT_GMCP =
  0xC9`) stay as defined at `server.js:75-77`.

## State machine

Five states. Persist all of these across `parse()` calls in the
closure:

```
STATE_DATA            — copying bytes to `out` (text)
STATE_IAC             — saw IAC, awaiting command byte
STATE_IAC_OPT_NEG     — saw IAC WILL/WONT/DO/DONT, awaiting option
STATE_SB_OPT          — saw IAC SB, awaiting option byte
STATE_SB_DATA         — collecting subneg payload
STATE_SB_DATA_IAC     — inside SB, just saw IAC, awaiting IAC or SE
```

Closure-private fields:

```
state          : one of the above, initial STATE_DATA
negCmd         : the WILL/WONT/DO/DONT byte, valid only in STATE_IAC_OPT_NEG
subOpt         : the SB option byte, valid in STATE_SB_DATA / STATE_SB_DATA_IAC
subPayload     : Buffer of accumulated payload bytes (IAC-unescaped)
subOverflowed  : boolean — set when payload exceeds MAX_SUBNEG_BYTES
gmcpAgreed     : boolean — same as before
```

### Transitions (byte b at input)

**STATE_DATA**
- `b === IAC` → `state = STATE_IAC`
- otherwise → push `b` to `out`

**STATE_IAC**
- `b === IAC` → push `0xFF` to `out`; `state = STATE_DATA`
  *(literal 0xFF escape outside SB)*
- `b === WILL | WONT | DO | DONT` → `negCmd = b`; `state = STATE_IAC_OPT_NEG`
- `b === SB` → `state = STATE_SB_OPT`
- `b === SE` → `state = STATE_DATA` *(stray SE — eat it)*
- `b === NOP | DM | BRK | IP | AO | AYT | EC | EL | GA | EOR | ABORT | SUSP | xEOF`
  → process if we care (currently we ignore all), `state = STATE_DATA`
- any other byte → `state = STATE_DATA` *(unknown 2-byte cmd, eat both)*

**STATE_IAC_OPT_NEG**
- `b` is the option byte. Run option negotiation:
  - `negCmd === WILL` and `b === TELOPT_GMCP`:
    push `IAC, DO, b` to `reply`; if `!gmcpAgreed` set true and
    fire `onGmcpAgreed()`.
  - `negCmd === DO` and `b === TELOPT_GMCP`:
    push `IAC, WILL, b` to `reply`.
  - `negCmd === WILL` and `b !== TELOPT_GMCP`:
    push `IAC, DONT, b` to `reply`.
  - `negCmd === DO` and `b !== TELOPT_GMCP`:
    push `IAC, WONT, b` to `reply`.
  - `negCmd === WONT | DONT`: no reply.
- `state = STATE_DATA`.

**STATE_SB_OPT**
- `subOpt = b`; `subPayload = empty`; `subOverflowed = false`;
  `state = STATE_SB_DATA`.

**STATE_SB_DATA**
- `b === IAC` → `state = STATE_SB_DATA_IAC`
- otherwise → append `b` to `subPayload` (subject to overflow cap)

**STATE_SB_DATA_IAC**
- `b === IAC` → append `0xFF` to `subPayload`; `state =
  STATE_SB_DATA` *(IAC IAC escape inside SB)*
- `b === SE` → SB block complete:
  - if `!subOverflowed` and `subOpt === TELOPT_GMCP`, push
    `Buffer.from(subPayload)` to `gmcpFrames`.
  - otherwise discard.
  - reset `subPayload = empty`, `subOpt = null`, `subOverflowed =
    false`; `state = STATE_DATA`.
- any other byte → defensive: per musicmud docs ("telnet sequences
  may appear inside subneg"), interpret as a *nested* IAC command.
  Easiest correct handling: process the (IAC, b) pair as if we
  were in STATE_IAC (so b could legitimately be NOP, GA, etc.,
  which we eat), then return to `STATE_SB_DATA`. **Do not** push
  the bytes into `subPayload` — they were a telnet command, not
  payload. For our purposes (we only care about GMCP), eating
  them silently is correct.

### Append-with-cap

`appendToSubPayload(b)`:
- If `subOverflowed`, return.
- If `subPayload.length >= MAX_SUBNEG_BYTES`, set `subOverflowed =
  true`, free the buffer (set to empty), return. Optionally log
  via `logProxy({ event: 'subneg-overflow', ... })` — but the
  parser shouldn't depend on having a logger; pass it in or omit.

Constant:

```js
const MAX_SUBNEG_BYTES = 1024 * 1024; // 1 MiB
```

This is well above any plausible GMCP frame (typical Darkwind GMCP
frames are < 64 KB; Char.Items / MapData.Area can hit a few
hundred KB in extreme cases) and protects against unbounded growth.

## Implementation skeleton

Roughly (Node 18+, CommonJS in this repo):

```js
function makeTelnetParser({ onGmcpAgreed } = {}) {
  const S_DATA = 0, S_IAC = 1, S_OPT = 2,
        S_SB_OPT = 3, S_SB_DATA = 4, S_SB_IAC = 5;

  let state = S_DATA;
  let negCmd = 0;
  let subOpt = 0;
  let subBuf = [];          // array of bytes — faster than growing a Buffer
  let subOverflowed = false;
  let gmcpAgreed = false;

  function parse(chunk) {
    const out = [];
    const reply = [];
    const gmcpFrames = [];

    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      switch (state) {
        case S_DATA:
          if (b === IAC) state = S_IAC;
          else out.push(b);
          break;

        case S_IAC:
          if (b === IAC) { out.push(IAC); state = S_DATA; }
          else if (b === WILL || b === WONT || b === DO || b === DONT) {
            negCmd = b; state = S_OPT;
          } else if (b === SB) {
            state = S_SB_OPT;
          } else {
            // SE without SB, NOP, GA, EOR, etc. — eat
            state = S_DATA;
          }
          break;

        case S_OPT:
          if (b === TELOPT_GMCP) {
            if (negCmd === WILL) {
              reply.push(IAC, DO, b);
              if (!gmcpAgreed) {
                gmcpAgreed = true;
                if (typeof onGmcpAgreed === 'function') onGmcpAgreed();
              }
            } else if (negCmd === DO) {
              reply.push(IAC, WILL, b);
            }
            // WONT/DONT GMCP: silent
          } else {
            if (negCmd === WILL) reply.push(IAC, DONT, b);
            else if (negCmd === DO) reply.push(IAC, WONT, b);
          }
          state = S_DATA;
          break;

        case S_SB_OPT:
          subOpt = b;
          subBuf = [];
          subOverflowed = false;
          state = S_SB_DATA;
          break;

        case S_SB_DATA:
          if (b === IAC) state = S_SB_IAC;
          else appendSub(b);
          break;

        case S_SB_IAC:
          if (b === IAC) { appendSub(IAC); state = S_SB_DATA; }
          else if (b === SE) {
            if (!subOverflowed && subOpt === TELOPT_GMCP) {
              gmcpFrames.push(Buffer.from(subBuf));
            }
            subBuf = [];
            subOpt = 0;
            subOverflowed = false;
            state = S_DATA;
          } else {
            // Nested telnet cmd inside SB. Eat silently and
            // return to collecting subneg data.
            state = S_SB_DATA;
          }
          break;
      }
    }

    return {
      text: Buffer.from(out),
      reply: reply.length ? Buffer.from(reply) : null,
      gmcpFrames,
    };
  }

  function appendSub(b) {
    if (subOverflowed) return;
    if (subBuf.length >= MAX_SUBNEG_BYTES) {
      subOverflowed = true;
      subBuf = [];
      return;
    }
    subBuf.push(b);
  }

  return { parse, isGmcpAgreed: () => gmcpAgreed };
}
```

The 1 MiB cap on the subneg payload **drops** an oversized GMCP
frame rather than slowing the whole proxy. That's the correct
trade-off — silently delivering a 50 MB payload over a WebSocket
is worse than dropping it.

## Behavioral parity check

For well-formed input, this should produce **identical**
`{text, reply, gmcpFrames}` output to the current parser. Cases to
verify:

1. **Single-chunk simple text** — every byte goes through `S_DATA`,
   no IAC. Output text == input.
2. **IAC IAC escape outside SB** — `[IAC, IAC]` produces `out =
   [0xFF]`. Same as current line 99-103.
3. **WILL GMCP** — `[IAC, WILL, 201]` produces `reply = [IAC, DO,
   201]`, `gmcpAgreed = true`, `onGmcpAgreed()` fires.
4. **WILL non-GMCP** — `[IAC, WILL, 25]` produces `reply = [IAC,
   DONT, 25]`.
5. **DO GMCP** — `[IAC, DO, 201]` produces `reply = [IAC, WILL,
   201]`.
6. **Simple GMCP frame** — `[IAC, SB, 201, ...payload..., IAC,
   SE]` produces one entry in `gmcpFrames` with `payload`
   unescaped.
7. **GMCP with IAC IAC inside** — `[..., IAC, SB, 201, 0xFF
   escaped as IAC IAC, ..., IAC, SE]` correctly unescapes.
8. **IAC straddles chunks** — `chunk1 = [..., IAC]`, `chunk2 =
   [SB, 201, ..., IAC, SE]`. State persists across calls; works.
9. **IAC IAC straddles chunks inside SB** — `chunk1 = [..., IAC,
   SB, 201, X, IAC]`, `chunk2 = [IAC, Y, IAC, SE]`. State
   machine in `S_SB_IAC` at end of chunk1; `S_SB_DATA` after
   chunk2's first IAC. Payload = `[X, 0xFF, Y]`.
10. **Long SB across many chunks** — payload arrives in 100 chunks
    of 1 KB. Each chunk appends to `subBuf`; no re-scanning. O(n)
    total work.
11. **Stray IAC SE outside SB** — `[IAC, SE]` in `S_DATA` →
    `S_IAC` → eat the SE, back to `S_DATA`. No spurious output.
12. **Oversized subneg** — server emits `IAC SB 201` and then >1
    MiB of payload bytes. After 1 MiB, `subOverflowed = true` and
    we discard the buffer. When `IAC SE` eventually arrives, no
    `gmcpFrames` entry is emitted. Subsequent traffic continues
    normally.

## Files to change

- `server.js` lines 79–160 — replace `makeTelnetParser`. Keep
  `wrapGmcp` (line 164) and the constants (lines 75–77) as-is.
- Bump `public/version.json` and `package.json` (semantic
  patch bump).
- Add a top-of-file comment block above the new
  `makeTelnetParser` summarizing the state machine and citing
  this doc.

## Tests

There are currently no tests in `play.darkwind.ai/`. If the
implementer is willing, drop a `test/telnet-parser.test.js` (or
similar) that exercises the 12 parity cases above against the new
parser. Node's built-in `node:test` module is sufficient — no new
dependency needed.

If skipping tests, at minimum manually verify case 6, 7, 8, 9, 10,
and 12 by feeding crafted Buffer sequences into the parser in a
Node REPL.

## Out of scope

- Refactoring `wrapGmcp` (works fine, no design issue).
- Touching the WebSocket-direct-to-LDMud path (no telnet parsing
  involved there).
- Implementing other telnet options (NAWS, terminal type, etc.) —
  separate items in `telnet-rfc-audit.md`.
- Changing the proxy's CR LF normalization on outbound text
  (`server.js:339-340`) — works correctly, unchanged.

## Verification checklist for the implementing session

1. `node -e "require('./server.js')"` loads without syntax errors.
2. Spin up the proxy locally: `node server.js` and connect via
   the client (`npm start` if applicable, or load the static
   files and point at the local proxy).
3. Log into a GMCP-enabled MUD (Darkwind itself works if
   configured). Verify:
   - `Core.Hello` round-trip succeeds.
   - `Comm.Channel.Text` GMCP frames arrive intact.
   - `Darkwind.MapData.Area` (large frame) arrives intact and
     populates the map panel.
4. Tail `log/proxy.log` for `gmcp-agreed` events on connect.
5. Try a non-GMCP MUD if available (any classic MUD on
   `mudconnect.com`) — proxy should fall back to text-only,
   client should connect cleanly.
6. Look for `subneg-overflow` log events (shouldn't appear in
   normal operation).

After verification, commit + push (`git push origin HEAD` per the
project's saved push convention).
