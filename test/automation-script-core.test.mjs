import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAutomationCondition,
  parseAutomationScript,
} from '../public/js/automation-script-core.mjs';

function resolveTemplate(template, context) {
  const text = String(template || '').replace(/\$([A-Za-z_][A-Za-z0-9_]*)|%([0-9])/g, (match, variable, arg) => {
    if (variable) return context.variables[variable] ?? '';
    if (arg === '0') return context.remainder || '';
    return context.args[Number(arg) - 1] ?? '';
  });
  return { text, missingVariables: [], errors: [] };
}

test('parses if elseif else script blocks', () => {
  const parsed = parseAutomationScript(`
    if $hp < 50
      send drink healing potion
    elseif %1 matches /orc/i
      run_alias assist %1
    else
      show Nothing to do.
    end
  `);

  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.ast.length, 1);
  assert.equal(parsed.ast[0].type, 'if');
  assert.equal(parsed.ast[0].branches.length, 2);
  assert.equal(parsed.ast[0].elseSteps.length, 1);
});

test('reports malformed script control flow', () => {
  const parsed = parseAutomationScript(`
    if $hp < 50
      send drink potion
    else
      show ok
    elseif $hp > 90
      show impossible
  `);

  assert.match(parsed.diagnostics.join('\n'), /elseif cannot appear after else/);
  assert.match(parsed.diagnostics.join('\n'), /Missing end/);
});

test('evaluates common condition operators', () => {
  const context = {
    args: ['orc warrior'],
    remainder: 'orc warrior',
    variables: { hp: '42', status: 'hungry' },
  };

  assert.equal(evaluateAutomationCondition('$hp < 50', context, resolveTemplate).value, true);
  assert.equal(evaluateAutomationCondition('$status contains hung', context, resolveTemplate).value, true);
  assert.equal(evaluateAutomationCondition('%1 matches /orc|goblin/i', context, resolveTemplate).value, true);
  assert.equal(evaluateAutomationCondition('not_empty %1', context, resolveTemplate).value, true);
});
