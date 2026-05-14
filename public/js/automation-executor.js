import { aliasManager } from './alias-manager.js';
import { triggerManager } from './trigger-manager.js';

function normalizeMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function warn(appendMessage, prefix, message) {
  if (typeof appendMessage === 'function') {
    appendMessage(prefix + ': ' + message);
  }
}

function notify(appendMessage, prefix, message) {
  if (typeof appendMessage === 'function') {
    appendMessage(prefix + ': ' + message);
  }
}

function resolveAutomationValue(value, templateContext, options = {}) {
  if (!options.preservePositionalTokens) {
    return aliasManager.resolveTemplate(value, templateContext);
  }

  const placeholders = [];
  const protectedValue = String(value || '').replace(/%[0-9]/g, (match) => {
    const token = '\uE000' + placeholders.length + '\uE001';
    placeholders.push(match);
    return token;
  });
  const resolved = aliasManager.resolveTemplate(protectedValue, templateContext);

  return {
    ...resolved,
    text: resolved.text.replace(/\uE000([0-9]+)\uE001/g, (match, index) => (
      placeholders[Number(index)] || match
    )),
  };
}

function describeMode(mode) {
  if (mode === 'enable') return 'Enable';
  if (mode === 'disable') return 'Disable';
  return 'Toggle';
}

function getRequiredField(step) {
  if (step.type === 'set_alias_enabled' || step.type === 'set_trigger_enabled') return 'target';
  return 'template';
}

function getStepResult(step, source, templateContext, appendMessage) {
  const field = getRequiredField(step);
  const resolved = resolveAutomationValue(step[field], templateContext, {
    preservePositionalTokens: field === 'target',
  });
  const shouldWarn = step.type !== 'show_message';

  if (shouldWarn && resolved.missingVariables.length) {
    warn(
      appendMessage,
      source.prefix,
      'Missing variable'
      + (resolved.missingVariables.length === 1 ? '' : 's')
      + ' ' + resolved.missingVariables.map((name) => '$' + name).join(', ')
      + ' in ' + source.description + '.'
    );
    return { resolved, ok: false };
  }

  if (shouldWarn && resolved.errors.length) {
    warn(
      appendMessage,
      source.prefix,
      'Template error in ' + source.description + ': ' + resolved.errors.join(' ')
    );
    return { resolved, ok: false };
  }

  return { resolved, ok: true };
}

function setAutomationEnabled(manager, target, mode, scopeKey) {
  if (mode === 'enable') return manager.setEnabledByTarget(target, true, scopeKey);
  if (mode === 'disable') return manager.setEnabledByTarget(target, false, scopeKey);
  return manager.toggleEnabledByTarget(target, scopeKey);
}

function executeAutomationStep(step, context) {
  const {
    appendMessage,
    sendCommand,
    scopeKey,
    templateContext,
    source,
    aliasContext,
    expandCommandsAsAliases,
  } = context;

  const { resolved, ok } = getStepResult(step, source, templateContext, appendMessage);
  if (!ok) return { sent: false, localOnly: true, handled: true };

  if (step.type === 'set_variable') {
    const didSet = aliasManager.setVariable(step.name, resolved.text, scopeKey);
    return { sent: false, localOnly: didSet, handled: true };
  }

  if (step.type === 'show_message') {
    if (typeof appendMessage === 'function') appendMessage(resolved.text);
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'set_trigger_enabled') {
    const target = resolved.text.trim();
    if (!target) {
      warn(appendMessage, source.prefix, 'Trigger target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = setAutomationEnabled(triggerManager, target, normalizeMode(step.mode), scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Trigger "' + target + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Trigger "' + target + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'set_alias_enabled') {
    const target = resolved.text.trim();
    if (!target) {
      warn(appendMessage, source.prefix, 'Alias target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = setAutomationEnabled(aliasManager, target, normalizeMode(step.mode), scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Alias "' + target + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Alias "' + target + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  const command = resolved.text.trim();
  if (!command) return { sent: false, localOnly: false, handled: true };

  if (step.type === 'run_alias') {
    return executeAliasLine(command, {
      appendMessage,
      sendCommand,
      scopeKey,
      depth: aliasContext ? aliasContext.depth : 0,
      trail: aliasContext ? aliasContext.trail : [],
      isRoot: false,
      aliasOnly: true,
      warningPrefix: source.prefix,
    });
  }

  if (expandCommandsAsAliases) {
    return executeAliasLine(command, {
      appendMessage,
      sendCommand,
      scopeKey,
      depth: aliasContext ? aliasContext.depth : 0,
      trail: aliasContext ? aliasContext.trail : [],
      isRoot: false,
    });
  }

  if (typeof sendCommand !== 'function' || !sendCommand(command)) {
    warn(appendMessage, source.prefix, 'Unable to send "' + command + '" because you are not connected.');
    return { sent: false, localOnly: true, handled: true };
  }

  return { sent: true, localOnly: false, handled: true };
}

export function executeAliasLine(text, context = {}) {
  const scopeKey = context.scopeKey || aliasManager.getActiveScopeKey();
  const depth = context.depth || 0;
  const trail = Array.isArray(context.trail) ? context.trail : [];
  const isRoot = context.isRoot === true;
  const aliasOnly = context.aliasOnly === true;
  const appendMessage = context.appendMessage;
  const sendCommand = context.sendCommand;
  const warningPrefix = context.warningPrefix || 'Alias';
  const match = aliasManager.matchAlias(text, scopeKey);
  let sent = false;
  let localOnly = false;
  let handled = false;

  if (!match) {
    if (aliasOnly) {
      warn(appendMessage, warningPrefix, 'Alias "' + String(text || '').trim() + '" is not defined or is disabled.');
      return { sent: false, localOnly: true, handled: false };
    }

    if (typeof sendCommand !== 'function' || !sendCommand(text)) {
      if (!isRoot) {
        warn(appendMessage, warningPrefix, 'Unable to send "' + text + '" because you are not connected.');
      }
      return { sent: false, localOnly: false, handled: false };
    }
    return { sent: true, localOnly: false, handled: false };
  }

  handled = true;

  if (depth >= aliasManager.getMaxAliasDepth()) {
    warn(appendMessage, warningPrefix, 'Alias depth limit reached while expanding "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  if (trail.includes(match.alias.id)) {
    warn(appendMessage, warningPrefix, 'Alias recursion detected for "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  for (const step of match.alias.steps) {
    const variables = aliasManager.getScopeSnapshot(scopeKey).variables;
    const result = executeAutomationStep(step, {
      appendMessage,
      sendCommand,
      scopeKey,
      templateContext: {
        args: match.args,
        remainder: match.remainder,
        variables,
      },
      source: {
        prefix: warningPrefix,
        description: 'alias "' + match.alias.trigger + '"',
      },
      aliasContext: {
        depth: depth + 1,
        trail: [...trail, match.alias.id],
      },
      expandCommandsAsAliases: true,
    });

    sent = sent || result.sent;
    localOnly = localOnly || result.localOnly || result.handled;
  }

  return { sent, localOnly, handled };
}

export function executeTriggerMatches(matches, scopeKey, options = {}) {
  if (!Array.isArray(matches) || !matches.length) return;

  const appendMessage = options.appendMessage;
  const sendCommand = options.sendCommand;

  for (const match of matches) {
    for (const step of match.trigger.steps || []) {
      const variables = aliasManager.getScopeSnapshot(scopeKey).variables;
      executeAutomationStep(step, {
        appendMessage,
        sendCommand,
        scopeKey,
        templateContext: {
          args: match.captures,
          remainder: match.fullMatch,
          variables,
        },
        source: {
          prefix: 'Trigger',
          description: 'pattern "' + match.trigger.pattern + '"',
        },
        aliasContext: {
          depth: 0,
          trail: [],
        },
      });
    }
  }
}

export function getAutomationStepLabel(step) {
  if (!step || typeof step !== 'object') return 'Step';
  if (step.type === 'set_variable') return 'Set $' + (step.name || '');
  if (step.type === 'show_message') return 'Show';
  if (step.type === 'set_trigger_enabled') return describeMode(normalizeMode(step.mode)) + ' trigger';
  if (step.type === 'set_alias_enabled') return describeMode(normalizeMode(step.mode)) + ' alias';
  if (step.type === 'run_alias') return 'Run alias';
  return 'Send';
}
