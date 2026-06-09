// Telnet IAC parser with GMCP bridging.
//
// Extracted from server.js so it can be shared by the Darkflow web-client proxy
// and out-of-process tooling (e.g. the headless MUD test harness) without
// pulling in express/ws. The public surface (makeTelnetParser, wrapGmcp,
// constants) is re-exported unchanged from server.js for backward compat.

const IAC = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB = 0xFA, SE = 0xF0;
const GA = 0xF9; // Go Ahead -- marks end-of-prompt on line-at-a-time MUDs.
const TELOPT_GMCP = 0xC9; // 201
const MAX_SUBNEG_BYTES = 1024 * 1024;

// This is intentionally a byte-by-byte state machine instead of an
// index-scanning parser. Telnet and ANSI sequences can split across TCP chunks,
// and musicmud.org's protocol notes call out that telnet parsing belongs in its
// own state-machine layer. The shape also follows the chrysalis client parser:
// persist parser state, subnegotiation mode, and accumulated subnegotiation
// bytes across parse() calls rather than concatenating and rescanning pending
// chunks.
//
// The parser strips telnet commands from upstream text, negotiates GMCP option
// 201, extracts IAC SB 201 ... IAC SE payloads as gmcpFrames, unescapes IAC IAC
// inside subnegotiations, and drops subnegotiation payloads over 1 MiB.
//
// Options:
//   onGmcpAgreed() -- fired once when GMCP negotiation completes.
//   onGoAhead()    -- fired on each IAC GA. The web client ignores it; the test
//                     harness uses it as the "prompt complete" output terminator.
function makeTelnetParser({ onGmcpAgreed, onGoAhead } = {}) {
  const S_DATA = 0;
  const S_IAC = 1;
  const S_OPT = 2;
  const S_SB_OPT = 3;
  const S_SB_DATA = 4;
  const S_SB_IAC = 5;
  const S_SB_OPT_NEG = 6;

  let state = S_DATA;
  let negCmd = 0;
  let subOpt = 0;
  let subBuf = [];
  let subOverflowed = false;
  let gmcpAgreed = false;

  function markGmcpAgreed() {
    if (gmcpAgreed) return;
    gmcpAgreed = true;
    if (typeof onGmcpAgreed === 'function') onGmcpAgreed();
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

  function negotiateOption(opt, reply) {
    if (opt === TELOPT_GMCP) {
      if (negCmd === WILL) {
        reply.push(IAC, DO, opt);
        markGmcpAgreed();
      } else if (negCmd === DO) {
        reply.push(IAC, WILL, opt);
        markGmcpAgreed();
      }
      return;
    }

    if (negCmd === WILL) reply.push(IAC, DONT, opt);
    else if (negCmd === DO) reply.push(IAC, WONT, opt);
  }

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
          if (b === IAC) {
            out.push(IAC);
            state = S_DATA;
          } else if (b === WILL || b === WONT || b === DO || b === DONT) {
            negCmd = b;
            state = S_OPT;
          } else if (b === SB) {
            state = S_SB_OPT;
          } else {
            // Stray SE, NOP, EOR, and unknown 2-byte commands are eaten. GA
            // (Go Ahead) marks end-of-prompt; surface it to interested callers.
            if (b === GA && typeof onGoAhead === 'function') onGoAhead();
            state = S_DATA;
          }
          break;

        case S_OPT:
          negotiateOption(b, reply);
          negCmd = 0;
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
          if (b === IAC) {
            appendSub(IAC);
            state = S_SB_DATA;
          } else if (b === SE) {
            if (!subOverflowed && subOpt === TELOPT_GMCP) {
              gmcpFrames.push(Buffer.from(subBuf));
              markGmcpAgreed();
            }
            subBuf = [];
            subOpt = 0;
            subOverflowed = false;
            state = S_DATA;
          } else if (b === WILL || b === WONT || b === DO || b === DONT) {
            negCmd = b;
            state = S_SB_OPT_NEG;
          } else {
            // Nested telnet command inside SB; eat the command, not payload.
            state = S_SB_DATA;
          }
          break;

        case S_SB_OPT_NEG:
          // Telnet option negotiation can legally appear inside SB. Process it
          // without letting its command or option bytes leak into subBuf.
          negotiateOption(b, reply);
          negCmd = 0;
          state = S_SB_DATA;
          break;

        default:
          state = S_DATA;
          break;
        }
    }

    return {
      text: Buffer.from(out),
      reply: reply.length ? Buffer.from(reply) : null,
      gmcpFrames,
    };
  }

  return { parse, isGmcpAgreed: () => gmcpAgreed };
}

// Wrap a GMCP payload as an IAC SB 201 ... IAC SE block.
// Any 0xFF byte in the payload is escaped as IAC IAC.
function wrapGmcp(payload) {
  const escaped = [];
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === IAC) escaped.push(IAC, IAC);
    else escaped.push(payload[i]);
  }
  return Buffer.concat([
    Buffer.from([IAC, SB, TELOPT_GMCP]),
    Buffer.from(escaped),
    Buffer.from([IAC, SE]),
  ]);
}

module.exports = {
  makeTelnetParser,
  wrapGmcp,
  constants: {
    IAC,
    DONT,
    DO,
    WONT,
    WILL,
    SB,
    SE,
    GA,
    TELOPT_GMCP,
    MAX_SUBNEG_BYTES,
  },
};
