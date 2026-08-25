// End-to-end tests against a fake MUD server, so login parsing, GA framing,
// GMCP state, and the script runner are validated without the live game.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { MudSession } from '../core/session.js';
import { runScript } from '../core/script.js';
import { makeTelnetParser, wrapGmcp, constants } from '../core/telnet.js';

const { IAC, GA, WILL, TELOPT_GMCP } = constants;

// Minimal scriptable MUD: drives name -> password -> in-game, frames every
// prompt with IAC GA, and pushes a GMCP Room.Info frame on login and on `look`.
function startFakeMud() {
  const commands = [];
  const roomFrame = (name) => wrapGmcp(Buffer.from(`Room.Info ${JSON.stringify({ name, num: 1 })}`, 'utf8'));
  const prompt = (sock) => { sock.write('> '); sock.write(Buffer.from([IAC, GA])); };

  const server = net.createServer((sock) => {
    let phase = 0; // 0=name, 1=password, 2=in-game
    let line = '';
    const parser = makeTelnetParser(); // strip the client's telnet/GMCP bytes

    sock.write(Buffer.from([IAC, WILL, TELOPT_GMCP])); // invite GMCP
    sock.write('By what name do you wish to be known? ');

    sock.on('data', (chunk) => {
      const { text } = parser.parse(chunk);
      line += text.toString('utf8');
      let idx;
      while ((idx = line.indexOf('\n')) >= 0) {
        const cmd = line.slice(0, idx).replace(/\r$/, '');
        line = line.slice(idx + 1);
        if (phase === 0) {
          phase = 1;
          sock.write('What is your password? ');
        } else if (phase === 1) {
          phase = 2;
          sock.write('Temple Square\nA quiet temple stands here.\n');
          sock.write(roomFrame('Temple Square'));
          prompt(sock);
        } else {
          commands.push(cmd);
          if (cmd === 'look') {
            sock.write('Temple Square\nA quiet temple stands here.\n');
            sock.write(roomFrame('Temple Square'));
            prompt(sock);
          } else if (cmd === 'start async') {
            sock.write('Started.\n');
            prompt(sock);
            setTimeout(() => {
              if (!sock.destroyed) sock.write('A delayed bell rings.\n');
            }, 5);
          } else if (cmd === 'get nonexistent') {
            sock.write("That isn't here.\n");
            prompt(sock);
          } else {
            sock.write(`You ${cmd}.\n`);
            prompt(sock);
          }
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, commands }));
  });
}

async function connectedSession(port) {
  const session = new MudSession({ host: '127.0.0.1', port, character: 'tester', password: 'secret' });
  await session.connect();
  const login = await session.login();
  return { session, login };
}

test('logs in, frames output on IAC GA, and captures GMCP state', async () => {
  const { server, port } = await startFakeMud();
  const { session, login } = await connectedSession(port);

  assert.equal(login.settledBy, 'ga');
  assert.deepEqual(login.room, { name: 'Temple Square', num: 1 });

  const out = await session.send('look');
  assert.equal(out.settledBy, 'ga');
  assert.match(out.text, /Temple Square/);
  assert.match(out.text, /quiet temple/);
  assert.equal(session.state('Room.Info').name, 'Temple Square');

  session.close();
  server.close();
});

test('graceful-failure command returns the rejection text', async () => {
  const { server, port } = await startFakeMud();
  const { session } = await connectedSession(port);

  const out = await session.send('get nonexistent');
  assert.match(out.text, /isn't here/);

  session.close();
  server.close();
});

test('runScript reports pass and fail per step', async () => {
  const { server, port } = await startFakeMud();
  const { session } = await connectedSession(port);

  const report = await runScript(session, {
    steps: [
      { send: 'look', expect_contains: ['Temple Square'], expect_not_contains: ["isn't here"] },
      { gmcp: 'Room.Info', expect_equals: { name: 'Temple Square' } },
      { send: 'get nonexistent', expect_contains: ["isn't here"] },
      { send: 'look', expect_contains: ['this string is absent'] }, // should FAIL
    ],
  });

  assert.equal(report.total, 4);
  assert.equal(report.passed, false);
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].pass, true);
  assert.equal(report.results[1].pass, true);
  assert.equal(report.results[2].pass, true);
  assert.equal(report.results[3].pass, false);

  session.close();
  server.close();
});

test('runScript honors a script-level stop_on_fail setting', async () => {
  const { server, port, commands } = await startFakeMud();
  const { session } = await connectedSession(port);

  const report = await runScript(session, {
    stop_on_fail: true,
    steps: [
      { send: 'get nonexistent', expect_contains: ['You get it.'] },
      { send: 'look', expect_contains: ['Temple Square'] },
    ],
  });

  assert.equal(report.passed, false);
  assert.equal(report.run, 1);
  assert.deepEqual(commands, ['get nonexistent']);

  session.close();
  server.close();
});

test('runScript gossips each non-empty label and result around its step', async () => {
  const { server, port, commands } = await startFakeMud();
  const { session } = await connectedSession(port);

  const report = await runScript(session, {
    steps: [
      { send: 'look', label: 'inspect the room', expect_contains: ['Temple Square'] },
      { wait_ms: 1, label: 'wait for\nthe next pulse' },
      { send: 'get nonexistent', expect_contains: ["isn't here"] },
    ],
  });

  assert.equal(report.passed, true);
  assert.deepEqual(commands, [
    'gossip Test: inspect the room',
    'look',
    'gossip Test result: Success',
    'gossip Test: wait for the next pulse',
    'gossip Test result: Success',
    'get nonexistent',
  ]);
  assert.doesNotMatch(report.results[0].output, /gossip Test:/);

  session.close();
  server.close();
});

test('runScript gossips assertion reasons for failed labeled steps', async () => {
  const { server, port, commands } = await startFakeMud();
  const { session } = await connectedSession(port);

  const report = await runScript(session, {
    steps: [
      { send: 'get nonexistent', label: 'find the missing item', expect_contains: ['You get it.'] },
    ],
  });

  assert.equal(report.passed, false);
  assert.deepEqual(commands, [
    'gossip Test: find the missing item',
    'get nonexistent',
    'gossip Test result: Failure - expected to contain "You get it."',
  ]);

  session.close();
  server.close();
});

test('label gossip preserves async output for a following read step', async () => {
  const { server, port, commands } = await startFakeMud();
  const { session } = await connectedSession(port);

  const report = await runScript(session, {
    steps: [
      { send: 'start async' },
      { wait_ms: 20, label: 'wait for the delayed event' },
      { read: true, label: 'inspect the delayed event', expect_contains: ['A delayed bell rings.'] },
    ],
  });

  assert.equal(report.passed, true);
  assert.deepEqual(commands, [
    'start async',
    'gossip Test: wait for the delayed event',
    'gossip Test result: Success',
    'gossip Test: inspect the delayed event',
    'gossip Test result: Success',
  ]);
  assert.match(report.results[2].output, /A delayed bell rings\./);
  assert.doesNotMatch(report.results[2].output, /gossip Test:/);

  session.close();
  server.close();
});
