const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)/;
const NUMERIC_VALUE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function normalizeContext(context) {
  return {
    args: Array.isArray(context && context.args) ? context.args : [],
    remainder: context && typeof context.remainder === 'string' ? context.remainder : '',
    variables: context && context.variables && typeof context.variables === 'object' ? context.variables : {},
  };
}

function tokenizeExpression(expression) {
  const tokens = [];
  const text = String(expression || '');
  let index = 0;

  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) {
      index++;
      continue;
    }

    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      index++;
      continue;
    }

    if (ch === '$') {
      const match = text.slice(index + 1).match(VARIABLE_RE);
      if (!match) {
        return { error: 'Invalid variable reference in arithmetic expression.' };
      }
      tokens.push({ type: 'reference', value: '$' + match[0] });
      index += match[0].length + 1;
      continue;
    }

    if (ch === '%') {
      const argIndex = text[index + 1];
      if (!/[0-9]/.test(argIndex || '')) {
        return { error: 'Invalid positional argument in arithmetic expression.' };
      }
      tokens.push({ type: 'reference', value: '%' + argIndex });
      index += 2;
      continue;
    }

    const numberMatch = text.slice(index).match(NUMBER_RE);
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }

    return { error: 'Unexpected token "' + ch + '" in arithmetic expression.' };
  }

  return { tokens };
}

function toNumber(value, label, errors) {
  const text = String(value ?? '').trim();
  if (!NUMERIC_VALUE_RE.test(text)) {
    errors.push(label + ' is not numeric.');
    return 0;
  }

  const number = Number(text);
  if (!Number.isFinite(number)) {
    errors.push(label + ' is not numeric.');
    return 0;
  }

  return number;
}

function resolveReference(reference, context, missingVariables, errors) {
  if (reference[0] === '$') {
    const variableName = reference.slice(1);
    if (!Object.prototype.hasOwnProperty.call(context.variables, variableName)) {
      missingVariables.add(variableName);
      errors.push('Missing variable $' + variableName + ' in arithmetic expression.');
      return 0;
    }
    return toNumber(context.variables[variableName], '$' + variableName, errors);
  }

  if (reference === '%0') {
    return toNumber(context.remainder || '', '%0', errors);
  }

  const index = Number(reference.slice(1)) - 1;
  if (index < 0 || index >= context.args.length) {
    errors.push('Missing positional argument ' + reference + ' in arithmetic expression.');
    return 0;
  }

  return toNumber(context.args[index], reference, errors);
}

function createParser(tokens, context, missingVariables, errors) {
  let position = 0;

  function peek() {
    return tokens[position] || null;
  }

  function consume(type) {
    if (peek() && peek().type === type) {
      position++;
      return true;
    }
    return false;
  }

  function parsePrimary() {
    const token = peek();
    if (!token) {
      errors.push('Expected a number, variable, or parenthesized expression.');
      return 0;
    }

    if (consume('+')) return parsePrimary();
    if (consume('-')) return -parsePrimary();

    if (token.type === 'number') {
      position++;
      return Number(token.value);
    }

    if (token.type === 'reference') {
      position++;
      return resolveReference(token.value, context, missingVariables, errors);
    }

    if (consume('(')) {
      const value = parseExpression();
      if (!consume(')')) {
        errors.push('Missing closing parenthesis in arithmetic expression.');
      }
      return value;
    }

    errors.push('Unexpected token "' + token.value + '" in arithmetic expression.');
    position++;
    return 0;
  }

  function parseTerm() {
    let value = parsePrimary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const operator = peek().type;
      position++;
      const errorCountBeforeRight = errors.length;
      const right = parsePrimary();
      if (operator === '*') {
        value *= right;
      } else {
        if (errors.length > errorCountBeforeRight) {
          value = 0;
          continue;
        }
        if (right === 0) {
          errors.push('Division by zero in arithmetic expression.');
          value = 0;
        } else {
          value /= right;
        }
      }
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const operator = peek().type;
      position++;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  return {
    parse() {
      const value = parseExpression();
      if (position < tokens.length) {
        errors.push('Unexpected token "' + tokens[position].value + '" in arithmetic expression.');
      }
      return value;
    },
  };
}

export function isArithmeticExpressionCandidate(expression) {
  const text = String(expression || '').trim();
  return /^[$%.\d(+-]/.test(text) && /[+\-*/()]/.test(text);
}

export function formatArithmeticResult(value) {
  if (!Number.isFinite(value)) return '';
  if (Object.is(value, -0)) return '0';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10)));
}

export function evaluateArithmeticExpression(expression, context, missingVariables = new Set()) {
  const errors = [];
  const normalizedContext = normalizeContext(context);
  const tokenResult = tokenizeExpression(expression);
  if (tokenResult.error) {
    return { text: '', errors: [tokenResult.error] };
  }
  if (!tokenResult.tokens || tokenResult.tokens.length === 0) {
    return { text: '', errors: ['Arithmetic expression is empty.'] };
  }

  const parser = createParser(tokenResult.tokens, normalizedContext, missingVariables, errors);
  const value = parser.parse();
  if (errors.length) {
    return { text: '', errors };
  }

  return {
    text: formatArithmeticResult(value),
    errors: [],
  };
}
