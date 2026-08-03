import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const documentListeners = new Map();

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.document = {
  hidden: false,
  addEventListener(name, handler) { documentListeners.set(name, handler); },
  removeEventListener(name, handler) {
    if (documentListeners.get(name) === handler) documentListeners.delete(name);
  },
};
globalThis.Audio = class AudioMock {
  constructor(src = '') {
    this.src = src;
    this.currentSrc = src;
    this.volume = 1;
    this.preload = '';
    this.loop = false;
    this.ended = false;
  }

  cloneNode() { return new AudioMock(this.src); }
  play() { return Promise.resolve(); }
  pause() {}
  addEventListener() {}
};

const {
  LOGIN_THEME,
  LoginThemeManager,
} = await import('../public/js/login-theme-manager.js');
const { isKnownSound, soundManager } = await import('../public/js/sound-manager.js');

function createFixture() {
  const calls = [];
  const gmcpHandlers = new Map();
  let pending = null;
  const manager = new LoginThemeManager({
    loop(category, sound, id, volume) {
      calls.push({ type: 'loop', category, sound, id, volume });
    },
    stop(category, id) {
      calls.push({ type: 'stop', category, id });
    },
  }, {
    setTimeout(callback) {
      pending = callback;
      return 1;
    },
    clearTimeout() {
      pending = null;
    },
  }, {
    on(packageName, handler) {
      gmcpHandlers.set(packageName, handler);
    },
    off(packageName, handler) {
      if (gmcpHandlers.get(packageName) === handler) gmcpHandlers.delete(packageName);
    },
  });

  return {
    calls,
    manager,
    flushStop() {
      const callback = pending;
      pending = null;
      if (callback) callback();
    },
    dispatch(packageName) {
      const handler = gmcpHandlers.get(packageName);
      if (handler) handler({});
    },
  };
}

test('registers the bundled Darkwind login theme', () => {
  assert.equal(isKnownSound(LOGIN_THEME.category, LOGIN_THEME.sound), true);
  assert.equal(
    soundManager.resolveDebugPath(LOGIN_THEME.category, LOGIN_THEME.sound),
    '/assets/sounds/darkwind-theme.mp3'
  );
  assert.equal(
    existsSync(new URL('../public/assets/sounds/darkwind-theme.mp3', import.meta.url)),
    true
  );
});

test('loops once across auth-window transitions and stops after login', () => {
  const fixture = createFixture();

  fixture.manager.setAuthActive(true);
  fixture.manager.setAuthActive(true);
  assert.deepEqual(fixture.calls, [{
    type: 'loop',
    ...LOGIN_THEME,
  }]);

  fixture.manager.setAuthActive(false);
  fixture.manager.setAuthActive(true);
  fixture.flushStop();
  assert.equal(fixture.calls.length, 1);

  fixture.manager.setAuthActive(false);
  fixture.flushStop();
  assert.deepEqual(fixture.calls[1], {
    type: 'stop',
    category: LOGIN_THEME.category,
    id: LOGIN_THEME.id,
  });
});

test('listens to the existing auth-window lifecycle event', () => {
  const fixture = createFixture();
  fixture.manager.init();

  const listener = documentListeners.get('dw:authwindowchange');
  assert.equal(typeof listener, 'function');
  listener({ detail: { open: true } });
  assert.equal(fixture.calls[0].type, 'loop');

  listener({ detail: { open: false } });
  fixture.flushStop();
  assert.equal(fixture.calls[1].type, 'stop');
  fixture.manager.destroy();
});

test('stops immediately when normal login attaches a character body', () => {
  const fixture = createFixture();
  fixture.manager.init();
  fixture.manager.setAuthActive(true);

  fixture.dispatch('Char.Vitals');

  assert.deepEqual(fixture.calls.at(-1), {
    type: 'stop',
    category: LOGIN_THEME.category,
    id: LOGIN_THEME.id,
  });
  fixture.manager.destroy();
});

test('stops immediately when a linkdead character session is recovered', () => {
  const fixture = createFixture();
  fixture.manager.init();
  fixture.manager.setAuthActive(true);

  fixture.dispatch('Darkwind.Session.Recovered');

  assert.deepEqual(fixture.calls.at(-1), {
    type: 'stop',
    category: LOGIN_THEME.category,
    id: LOGIN_THEME.id,
  });
  fixture.manager.destroy();
});
