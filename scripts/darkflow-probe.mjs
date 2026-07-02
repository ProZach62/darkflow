// Headless Darkflow wire probe: connects like the real client, logs every
// frame, and optionally submits the login window to prove the round trip.
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://localhost:4242/';
const submitLogin = process.argv.includes('--submit');
const delayHandshakeMs = Number((process.argv.find(a => a.startsWith('--delay-handshake=')) || '').split('=')[1] || 0);
const runForMs = Number((process.argv.find(a => a.startsWith('--run-for=')) || '').split('=')[1] || 15000);

const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);

const enc = new TextEncoder();
const dec = new TextDecoder();

const ws = new WebSocket(url, { rejectUnauthorized: false });
ws.binaryType = 'arraybuffer';

function sendGmcp(pkg, data) {
  const payload = data !== undefined ? pkg + ' ' + JSON.stringify(data) : pkg;
  ws.send(enc.encode(payload));
  log('>> GMCP', pkg);
}

function sendHandshake() {
  sendGmcp('Core.Hello', { client: 'Darkflow', version: '1.2.8-probe', width: 120, height: 40 });
  sendGmcp('Core.Supports.Set', [
    'Char 1', 'Char.Vitals 1', 'Char.Status 1', 'Char.Items 1', 'Room 1',
    'Comm 1', 'Comm.Channel 1', 'Game 1', 'Darkwind.Window 1',
    'Darkwind.Client.Subscriptions 1', 'Darkwind.Sound 1',
  ]);
  sendGmcp('Darkwind.Client.Subscriptions', { full: 1, panels: { vitals: 1, status: 1 }, features: {} });
}

let sawLoginWindow = false;
let submitted = false;
let responsesAfterSubmit = 0;

ws.on('open', () => {
  log('OPEN', url);
  if (delayHandshakeMs > 0) {
    log('-- delaying handshake', delayHandshakeMs, 'ms');
    setTimeout(sendHandshake, delayHandshakeMs);
  } else {
    sendHandshake();
  }
});

ws.on('message', (data, isBinary) => {
  if (!isBinary && typeof data === 'string') {
    log('<< TEXT', JSON.stringify(data.slice(0, 90)));
    if (submitted) responsesAfterSubmit++;
    return;
  }
  const text = dec.decode(data);
  const sp = text.indexOf(' ');
  const pkg = sp === -1 ? text : text.slice(0, sp);
  const body = sp === -1 ? '' : text.slice(sp + 1);
  log('<< GMCP', pkg, body.slice(0, 110));
  if (submitted) responsesAfterSubmit++;

  if (pkg === 'Darkwind.Window.Open') {
    try {
      const win = JSON.parse(body);
      if (win.id === 'login' && submitLogin && !submitted) {
        sawLoginWindow = true;
        setTimeout(() => {
          submitted = true;
          responsesAfterSubmit = 0;
          sendGmcp('Darkwind.Window.Submit', {
            id: 'login', button: 'login',
            data: { username: 'remorttest', password: 'Test12345!' },
          });
        }, 800);
      } else if (win.id === 'login') {
        sawLoginWindow = true;
      }
    } catch (e) {}
  }
});

ws.on('error', (e) => log('ERROR', e.message));
ws.on('close', (code) => log('CLOSE', code));

setTimeout(() => {
  log('== SUMMARY: loginWindow=' + sawLoginWindow +
    ' submitted=' + submitted +
    ' framesAfterSubmit=' + responsesAfterSubmit);
  try { ws.close(1000); } catch (e) {}
  process.exit(0);
}, runForMs);
