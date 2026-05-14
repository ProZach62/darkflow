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

const { dom } = await import('../public/js/state.js');
const { aliasManager } = await import('../public/js/alias-manager.js');
const { triggerManager } = await import('../public/js/trigger-manager.js');
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


test('trigger run_alias executes an enabled alias instead of raw-sending the invocation', () => {
  resetManagers();
  aliasManager.saveScope(SCOPE_KEY, {
    aliases: [{
      id: 'alias-assist',
      enabled: true,
      trigger: 'assist',
      description: '',
      group: '',
      steps: [{ type: 'send_command', template: 'kill %1' }],
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
