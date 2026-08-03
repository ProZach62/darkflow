import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const styles = readFileSync(join(root, 'public/css/main.css'), 'utf8');
const soundPanel = readFileSync(join(root, 'public/js/sound-panel.js'), 'utf8');
const notificationManager = readFileSync(join(root, 'public/js/notification-manager.js'), 'utf8');

test('toolbar pull-downs elevate above every floating pane', () => {
  assert.match(soundPanel,
    /toolbar\.classList\.toggle\('audio-menu-active', this\.expanded\)/);
  assert.match(notificationManager,
    /toolbar\.classList\.toggle\('notifications-menu-active', this\.state\.open\)/);

  const activeToolbarRule = styles.match(
    /#toolbar\.panels-menu-active,[\s\S]*?z-index:\s*\d+;[\s\S]*?\}/
  )?.[0] || '';
  const toolbarZ = Number(activeToolbarRule.match(/z-index:\s*(\d+)/)?.[1]);
  const maximumFloatingPaneZ = 1000 + (999 * 10) + 9 + 1;

  assert.ok(activeToolbarRule);
  assert.match(activeToolbarRule, /#toolbar\.audio-menu-active/);
  assert.match(activeToolbarRule, /#toolbar\.notifications-menu-active/);
  assert.ok(toolbarZ > maximumFloatingPaneZ,
    `active toolbar layer ${toolbarZ} must exceed floating pane layer ${maximumFloatingPaneZ}`);
});
