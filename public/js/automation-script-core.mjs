const MAX_SCRIPT_NESTING = 5;

const ACTION_ALIASES = {
  send: 'send_command',
  show: 'show_message',
  run_alias: 'run_alias',
  enable_alias: 'set_alias_enabled',
  disable_alias: 'set_alias_enabled',
  toggle_alias: 'set_alias_enabled',
  enable_trigger: 'set_trigger_enabled',
  disable_trigger: 'set_trigger_enabled',
  toggle_trigger: 'set_trigger_enabled',
  set: 'set_variable',
  play_sound: 'play_sound',
};

function lineDiagnostic(line, message) {
  return 'Line ' + line + ': ' + message;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    if (quote) {
      if (ch === '\\') {
        index++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, index);
  }
  return line;
}

function parseAction(text, line) {
  const trimmed = String(text || '').trim();
  const commandMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\b\s*([\s\S]*)$/);
  if (!commandMatch) {
    return { node: null, error: lineDiagnostic(line, 'Unknown script action.') };
  }

  const command = commandMatch[1].toLowerCase();
  const arg = commandMatch[2] || '';
  const type = ACTION_ALIASES[command];

  if (!type) {
    return { node: null, error: lineDiagnostic(line, 'Unknown script action "' + commandMatch[1] + '".') };
  }

  if (type === 'set_variable') {
    const setMatch = arg.match(/^\$?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
    if (!setMatch) {
      return { node: null, error: lineDiagnostic(line, 'Set actions must look like "set $name = value".') };
    }
    return {
      node: {
        type: 'action',
        line,
        step: { type, name: setMatch[1], template: setMatch[2] },
      },
      error: null,
    };
  }

  if (type === 'set_alias_enabled' || type === 'set_trigger_enabled') {
    const mode = command.startsWith('enable_') ? 'enable'
      : command.startsWith('disable_') ? 'disable'
        : 'toggle';
    if (!arg.trim()) {
      return { node: null, error: lineDiagnostic(line, commandMatch[1] + ' requires a target.') };
    }
    return {
      node: {
        type: 'action',
        line,
        step: { type, mode, target: arg.trim() },
      },
      error: null,
    };
  }

  if (type === 'play_sound') {
    const soundMatch = arg.trim().match(/^([^/\s]+)\/([^\s]+)(?:\s+([0-9]+(?:\.[0-9]+)?))?$/);
    if (!soundMatch) {
      return { node: null, error: lineDiagnostic(line, 'play_sound must look like "play_sound category/sound [volume]".') };
    }
    let volume = soundMatch[3] === undefined ? 1 : Number(soundMatch[3]);
    if (!Number.isFinite(volume)) volume = 1;
    if (volume > 1) volume = volume / 100;
    return {
      node: {
        type: 'action',
        line,
        step: {
          type,
          category: soundMatch[1],
          sound: soundMatch[2],
          volume: Math.max(0, Math.min(1, volume)),
        },
      },
      error: null,
    };
  }

  if (!arg.trim()) {
    return { node: null, error: lineDiagnostic(line, commandMatch[1] + ' requires content.') };
  }

  return {
    node: {
      type: 'action',
      line,
      step: { type, template: arg },
    },
    error: null,
  };
}

function currentSteps(stack) {
  const frame = stack[stack.length - 1];
  if (frame.kind === 'root') return frame.steps;
  return frame.activeSteps;
}

export function parseAutomationScript(script) {
  const diagnostics = [];
  const root = { kind: 'root', steps: [] };
  const stack = [root];
  const lines = String(script || '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const text = stripComment(rawLine).trim();
    let match;

    if (!text) return;

    if ((match = text.match(/^if\s+([\s\S]+)$/i))) {
      if (stack.length > MAX_SCRIPT_NESTING) {
        diagnostics.push(lineDiagnostic(line, 'Conditional nesting is limited to ' + MAX_SCRIPT_NESTING + ' levels.'));
        return;
      }
      const node = {
        type: 'if',
        line,
        branches: [{ line, condition: match[1].trim(), steps: [] }],
        elseSteps: null,
      };
      currentSteps(stack).push(node);
      stack.push({ kind: 'if', node, activeSteps: node.branches[0].steps, hasElse: false });
      return;
    }

    if ((match = text.match(/^elseif\s+([\s\S]+)$/i))) {
      const frame = stack[stack.length - 1];
      if (!frame || frame.kind !== 'if') {
        diagnostics.push(lineDiagnostic(line, 'elseif without a matching if.'));
        return;
      }
      if (frame.hasElse) {
        diagnostics.push(lineDiagnostic(line, 'elseif cannot appear after else.'));
        return;
      }
      const branch = { line, condition: match[1].trim(), steps: [] };
      frame.node.branches.push(branch);
      frame.activeSteps = branch.steps;
      return;
    }

    if (/^else$/i.test(text)) {
      const frame = stack[stack.length - 1];
      if (!frame || frame.kind !== 'if') {
        diagnostics.push(lineDiagnostic(line, 'else without a matching if.'));
        return;
      }
      if (frame.hasElse) {
        diagnostics.push(lineDiagnostic(line, 'Duplicate else for the same if.'));
        return;
      }
      frame.hasElse = true;
      frame.node.elseSteps = [];
      frame.activeSteps = frame.node.elseSteps;
      return;
    }

    if (/^end$/i.test(text)) {
      if (stack.length === 1) {
        diagnostics.push(lineDiagnostic(line, 'end without a matching if.'));
        return;
      }
      stack.pop();
      return;
    }

    const result = parseAction(text, line);
    if (result.error) diagnostics.push(result.error);
    else currentSteps(stack).push(result.node);
  });

  for (let index = stack.length - 1; index > 0; index--) {
    diagnostics.push(lineDiagnostic(stack[index].node.line, 'Missing end for if block.'));
  }

  if (!root.steps.length && !diagnostics.length) {
    diagnostics.push('Script must contain at least one action.');
  }

  return { ast: root.steps, diagnostics };
}

function resolveOperand(raw, context, resolveTemplate) {
  const result = resolveTemplate(String(raw || '').trim(), context);
  return {
    text: String(result.text ?? ''),
    missingVariables: Array.isArray(result.missingVariables) ? result.missingVariables : [],
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

function parseRegexLiteral(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith('/')) return { regex: null, error: 'Regex must use /pattern/flags syntax.' };

  let escaped = false;
  for (let index = 1; index < text.length; index++) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '/') {
      const pattern = text.slice(1, index);
      const flags = text.slice(index + 1);
      try {
        return { regex: new RegExp(pattern, flags), error: null };
      } catch (error) {
        return { regex: null, error: error instanceof Error ? error.message : 'Invalid regex.' };
      }
    }
  }

  return { regex: null, error: 'Regex is missing a closing slash.' };
}

function numericCompare(left, right, op) {
  const a = Number(left.trim());
  const b = Number(right.trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { value: false, error: 'Numeric comparison requires numeric values.' };
  }
  if (op === '<') return { value: a < b, error: null };
  if (op === '<=') return { value: a <= b, error: null };
  if (op === '>') return { value: a > b, error: null };
  return { value: a >= b, error: null };
}

export function evaluateAutomationCondition(condition, context, resolveTemplate) {
  const source = String(condition || '').trim();
  let match;

  if (!source) return { value: false, diagnostics: ['Condition is empty.'] };

  if ((match = source.match(/^(exists|not_exists|empty|not_empty)\s+([\s\S]+)$/i))) {
    const op = match[1].toLowerCase();
    const resolved = resolveOperand(match[2], context, resolveTemplate);
    const diagnostics = [];
    if (resolved.missingVariables.length) {
      diagnostics.push('Missing variable' + (resolved.missingVariables.length === 1 ? '' : 's') + ' '
        + resolved.missingVariables.map((name) => '$' + name).join(', ') + '.');
    }
    if (resolved.errors.length) diagnostics.push(...resolved.errors);
    if (diagnostics.length) return { value: false, diagnostics };

    const hasValue = resolved.text.trim() !== '';
    if (op === 'exists' || op === 'not_empty') return { value: hasValue, diagnostics: [] };
    return { value: !hasValue, diagnostics: [] };
  }

  const wordMatch = source.match(/^([\s\S]+?)\s+(contains|not_contains|matches|not_matches)\s+([\s\S]+)$/i);
  const symbolMatch = source.match(/^([\s\S]+?)\s*(==|!=|<=|>=|<|>)\s*([\s\S]+)$/);
  match = wordMatch || symbolMatch;
  if (!match) {
    return { value: false, diagnostics: ['Unsupported condition "' + source + '".'] };
  }

  const left = resolveOperand(match[1], context, resolveTemplate);
  const op = match[2].toLowerCase();
  const rightRaw = match[3];
  const diagnostics = [];

  if (left.missingVariables.length) {
    diagnostics.push('Missing variable' + (left.missingVariables.length === 1 ? '' : 's') + ' '
      + left.missingVariables.map((name) => '$' + name).join(', ') + '.');
  }
  if (left.errors.length) diagnostics.push(...left.errors);

  if (op === 'matches' || op === 'not_matches') {
    const parsed = parseRegexLiteral(rightRaw);
    if (parsed.error) diagnostics.push(parsed.error);
    if (diagnostics.length) return { value: false, diagnostics };
    const matched = parsed.regex.test(left.text);
    return { value: op === 'matches' ? matched : !matched, diagnostics: [] };
  }

  const right = resolveOperand(rightRaw, context, resolveTemplate);
  if (right.missingVariables.length) {
    diagnostics.push('Missing variable' + (right.missingVariables.length === 1 ? '' : 's') + ' '
      + right.missingVariables.map((name) => '$' + name).join(', ') + '.');
  }
  if (right.errors.length) diagnostics.push(...right.errors);
  if (diagnostics.length) return { value: false, diagnostics };

  if (op === '==') return { value: left.text === right.text, diagnostics: [] };
  if (op === '!=') return { value: left.text !== right.text, diagnostics: [] };
  if (op === 'contains') return { value: left.text.includes(right.text), diagnostics: [] };
  if (op === 'not_contains') return { value: !left.text.includes(right.text), diagnostics: [] };

  const comparison = numericCompare(left.text, right.text, op);
  return {
    value: comparison.value,
    diagnostics: comparison.error ? [comparison.error] : [],
  };
}

export function getAutomationScriptDiagnostics(script) {
  return parseAutomationScript(script).diagnostics;
}
