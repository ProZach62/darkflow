import test from 'node:test';
import assert from 'node:assert/strict';

const { parseAnsiText, styleToElement } = await import('../public/js/ansi.js');

function findFragment(fragments, text) {
  return fragments.find((fragment) => fragment.text === text);
}

function createTextNode(text) {
  return {
    nodeType: 3,
    textContent: text,
  };
}

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    attributes: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      this.textContent = (this.textContent || '') + (child.textContent || '');
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] || null;
    },
  };
}

globalThis.document = {
  createTextNode,
  createElement,
};

test('parses ANSI SGR effects and reset codes', () => {
  const fragments = parseAnsiText([
    '\x1b[3mitalic\x1b[23m',
    ' ',
    '\x1b[20mfraktur\x1b[23m',
    ' ',
    '\x1b[8mhidden\x1b[28m',
    ' ',
    '\x1b[9mstrike\x1b[29m',
    ' ',
    '\x1b[21mdouble\x1b[24m',
    ' ',
    '\x1b[53mover\x1b[55m',
    'plain',
  ].join(''));

  assert.equal(findFragment(fragments, 'italic').style.italic, true);
  assert.equal(findFragment(fragments, 'fraktur').style.fraktur, true);
  assert.equal(findFragment(fragments, 'hidden').style.hidden, true);
  assert.equal(findFragment(fragments, 'strike').style.strikethrough, true);
  assert.equal(findFragment(fragments, 'double').style.underline, true);
  assert.equal(findFragment(fragments, 'double').style.doubleUnderline, true);
  assert.equal(findFragment(fragments, 'over').style.overline, true);

  const plain = findFragment(fragments, 'plain');
  assert.equal(plain.style.italic, false);
  assert.equal(plain.style.fraktur, false);
  assert.equal(plain.style.hidden, false);
  assert.equal(plain.style.strikethrough, false);
  assert.equal(plain.style.underline, false);
  assert.equal(plain.style.doubleUnderline, false);
  assert.equal(plain.style.overline, false);
});

test('reset clears all extended ANSI effects', () => {
  const fragments = parseAnsiText('\x1b[1;3;4;5;8;9;20;21;53mall\x1b[0mplain');

  const styled = findFragment(fragments, 'all');
  assert.equal(styled.style.bold, true);
  assert.equal(styled.style.italic, true);
  assert.equal(styled.style.fraktur, true);
  assert.equal(styled.style.underline, true);
  assert.equal(styled.style.doubleUnderline, true);
  assert.equal(styled.style.strikethrough, true);
  assert.equal(styled.style.overline, true);
  assert.equal(styled.style.hidden, true);
  assert.equal(styled.style.blink, true);

  const plain = findFragment(fragments, 'plain');
  assert.equal(plain.style.bold, false);
  assert.equal(plain.style.italic, false);
  assert.equal(plain.style.fraktur, false);
  assert.equal(plain.style.underline, false);
  assert.equal(plain.style.doubleUnderline, false);
  assert.equal(plain.style.strikethrough, false);
  assert.equal(plain.style.overline, false);
  assert.equal(plain.style.hidden, false);
  assert.equal(plain.style.blink, false);
});

test('styleToElement composes visible ANSI effects', () => {
  const node = styleToElement('decorated', {
    italic: true,
    fraktur: true,
    hidden: true,
    underline: true,
    doubleUnderline: true,
    strikethrough: true,
    overline: true,
  });

  assert.equal(node.tagName, 'SPAN');
  assert.match(node.className, /\bansi-italic\b/);
  assert.match(node.className, /\bansi-fraktur\b/);
  assert.match(node.className, /\bansi-hidden\b/);
  assert.match(node.getAttribute('style'), /text-decoration-line:underline line-through overline;/);
  assert.match(node.getAttribute('style'), /text-decoration-style:double;/);
});
