import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateArithmeticExpression,
  formatArithmeticResult,
  isArithmeticExpressionCandidate,
} from '../public/js/alias-expression-core.mjs';

function evaluate(expression, context = {}) {
  const missingVariables = new Set();
  const result = evaluateArithmeticExpression(expression, {
    args: [],
    remainder: '',
    variables: {},
    ...context,
  }, missingVariables);
  return {
    ...result,
    missingVariables: Array.from(missingVariables),
  };
}

test('detects arithmetic expression candidates', () => {
  assert.equal(isArithmeticExpressionCandidate('$var'), false);
  assert.equal(isArithmeticExpressionCandidate('$left + $right'), true);
  assert.equal(isArithmeticExpressionCandidate('($value)'), true);
  assert.equal(isArithmeticExpressionCandidate('north/south'), false);
});

test('adds and subtracts variables', () => {
  assert.deepStrictEqual(
    evaluate('$var1 + $var2', { variables: { var1: '7', var2: '5' } }),
    { text: '12', errors: [], missingVariables: [] }
  );
  assert.deepStrictEqual(
    evaluate('$var1 - $var2', { variables: { var1: '7', var2: '5' } }),
    { text: '2', errors: [], missingVariables: [] }
  );
});

test('multiplies, divides, and formats decimal results', () => {
  assert.deepStrictEqual(
    evaluate('$value * 3', { variables: { value: '4' } }),
    { text: '12', errors: [], missingVariables: [] }
  );
  assert.deepStrictEqual(
    evaluate('$value / 4', { variables: { value: '3' } }),
    { text: '0.75', errors: [], missingVariables: [] }
  );
  assert.equal(formatArithmeticResult(0.1 + 0.2), '0.3');
});

test('supports precedence, parentheses, and unary minus', () => {
  assert.deepStrictEqual(
    evaluate('($var1 + $var2) * -2', { variables: { var1: '7', var2: '5' } }),
    { text: '-24', errors: [], missingVariables: [] }
  );
  assert.deepStrictEqual(
    evaluate('$var1 + $var2 * 2', { variables: { var1: '7', var2: '5' } }),
    { text: '17', errors: [], missingVariables: [] }
  );
});

test('supports numeric positional args and remainder', () => {
  assert.deepStrictEqual(
    evaluate('%1 + %2', { args: ['4', '6'] }),
    { text: '10', errors: [], missingVariables: [] }
  );
  assert.deepStrictEqual(
    evaluate('%0 - 3', { remainder: '12' }),
    { text: '9', errors: [], missingVariables: [] }
  );
});

test('reports missing variables and invalid values', () => {
  const missing = evaluate('$missing + 1');
  assert.deepStrictEqual(missing.missingVariables, ['missing']);
  assert.match(missing.errors.join(' '), /Missing variable \$missing/);

  const invalid = evaluate('$value + 1', { variables: { value: 'many' } });
  assert.deepStrictEqual(invalid.missingVariables, []);
  assert.match(invalid.errors.join(' '), /\$value is not numeric/);

  const missingDivisor = evaluate('10 / $missing');
  assert.deepStrictEqual(missingDivisor.missingVariables, ['missing']);
  assert.match(missingDivisor.errors.join(' '), /Missing variable \$missing/);
  assert.doesNotMatch(missingDivisor.errors.join(' '), /Division by zero/);
});

test('reports malformed expressions and division by zero', () => {
  assert.match(evaluate('$value +', { variables: { value: '1' } }).errors.join(' '), /Expected a number/);
  assert.match(evaluate('$value / 0', { variables: { value: '1' } }).errors.join(' '), /Division by zero/);
  assert.match(evaluate('$value + @', { variables: { value: '1' } }).errors.join(' '), /Unexpected token/);
});
