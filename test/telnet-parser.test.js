const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeTelnetParser,
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
} = require('../server.js');

function bytes(...values) {
  return Buffer.from(values);
}

function payload(text) {
  return Buffer.from(text, 'utf8');
}

test('passes single-chunk simple text through unchanged', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(payload('hello world'));

  assert.deepStrictEqual(result.text, payload('hello world'));
  assert.equal(result.reply, null);
  assert.deepStrictEqual(result.gmcpFrames, []);
});

test('unescapes IAC IAC outside subnegotiation as literal 0xff text', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(0x61, IAC, IAC, 0x62));

  assert.deepStrictEqual(result.text, bytes(0x61, IAC, 0x62));
  assert.equal(result.reply, null);
});

test('WILL GMCP replies DO GMCP and fires agreement callback once', () => {
  let agreed = 0;
  const telnet = makeTelnetParser({ onGmcpAgreed: () => { agreed++; } });

  const first = telnet.parse(bytes(IAC, WILL, TELOPT_GMCP));
  const second = telnet.parse(bytes(IAC, WILL, TELOPT_GMCP));

  assert.deepStrictEqual(first.reply, bytes(IAC, DO, TELOPT_GMCP));
  assert.deepStrictEqual(second.reply, bytes(IAC, DO, TELOPT_GMCP));
  assert.equal(telnet.isGmcpAgreed(), true);
  assert.equal(agreed, 1);
});

test('WILL non-GMCP replies DONT option', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(IAC, WILL, 25));

  assert.deepStrictEqual(result.reply, bytes(IAC, DONT, 25));
  assert.equal(telnet.isGmcpAgreed(), false);
});

test('DO GMCP replies WILL GMCP and marks GMCP agreed', () => {
  let agreed = 0;
  const telnet = makeTelnetParser({ onGmcpAgreed: () => { agreed++; } });
  const result = telnet.parse(bytes(IAC, DO, TELOPT_GMCP));

  assert.deepStrictEqual(result.reply, bytes(IAC, WILL, TELOPT_GMCP));
  assert.equal(telnet.isGmcpAgreed(), true);
  assert.equal(agreed, 1);
});

test('DO non-GMCP replies WONT option', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(IAC, DO, 24));

  assert.deepStrictEqual(result.reply, bytes(IAC, WONT, 24));
});

test('extracts a simple GMCP subnegotiation frame', () => {
  let agreed = 0;
  const telnet = makeTelnetParser({ onGmcpAgreed: () => { agreed++; } });
  const frame = payload('Core.Hello {"client":"Darkflow"}');
  const result = telnet.parse(Buffer.concat([
    bytes(IAC, SB, TELOPT_GMCP),
    frame,
    bytes(IAC, SE),
  ]));

  assert.deepStrictEqual(result.text, Buffer.alloc(0));
  assert.equal(result.reply, null);
  assert.equal(result.gmcpFrames.length, 1);
  assert.deepStrictEqual(result.gmcpFrames[0], frame);
  assert.equal(telnet.isGmcpAgreed(), true);
  assert.equal(agreed, 1);
});

test('unescapes IAC IAC inside a GMCP subnegotiation frame', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(
    IAC, SB, TELOPT_GMCP,
    0x78, IAC, IAC, 0x79,
    IAC, SE,
  ));

  assert.equal(result.gmcpFrames.length, 1);
  assert.deepStrictEqual(result.gmcpFrames[0], bytes(0x78, IAC, 0x79));
});

test('persists state when IAC straddles chunks', () => {
  const telnet = makeTelnetParser();
  const one = telnet.parse(bytes(0x61, IAC));
  const two = telnet.parse(bytes(SB, TELOPT_GMCP, 0x62, IAC, SE, 0x63));

  assert.deepStrictEqual(one.text, bytes(0x61));
  assert.deepStrictEqual(two.text, bytes(0x63));
  assert.equal(two.gmcpFrames.length, 1);
  assert.deepStrictEqual(two.gmcpFrames[0], bytes(0x62));
});

test('persists state when IAC IAC straddles chunks inside subnegotiation', () => {
  const telnet = makeTelnetParser();
  telnet.parse(bytes(IAC, SB, TELOPT_GMCP, 0x78, IAC));
  const result = telnet.parse(bytes(IAC, 0x79, IAC, SE));

  assert.equal(result.gmcpFrames.length, 1);
  assert.deepStrictEqual(result.gmcpFrames[0], bytes(0x78, IAC, 0x79));
});

test('handles long subnegotiation payloads across many chunks', () => {
  const telnet = makeTelnetParser();
  telnet.parse(bytes(IAC, SB, TELOPT_GMCP));

  for (let i = 0; i < 100; i++) {
    const intermediate = telnet.parse(Buffer.alloc(1024, i));
    assert.equal(intermediate.gmcpFrames.length, 0);
  }

  const result = telnet.parse(bytes(IAC, SE));
  assert.equal(result.gmcpFrames.length, 1);
  assert.equal(result.gmcpFrames[0].length, 100 * 1024);
  assert.equal(result.gmcpFrames[0][0], 0);
  assert.equal(result.gmcpFrames[0][99 * 1024], 99);
});

test('eats stray IAC SE outside subnegotiation', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(0x61, IAC, SE, 0x62));

  assert.deepStrictEqual(result.text, bytes(0x61, 0x62));
  assert.equal(result.reply, null);
  assert.deepStrictEqual(result.gmcpFrames, []);
});

test('drops oversized subnegotiation payload and resumes later traffic', () => {
  const telnet = makeTelnetParser();
  telnet.parse(bytes(IAC, SB, TELOPT_GMCP));
  telnet.parse(Buffer.alloc(MAX_SUBNEG_BYTES, 0x61));
  telnet.parse(bytes(0x62));
  const end = telnet.parse(bytes(IAC, SE, 0x63));

  assert.deepStrictEqual(end.gmcpFrames, []);
  assert.deepStrictEqual(end.text, bytes(0x63));
});

test('fires onGoAhead on IAC GA and strips it from text', () => {
  let goAheads = 0;
  const telnet = makeTelnetParser({ onGoAhead: () => { goAheads++; } });
  const result = telnet.parse(bytes(0x61, IAC, GA, 0x62));

  assert.deepStrictEqual(result.text, bytes(0x61, 0x62));
  assert.equal(result.reply, null);
  assert.equal(goAheads, 1);
});

test('persists state when IAC GA straddles chunks', () => {
  let goAheads = 0;
  const telnet = makeTelnetParser({ onGoAhead: () => { goAheads++; } });
  const one = telnet.parse(bytes(0x61, IAC));
  const two = telnet.parse(bytes(GA, 0x62));

  assert.deepStrictEqual(one.text, bytes(0x61));
  assert.deepStrictEqual(two.text, bytes(0x62));
  assert.equal(goAheads, 1);
});

test('eats nested telnet commands inside subnegotiation without payload leakage', () => {
  const telnet = makeTelnetParser();
  const result = telnet.parse(bytes(
    IAC, SB, TELOPT_GMCP,
    0x61,
    IAC, WILL, 25,
    0x62,
    IAC, SE,
  ));

  assert.deepStrictEqual(result.reply, bytes(IAC, DONT, 25));
  assert.equal(result.gmcpFrames.length, 1);
  assert.deepStrictEqual(result.gmcpFrames[0], bytes(0x61, 0x62));
});
