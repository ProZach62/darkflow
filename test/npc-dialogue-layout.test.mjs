import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const styles = readFileSync(join(root, 'public/css/windows.css'), 'utf8');
const mainStyles = readFileSync(join(root, 'public/css/main.css'), 'utf8');
const manager = readFileSync(join(root, 'public/js/window-manager.js'), 'utf8');
const dialogueStyles = styles.match(
  /\/\* .*NPC dialogue overlay[\s\S]*?\/\* .*Shared video display/,
)?.[0] || '';

test('NPC dialogue scroll stays inside the terminal-sized clickable frame', () => {
  assert.match(dialogueStyles, /\.dw-npc-dialogue-overlay \{[\s\S]*?position:\s*fixed/);
  assert.match(dialogueStyles, /\.dw-npc-dialogue-overlay \{[\s\S]*?z-index:\s*20020/);
  assert.match(dialogueStyles, /\.dw-npc-dialogue-overlay \{[\s\S]*?overflow:\s*hidden/);
  assert.match(dialogueStyles, /\.dw-npc-dialogue-frame \{[\s\S]*?display:\s*block/);
  assert.match(dialogueStyles, /\.dw-npc-dialogue-frame \{[\s\S]*?max-height:\s*100%/);
  assert.match(dialogueStyles, /\.dw-npc-dialogue-frame \{[\s\S]*?overflow-y:\s*auto/);
  assert.doesNotMatch(dialogueStyles, /100vh/);
});

test('mobile NPC dialogue prioritizes the scrollable choices over its portrait', () => {
  assert.match(dialogueStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dw-npc-dialogue-portrait \{[\s\S]*?display:\s*none/);
  assert.match(dialogueStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dw-npc-dialogue-bubble \{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1/);
});

test('NPC dialogue close control remains available when portraits are hidden', () => {
  assert.match(manager, /frame\.appendChild\(closeBtn\)/);
  assert.doesNotMatch(manager, /\(portrait \|\| frame\)\.appendChild\(closeBtn\)/);
});

test('NPC dialogue is body-mounted and tracks the main play area', () => {
  assert.match(manager, /const host = document\.body/);
  assert.match(manager, /boundsHost\.getBoundingClientRect\(\)/);
  assert.match(manager, /boundsObserver = new ResizeObserver\(syncBounds\)/);
  assert.match(manager, /win\.boundsObserver\.disconnect\(\)/);
  assert.match(manager, /window\.removeEventListener\('resize', win\.resizeHandler\)/);
});

test('broadcast notices cannot cover dialogue choices with an invisible hitbox', () => {
  assert.match(mainStyles, /\.broadcast-card \{[\s\S]*?pointer-events:\s*none/);
  assert.match(mainStyles, /\.broadcast-close \{[\s\S]*?pointer-events:\s*auto/);
});
