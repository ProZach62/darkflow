import test from 'node:test';
import assert from 'node:assert/strict';

class CustomEventMock {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

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

globalThis.CustomEvent = CustomEventMock;
globalThis.window = { dispatchEvent() {} };
globalThis.localStorage = createLocalStorage();
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
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
    const clone = new AudioMock(this.src);
    clone.currentSrc = this.currentSrc;
    clone.volume = this.volume;
    clone.preload = this.preload;
    clone.loop = this.loop;
    return clone;
  }

  play() {
    return Promise.resolve();
  }

  pause() {}

  addEventListener() {}
};

const { dom } = await import('../public/js/state.js');
const { aliasManager } = await import('../public/js/alias-manager.js');
const { triggerManager } = await import('../public/js/trigger-manager.js');
const { timerManager } = await import('../public/js/timer-manager.js');
const { soundManager } = await import('../public/js/sound-manager.js');
const {
  executeAliasLine,
  executeTriggerMatches,
} = await import('../public/js/automation-executor.js');

const SCOPE_KEY = 'ws://test:4242';

function resetManagers() {
  localStorage.clear();
  dom.host = { value: 'test' };
  dom.port = { value: '4242' };
  dom.protocolSelect = { value: 'ws' };
  aliasManager._data = { scopes: {} };
  triggerManager._data = { scopes: {} };
  timerManager.stopAllTimers();
  timerManager._data = { scopes: {} };
  timerManager._sendCommand = null;
  timerManager._appendMessage = null;
}

function messagesAndSends() {
  const messages = [];
  const sent = [];
  return {
    messages,
    sent,
    appendMessage(message) {
      messages.push(message);
    },
    sendCommand(command) {
      sent.push(command);
      return true;
    },
  };
}

test('alias steps can toggle triggers by pattern', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-toggle-trigger',
      enabled: true,
      trigger: 'tog',
      description: '',
      group: '',
      steps: [{ type: 'set_trigger_enabled', mode: 'toggle', target: 'incoming *' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-incoming',
      enabled: true,
      pattern: 'incoming *',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: 'look' }],
    }],
  });

  const io = messagesAndSends();
  const first = executeAliasLine('tog', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });
  assert.equal(first.localOnly, true);
  assert.equal(triggerManager.findTriggerByPattern('incoming *', SCOPE_KEY).enabled, false);

  executeAliasLine('tog', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });
  assert.equal(triggerManager.findTriggerByPattern('incoming *', SCOPE_KEY).enabled, true);
  assert.deepEqual(io.messages, [
    'Alias: Trigger "incoming *" disabled.',
    'Alias: Trigger "incoming *" enabled.',
  ]);
  assert.deepEqual(io.sent, []);
});

test('alias toggle trigger preserves trigger capture tokens in target pattern', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-toggle-burn-corpse',
      enabled: true,
      trigger: 'togbc',
      description: '',
      group: '',
      steps: [{ type: 'set_trigger_enabled', mode: 'toggle', target: 'You killed %1.' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-burn-corpse',
      enabled: true,
      pattern: 'You killed %1.',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: 'burn corpse' }],
    }],
  });

  const io = messagesAndSends();
  const result = executeAliasLine('togbc', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });

  assert.equal(result.localOnly, true);
  assert.equal(triggerManager.findTriggerByPattern('You killed %1.', SCOPE_KEY).enabled, false);
  assert.deepEqual(io.messages, ['Alias: Trigger "You killed %1." disabled.']);
  assert.deepEqual(io.sent, []);
});

test('trigger matching ignores a leading prompt marker on completed output lines', () => {
  resetManagers();
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-exact-prompted-line',
      enabled: true,
      pattern: 'You are hungry.',
      description: '',
      group: '',
      gag: true,
      steps: [{ type: 'show_message', template: 'eat soon' }],
    }, {
      id: 'trigger-capture-prompted-line',
      enabled: true,
      pattern: 'You killed %1.',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: 'burn %1 corpse' }],
    }],
  });

  const exact = triggerManager.evaluateLine('> You are hungry.', SCOPE_KEY);
  assert.equal(exact.gag, true);
  assert.equal(exact.matches.length, 1);
  assert.equal(exact.matches[0].fullMatch, 'You are hungry.');

  const captured = triggerManager.evaluateLine('> You killed goblin.', SCOPE_KEY);
  assert.equal(captured.gag, false);
  assert.equal(captured.matches.length, 1);
  assert.equal(captured.matches[0].fullMatch, 'You killed goblin.');
  assert.deepEqual(captured.matches[0].captures, ['goblin']);
});

test('trigger steps can disable aliases by trigger text', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-heal',
      enabled: true,
      trigger: 'heal',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'cast heal' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-disable',
      enabled: true,
      pattern: 'disable healing',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'set_alias_enabled', mode: 'disable', target: 'heal' }],
    }],
  });

  const io = messagesAndSends();
  executeTriggerMatches([{
    trigger: triggerManager.findTriggerByPattern('disable healing', SCOPE_KEY),
    fullMatch: 'disable healing',
    captures: [],
  }], SCOPE_KEY, io);

  assert.equal(aliasManager.findAliasByTrigger('heal', SCOPE_KEY).enabled, false);
  assert.deepEqual(io.messages, ['Trigger: Alias "heal" disabled.']);
  assert.deepEqual(io.sent, []);
});

test('alias send_command steps still expand other aliases', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-one',
      enabled: true,
      trigger: 'one',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'two %1' }],
    }, {
      id: 'alias-two',
      enabled: true,
      trigger: 'two',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'say %1' }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('one hello', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });

  assert.deepEqual(io.sent, ['say hello']);
});

test('regex aliases match input lines and expose capture groups to templates', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-regex-give',
      enabled: true,
      trigger: '^gi\\s+(.+)$',
      isRegex: true,
      ignoreCase: true,
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'give %1 to pack mule' }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('GI silver sword', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });

  assert.deepEqual(io.sent, ['give silver sword to pack mule']);
  assert.deepEqual(io.messages, []);
});


test('trigger run_alias executes an enabled alias instead of raw-sending the invocation', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-assist',
      enabled: true,
      trigger: 'assist',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'kill %0' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-assist',
      enabled: true,
      pattern: 'target *',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'run_alias', template: 'assist %1' }],
    }],
  });

  const io = messagesAndSends();
  executeTriggerMatches([{
    trigger: triggerManager.findTriggerByPattern('target *', SCOPE_KEY),
    fullMatch: 'target orc',
    captures: ['orc'],
  }], SCOPE_KEY, io);

  assert.deepEqual(io.sent, ['kill orc']);
  assert.deepEqual(io.messages, []);
});

test('trigger play_sound steps play local audio without sending commands', () => {
  resetManagers();
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-sound',
      enabled: true,
      pattern: 'You are bleeding',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'play_sound', category: 'alert', sound: 'warning', volume: 0.5 }],
    }],
  });

  const played = [];
  const originalPlay = soundManager.play;
  soundManager.play = (category, sound, volume) => {
    played.push({ category, sound, volume });
  };

  try {
    const io = messagesAndSends();
    executeTriggerMatches([{
      trigger: triggerManager.findTriggerByPattern('You are bleeding', SCOPE_KEY),
      fullMatch: 'You are bleeding',
      captures: [],
    }], SCOPE_KEY, io);

    assert.deepEqual(played, [{ category: 'alert', sound: 'warning', volume: 0.5 }]);
    assert.deepEqual(io.sent, []);
    assert.deepEqual(io.messages, []);
  } finally {
    soundManager.play = originalPlay;
  }
});

test('trigger diagnostics require known play_sound selections', () => {
  resetManagers();
  const scope = {
    triggers: [{
      id: 'trigger-bad-sound',
      enabled: true,
      pattern: 'bad sound',
      description: 'Bad sound',
      group: '',
      gag: false,
      steps: [{ type: 'play_sound', category: 'alert', sound: 'missing', volume: 1 }],
    }],
  };

  const diagnostics = triggerManager.getTriggerDiagnostics(scope, 'trigger-bad-sound');
  assert.deepEqual(diagnostics, ['Step 1 uses a sound Darkflow does not know.']);
});

test('trigger run_alias warns without raw-sending unmatched alias text', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, { aliases: [], variables: {} });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-missing-alias',
      enabled: true,
      pattern: 'target *',
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'run_alias', template: 'assist %1' }],
    }],
  });

  const io = messagesAndSends();
  executeTriggerMatches([{
    trigger: triggerManager.findTriggerByPattern('target *', SCOPE_KEY),
    fullMatch: 'target orc',
    captures: ['orc'],
  }], SCOPE_KEY, io);

  assert.deepEqual(io.sent, []);
  assert.match(io.messages.join('\n'), /Trigger: Alias "assist orc" is not defined or is disabled\./);
});

test('regex triggers match incoming lines and expose capture groups to templates', () => {
  resetManagers();
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-regex-kill',
      enabled: true,
      pattern: '^You killed (.+)\\.$',
      isRegex: true,
      ignoreCase: false,
      description: '',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: 'burn %1 corpse' }],
    }],
  });

  const result = triggerManager.evaluateLine('You killed goblin.', SCOPE_KEY);
  assert.equal(result.gag, false);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].fullMatch, 'You killed goblin.');
  assert.deepEqual(result.matches[0].captures, ['goblin']);

  const io = messagesAndSends();
  executeTriggerMatches(result.matches, SCOPE_KEY, io);
  assert.deepEqual(io.sent, ['burn goblin corpse']);
  assert.deepEqual(io.messages, []);
});

test('alias steps toggle triggers by targetId and report the trigger name', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-toggle-by-id',
      enabled: true,
      trigger: 'tog',
      description: 'Toggle incoming watcher',
      group: '',
      steps: [{ type: 'set_trigger_enabled', mode: 'toggle', target: '', targetId: 'trigger-incoming' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-incoming',
      enabled: true,
      pattern: 'incoming *',
      description: 'Incoming watcher',
      group: '',
      gag: false,
      steps: [{ type: 'send_command', template: 'look' }],
    }],
  });

  // targetId survives normalization in both managers
  const savedAlias = aliasManager.getScopeSnapshot(SCOPE_KEY).aliases[0];
  assert.equal(savedAlias.steps[0].targetId, 'trigger-incoming');

  const io = messagesAndSends();
  executeAliasLine('tog', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
  });

  const trigger = triggerManager.findTriggerById('trigger-incoming', SCOPE_KEY);
  assert.equal(trigger.enabled, false);
  assert.match(io.messages.join('\n'), /Trigger "Incoming watcher" disabled\./);

  // resolution is by id, so a renamed pattern still toggles the same trigger
  trigger.pattern = 'renamed *';
  executeAliasLine('tog', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
  });
  assert.equal(triggerManager.findTriggerById('trigger-incoming', SCOPE_KEY).enabled, true);
});

test('targetId steps warn when the referenced item no longer exists', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-dangling-id',
      enabled: true,
      trigger: 'tog',
      description: 'Toggle removed trigger',
      group: '',
      steps: [{ type: 'set_trigger_enabled', mode: 'toggle', target: '', targetId: 'trigger-deleted' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, { triggers: [] });

  const io = messagesAndSends();
  executeAliasLine('tog', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
  });
  assert.match(io.messages.join('\n'), /Trigger referenced by alias "tog" no longer exists\./);
});

test('trigger steps disable aliases by targetId', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-heal',
      enabled: true,
      trigger: 'heal',
      description: 'Heal up',
      group: '',
      steps: [{ type: 'send_command', template: 'cast heal' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-low-mana',
      enabled: true,
      pattern: 'You are out of mana.',
      description: 'Mana guard',
      group: '',
      gag: false,
      steps: [{ type: 'set_alias_enabled', mode: 'disable', target: '', targetId: 'alias-heal' }],
    }],
  });

  const io = messagesAndSends();
  executeTriggerMatches([{
    trigger: triggerManager.findTriggerByPattern('You are out of mana.', SCOPE_KEY),
    fullMatch: 'You are out of mana.',
    captures: [],
  }], SCOPE_KEY, io);

  assert.equal(aliasManager.findAliasById('alias-heal', SCOPE_KEY).enabled, false);
  assert.match(io.messages.join('\n'), /Alias "Heal up" disabled\./);
});

test('alias script step runs only the matching branch', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-script',
      enabled: true,
      trigger: 'guard',
      description: 'Scripted guard',
      group: '',
      steps: [{
        type: 'script',
        script: [
          'if %1 == low',
          '  send drink healing potion',
          'elseif %1 == high',
          '  send cast bless',
          'else',
          '  show No guard action.',
          'end',
        ].join('\n'),
      }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('guard low', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });

  assert.deepEqual(io.sent, ['drink healing potion']);
  assert.deepEqual(io.messages, []);
});

test('trigger script step uses captures and can run aliases', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-assist',
      enabled: true,
      trigger: '^assist\\s+(.+)$',
      isRegex: true,
      description: 'Assist',
      group: '',
      steps: [{ type: 'send_command', template: 'kill %1' }],
    }],
    variables: {},
  });
  triggerManager.saveScope(SCOPE_KEY, {
    triggers: [{
      id: 'trigger-script',
      enabled: true,
      pattern: 'You are attacked by *',
      description: 'Scripted attack response',
      group: '',
      gag: false,
      steps: [{
        type: 'script',
        script: [
          'if %1 matches /orc|goblin/i',
          '  run_alias assist %1',
          'else',
          '  show Unknown attacker: %1',
          'end',
        ].join('\n'),
      }],
    }],
  });

  const match = triggerManager.evaluateLine('You are attacked by orc scout', SCOPE_KEY);
  const io = messagesAndSends();
  executeTriggerMatches(match.matches, SCOPE_KEY, io);

  assert.deepEqual(io.sent, ['kill orc scout']);
  assert.deepEqual(io.messages, []);
});

test('script variables set before later conditions are visible', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-script-vars',
      enabled: true,
      trigger: 'mark',
      description: 'Script variables',
      group: '',
      steps: [{
        type: 'script',
        script: [
          'set $target = %0',
          'if $target contains orc',
          '  send consider $target',
          'else',
          '  send look',
          'end',
        ].join('\n'),
      }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('mark orc captain', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
    isRoot: true,
  });

  assert.deepEqual(io.sent, ['consider orc captain']);
  assert.equal(aliasManager.getVariable('target', SCOPE_KEY), 'orc captain');
});

test('alias steps can enable and start timers by target id', async () => {
  resetManagers();
  const sent = [];
  const messages = [];
  timerManager.configureRuntime({
    sendCommand(command) {
      sent.push(command);
      return true;
    },
    appendMessage(message) {
      messages.push(message);
    },
  });
  timerManager.saveScope(SCOPE_KEY, {
    timers: [{
      id: 'timer-rebuff',
      enabled: false,
      name: 'rebuff',
      description: 'Rebuff',
      group: '',
      durationMs: 1000,
      recurring: false,
      autoStart: false,
      steps: [{ type: 'send_command', template: 'cast armor' }],
    }],
  });
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-start-rebuff',
      enabled: true,
      trigger: 'rebuff',
      description: 'Start rebuff',
      group: '',
      steps: [
        { type: 'set_timer_enabled', mode: 'enable', target: '', targetId: 'timer-rebuff' },
        { type: 'control_timer', mode: 'start', target: '', targetId: 'timer-rebuff' },
      ],
    }],
    variables: {},
  });

  executeAliasLine('rebuff', {
    scopeKey: SCOPE_KEY,
    appendMessage(message) {
      messages.push(message);
    },
    sendCommand(command) {
      sent.push(command);
      return true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 1050));

  assert.equal(timerManager.findTimerById('timer-rebuff', SCOPE_KEY).enabled, true);
  assert.deepEqual(sent, ['cast armor']);
  assert.match(messages.join('\n'), /Timer "rebuff" enabled\./);
  assert.match(messages.join('\n'), /Timer "rebuff" started\./);
});

test('scripts can toggle timers by name', () => {
  resetManagers();
  timerManager.saveScope(SCOPE_KEY, {
    timers: [{
      id: 'timer-loot',
      enabled: true,
      name: 'loot',
      description: '',
      group: '',
      durationMs: 1000,
      recurring: false,
      autoStart: false,
      steps: [{ type: 'send_command', template: 'look' }],
    }],
  });
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-script-timer',
      enabled: true,
      trigger: 'togtimer',
      description: 'Toggle timer',
      group: '',
      steps: [{ type: 'script', script: 'disable_timer loot' }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('togtimer', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
  });

  assert.equal(timerManager.findTimerByName('loot', SCOPE_KEY).enabled, false);
  assert.deepEqual(io.messages, ['Alias: Timer "loot" disabled.']);
});

test('scripts can run timers immediately without starting their countdown', () => {
  resetManagers();
  const sent = [];
  timerManager.configureRuntime({
    sendCommand(command) {
      sent.push(command);
      return true;
    },
    appendMessage() {},
  });
  timerManager.saveScope(SCOPE_KEY, {
    timers: [{
      id: 'timer-scan',
      enabled: true,
      name: 'scan',
      description: 'Scan',
      group: '',
      durationMs: 1000,
      recurring: false,
      autoStart: false,
      steps: [{ type: 'send_command', template: 'look' }],
    }],
  });
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-run-timer',
      enabled: true,
      trigger: 'runtimer',
      description: 'Run timer',
      group: '',
      steps: [{ type: 'script', script: 'run_timer scan' }],
    }],
    variables: {},
  });

  const io = messagesAndSends();
  executeAliasLine('runtimer', {
    scopeKey: SCOPE_KEY,
    appendMessage: io.appendMessage,
    sendCommand: io.sendCommand,
  });

  assert.deepEqual(sent, ['look']);
  assert.equal(timerManager.getRuntimeState(SCOPE_KEY)['timer-scan'], undefined);
  assert.deepEqual(io.messages, ['Alias: Timer "scan" run.']);
});
