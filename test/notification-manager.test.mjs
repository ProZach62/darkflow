import test from 'node:test';
import assert from 'node:assert/strict';

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

globalThis.localStorage = createLocalStorage();
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
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

  cloneNode() {
    return new AudioMock(this.src);
  }

  play() {
    return Promise.resolve();
  }

  pause() {}

  addEventListener() {}
};

const { messageMentionsPlayer, normalizeMentionText } = await import('../public/js/notification-utils.js');
const { notificationManager } = await import('../public/js/notification-manager.js');

function resetNotificationManager(playerName = 'acer') {
  notificationManager.state.playerName = playerName;
  notificationManager.state.notifications = [];
  notificationManager.state.pendingMentions = [];
  notificationManager.state.recentLines = [];
  notificationManager.state.nextId = 1;
  notificationManager.state.open = false;
}

test('matches exact player mentions case-insensitively', () => {
  assert.equal(messageMentionsPlayer('Hello @Acer', 'acer'), true);
  assert.equal(messageMentionsPlayer('Hello @acer', 'Acer'), true);
  assert.equal(messageMentionsPlayer('[Druid] Cawr: @ACER come here', 'acer'), true);
});

test('does not match partial player mentions', () => {
  assert.equal(messageMentionsPlayer('Hello @acerb', 'acer'), false);
  assert.equal(messageMentionsPlayer('Hello @acer_thing', 'acer'), false);
  assert.equal(messageMentionsPlayer('Hello acer', 'acer'), false);
});

test('allows punctuation after a mention', () => {
  assert.equal(messageMentionsPlayer('@acer, can you help?', 'acer'), true);
  assert.equal(messageMentionsPlayer('(@acer)', 'acer'), true);
});

test('normalizes text for mention line binding', () => {
  assert.equal(normalizeMentionText(' [Druid]   Cawr:  hi   @Acer '), '[druid] cawr: hi @acer');
});

test('does not alert for a mention GMCP payload that never rendered', () => {
  resetNotificationManager();

  notificationManager.handleChannelText({
    channel: 'druid',
    talker: 'cawr',
    text: '[Druid] Cawr: @Acer come here',
  });

  assert.equal(notificationManager.state.notifications.length, 0);
  assert.equal(notificationManager.state.pendingMentions.length, 1);
});

test('alerts when a mention GMCP payload binds to a rendered line', () => {
  resetNotificationManager();

  notificationManager.recordOutputLine({
    id: 42,
    text: '[Druid] Cawr: @Acer come here',
    cssClass: '',
  });
  notificationManager.handleChannelText({
    channel: 'druid',
    talker: 'cawr',
    text: '[Druid] Cawr: @Acer come here',
  });

  assert.equal(notificationManager.state.notifications.length, 1);
  assert.equal(notificationManager.state.notifications[0].lineId, 42);
  assert.equal(notificationManager.state.pendingMentions.length, 0);
});

test('promotes a pending mention only after its line renders', () => {
  resetNotificationManager();

  notificationManager.handleChannelText({
    channel: 'say',
    talker: 'cawr',
    text: 'Cawr says: @Acer look',
  });
  notificationManager.recordOutputLine({
    id: 84,
    text: 'Cawr says: @Acer look',
    cssClass: '',
  });

  assert.equal(notificationManager.state.notifications.length, 1);
  assert.equal(notificationManager.state.notifications[0].lineId, 84);
  assert.equal(notificationManager.state.pendingMentions.length, 0);
});
