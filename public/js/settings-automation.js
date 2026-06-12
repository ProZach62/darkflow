// Shared editor for the three automation screens: Aliases, Triggers and
// Highlights. All three get the same layout and interaction model so the
// screens stay consistent by construction:
//
//   [ search | New <noun> | scope chip ]
//   [ ordered list + Up/Down/Duplicate/Delete ][ detail pane ]
//   [ pinned, collapsible test bar ]
//
// The list shows items in array order because order is meaningful in every
// scope: aliases match first-hit-wins, triggers run in order, highlight
// rules apply in order. Groups are rendered as row chips, not sections, so
// reordering stays visually honest.
//
// The host argument is the settingsManager object; the editor reads its
// draft scopes (_draftAliasScope/_draftTriggerScope/_draftHighlightScope)
// and uses its focus helpers so focus survives re-renders.

import { aliasManager } from './alias-manager.js';
import { triggerManager } from './trigger-manager.js';
import { highlightManager } from './highlight-manager.js';
import { styleToElement } from './ansi.js';
import { getSoundCatalog, isKnownSound, soundManager, SOUND_CATEGORIES, SOUND_CATEGORY_INFO } from './sound-manager.js';
import { getAutomationStepLabel } from './automation-executor.js';

const AUTOMATION_UI_KEY = 'darkwind-settings-automation-ui';

function normalizeAutomationMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function loadAutomationUiState() {
  try {
    const raw = localStorage.getItem(AUTOMATION_UI_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveAutomationUiState(patch) {
  try {
    localStorage.setItem(AUTOMATION_UI_KEY, JSON.stringify({ ...loadAutomationUiState(), ...patch }));
  } catch (e) { /* ignore */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function smallButton(label, title, onClick) {
  const btn = el('button', 'dw-button dw-button-secondary settings-step-btn', label);
  btn.type = 'button';
  if (title) btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function createFlagPill(label, title, checked, onChange, focusKey) {
  const pill = el('label', 'settings-flag-pill' + (checked ? ' on' : ''));
  pill.title = title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (focusKey) input.dataset.focusKey = focusKey;
  input.addEventListener('change', () => onChange(input.checked));
  pill.appendChild(input);
  pill.appendChild(el('span', '', label));
  return pill;
}

function makeSoundKit() {
  const catalog = getSoundCatalog();
  const categories = SOUND_CATEGORIES.filter((category) => (
    catalog.some((sound) => sound.category === category)
  ));
  const first = catalog[0] || { category: 'alert', sound: 'warning' };
  const forCategory = (category) => catalog.filter((item) => item.category === category);
  return {
    categories,
    first,
    forCategory,
    label(category, sound) {
      const match = catalog.find((item) => item.category === category && item.sound === sound);
      if (match) return match.label;
      return [category, sound].filter(Boolean).join(' / ') || 'No sound selected';
    },
    categoryLabel(category) {
      return SOUND_CATEGORY_INFO[category] ? SOUND_CATEGORY_INFO[category].label : category;
    },
    ensure(step) {
      if (!step.category || !forCategory(step.category).length) step.category = first.category;
      if (!step.sound || !isKnownSound(step.category, step.sound)) {
        const sounds = forCategory(step.category);
        step.sound = sounds[0] ? sounds[0].sound : first.sound;
      }
      if (!Number.isFinite(Number(step.volume))) step.volume = 1;
      step.volume = Math.max(0, Math.min(1, Number(step.volume)));
    },
  };
}

// Renders a resolved step row into a preview body; shared by the alias and
// trigger preview renderers for the step types they have in common.
function appendResolvedStepRow(body, prefix, resolved) {
  const row = el('div', 'settings-alias-preview-step', prefix + ': ' + resolved.text);
  let ok = true;
  if (resolved.missingVariables.length) {
    row.classList.add('warning');
    row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
    ok = false;
  } else if (resolved.errors.length) {
    row.classList.add('warning');
    row.textContent += ' (' + resolved.errors.join(' ') + ')';
    ok = false;
  }
  body.appendChild(row);
  return { row, ok };
}

// Preview row for an enable/disable/toggle step that references its target
// by id; mutates the preview copy so later steps see the change.
function appendTargetIdPreviewRow(body, step, items, patternOf) {
  const target = items.find((item) => item.id === step.targetId);
  const label = target ? (String(target.description || '').trim() || patternOf(target)) : '';
  const row = el('div', 'settings-alias-preview-step', getAutomationStepLabel(step) + ': ' + label);
  if (!target) {
    row.classList.add('warning');
    row.textContent += '(target no longer exists)';
  } else {
    const mode = normalizeAutomationMode(step.mode);
    target.enabled = mode === 'toggle' ? target.enabled === false : mode === 'enable';
    row.textContent += ' -> ' + (target.enabled === false ? 'disabled' : 'enabled');
  }
  body.appendChild(row);
}

function appendStepsEditor(container, owner, opts, api) {
  container.appendChild(el('div', 'settings-label', 'Steps'));

  const stepList = el('div', 'settings-alias-step-list');
  const optionValueFor = (step) => (
    step.type === opts.toggleTargetType
      ? opts.toggleTargetType + ':' + normalizeAutomationMode(step.mode)
      : step.type
  );

  owner.steps.forEach((step, index) => {
    const card = el('div', 'settings-alias-step-card settings-step-card');
    const head = el('div', 'settings-step-head');
    head.appendChild(el('span', 'settings-step-index', String(index + 1)));

    const typeSelect = el('select', 'dw-select');
    typeSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-type';
    opts.stepTypes.forEach((option) => {
      const optionEl = el('option', '', option.label);
      optionEl.value = option.value;
      if (optionValueFor(step) === option.value) optionEl.selected = true;
      typeSelect.appendChild(optionEl);
    });
    typeSelect.addEventListener('change', () => {
      const selected = opts.stepTypes.find((option) => option.value === typeSelect.value) || opts.stepTypes[0];
      step.type = selected.type;
      if (selected.mode) step.mode = selected.mode;
      else delete step.mode;
      if (step.type !== 'set_variable') delete step.name;
      if (step.type !== opts.toggleTargetType) {
        delete step.target;
        delete step.targetId;
      }
      if (step.type === opts.toggleTargetType && !step.target) step.target = '';
      if (opts.sounds && step.type === 'play_sound') {
        delete step.template;
        opts.sounds.ensure(step);
      } else {
        delete step.category;
        delete step.sound;
        delete step.volume;
        if (!step.template) step.template = '';
      }
      api.render();
    });
    head.appendChild(typeSelect);

    head.appendChild(el('span', 'settings-step-spacer'));

    const upBtn = smallButton('Up', 'Move step up', () => {
      if (index === 0) return;
      const previous = owner.steps[index - 1];
      owner.steps[index - 1] = step;
      owner.steps[index] = previous;
      api.render();
      api.focus(opts.focusPrefix + '-step-' + (index - 1) + '-type');
    });
    upBtn.disabled = index === 0;

    const downBtn = smallButton('Dn', 'Move step down', () => {
      if (index === owner.steps.length - 1) return;
      const next = owner.steps[index + 1];
      owner.steps[index + 1] = step;
      owner.steps[index] = next;
      api.render();
      api.focus(opts.focusPrefix + '-step-' + (index + 1) + '-type');
    });
    downBtn.disabled = index === owner.steps.length - 1;

    const removeBtn = smallButton('X', 'Remove step', () => {
      owner.steps.splice(index, 1);
      if (!owner.steps.length) owner.steps.push({ type: 'send_command', template: '' });
      api.render();
      api.focus(opts.focusPrefix + '-step-' + Math.min(index, owner.steps.length - 1) + '-type');
    });

    head.appendChild(upBtn);
    head.appendChild(downBtn);
    head.appendChild(removeBtn);
    card.appendChild(head);

    if (step.type === 'set_variable') {
      const nameInput = el('input', 'dw-input');
      nameInput.type = 'text';
      nameInput.placeholder = opts.variableNamePlaceholder;
      nameInput.title = 'Variable name to write';
      nameInput.value = step.name || '';
      nameInput.addEventListener('input', () => {
        step.name = nameInput.value;
      });
      card.appendChild(nameInput);
    }

    if (opts.sounds && step.type === 'play_sound') {
      opts.sounds.ensure(step);
      const soundRow = el('div', 'settings-step-sound-row');

      const categorySelect = el('select', 'dw-select');
      categorySelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound-category';
      opts.sounds.categories.forEach((category) => {
        const option = el('option', '', opts.sounds.categoryLabel(category));
        option.value = category;
        if (step.category === category) option.selected = true;
        categorySelect.appendChild(option);
      });
      categorySelect.addEventListener('change', () => {
        step.category = categorySelect.value;
        const sounds = opts.sounds.forCategory(step.category);
        step.sound = sounds[0] ? sounds[0].sound : '';
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-sound-category');
      });
      soundRow.appendChild(categorySelect);

      const soundSelect = el('select', 'dw-select');
      soundSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound';
      opts.sounds.forCategory(step.category).forEach((item) => {
        const option = el('option', '', item.label.replace(opts.sounds.categoryLabel(item.category) + ' / ', ''));
        option.value = item.sound;
        if (step.sound === item.sound) option.selected = true;
        soundSelect.appendChild(option);
      });
      soundSelect.addEventListener('change', () => {
        step.sound = soundSelect.value;
        api.renderPreview();
      });
      soundRow.appendChild(soundSelect);

      const volumeInput = document.createElement('input');
      volumeInput.type = 'range';
      volumeInput.min = '0';
      volumeInput.max = '100';
      volumeInput.value = String(Math.round(step.volume * 100));
      volumeInput.title = 'Volume';
      volumeInput.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound-volume';
      const volumeValue = el('span', 'settings-helper-text', Math.round(step.volume * 100) + '%');
      volumeInput.addEventListener('input', () => {
        step.volume = Number(volumeInput.value) / 100;
        volumeValue.textContent = volumeInput.value + '%';
        api.renderPreview();
      });
      soundRow.appendChild(volumeInput);
      soundRow.appendChild(volumeValue);

      soundRow.appendChild(smallButton('Test', 'Play this sound now', () => {
        soundManager.play(step.category, step.sound, step.volume);
      }));
      card.appendChild(soundRow);
    } else if (step.type === opts.toggleTargetType) {
      // Pick the target from a dropdown of existing items, shown by name.
      // The step stores the target's id; legacy steps that stored a pattern
      // are preselected when the pattern still matches an item.
      const targetSelect = el('select', 'dw-select settings-step-target');
      targetSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-target';
      targetSelect.title = 'Pick the ' + opts.targetNoun + ' this step enables or disables.';

      const items = opts.targetItems();
      const nameCounts = {};
      items.forEach((item) => {
        const name = String(item.description || '').trim();
        if (name) nameCounts[name] = (nameCounts[name] || 0) + 1;
      });
      const legacyMatch = !step.targetId && step.target
        ? items.find((item) => opts.targetPattern(item) === step.target)
        : null;
      const selectedId = step.targetId || (legacyMatch ? legacyMatch.id : '');

      const article = opts.targetNoun === 'alias' ? 'an' : 'a';
      const placeholder = el('option', '', step.target && !selectedId
        ? 'Unresolved: ' + step.target
        : 'Select ' + article + ' ' + opts.targetNoun + '...');
      placeholder.value = '';
      if (!selectedId) placeholder.selected = true;
      targetSelect.appendChild(placeholder);

      items.forEach((item) => {
        const name = String(item.description || '').trim();
        const pattern = opts.targetPattern(item);
        let label = name || pattern || '(untitled)';
        if (name && nameCounts[name] > 1) label = name + ' (' + pattern + ')';
        const option = el('option', '', label);
        option.value = item.id;
        if (item.id === selectedId) option.selected = true;
        targetSelect.appendChild(option);
      });

      targetSelect.addEventListener('change', () => {
        step.targetId = targetSelect.value;
        step.target = '';
        // Full render so the diagnostics box reflects the new selection.
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-target');
      });
      card.appendChild(targetSelect);
    } else {
      // Everything else takes a template; for set_variable it is the value
      // to write (the name input above selects the variable).
      const templateInput = el('textarea', 'dw-input settings-alias-template settings-step-template');
      templateInput.placeholder = opts.templatePlaceholder(step);
      templateInput.value = step.template || '';
      templateInput.addEventListener('input', () => {
        step.template = templateInput.value;
      });
      card.appendChild(templateInput);
    }

    stepList.appendChild(card);
  });

  container.appendChild(stepList);

  const addRow = el('div', 'settings-add-step-row');
  const addSelect = el('select', 'dw-select settings-add-step');
  addSelect.dataset.focusKey = opts.focusPrefix + '-step-add';
  const placeholderOption = el('option', '', '+ Add step...');
  placeholderOption.value = '';
  addSelect.appendChild(placeholderOption);
  opts.stepTypes.forEach((option) => {
    const optionEl = el('option', '', option.label);
    optionEl.value = option.value;
    addSelect.appendChild(optionEl);
  });
  addSelect.addEventListener('change', () => {
    const selected = opts.stepTypes.find((option) => option.value === addSelect.value);
    addSelect.value = '';
    if (!selected) return;
    const step = { type: selected.type, template: '' };
    if (selected.mode) step.mode = selected.mode;
    if (selected.type === 'set_variable') step.name = '';
    if (selected.type === opts.toggleTargetType) step.target = '';
    if (opts.sounds && selected.type === 'play_sound') {
      delete step.template;
      step.category = opts.sounds.first.category;
      step.sound = opts.sounds.first.sound;
      step.volume = 1;
    }
    owner.steps.push(step);
    api.render();
    api.focus(opts.focusPrefix + '-step-' + (owner.steps.length - 1) + '-type');
  });
  addRow.appendChild(addSelect);

  const help = el('details', 'settings-syntax-help');
  help.appendChild(el('summary', '', 'Template syntax'));
  help.appendChild(el('p', 'dw-paragraph', opts.syntaxHelp));
  addRow.appendChild(help);
  container.appendChild(addRow);
}

function buildConfig(host, kind) {
  if (kind === 'alias') {
    const sounds = null;
    return {
      kind,
      noun: 'alias',
      plural: 'aliases',
      scopeKey: () => host._aliasScopeKey,
      scopeHint: 'Aliases and variables are saved separately for each server connection target.',
      list: () => host._draftAliasScope.aliases,
      replaceList: (items) => { host._draftAliasScope.aliases = items; },
      create: () => aliasManager.createEmptyAlias(),
      getPattern: (item) => item.trigger,
      setPattern: (item, value) => { item.trigger = value; },
      patternLabel: 'Pattern',
      patternPlaceholder: (item) => (item.isRegex ? '^gi\\s+(.+)$' : 'gi'),
      emptyText: 'No aliases defined for this scope.',
      emptyDetailText: 'Create an alias to start building client-side command shortcuts.',
      nameRequired: true,
      namePlaceholder: 'Give to pack animal',
      haystack: (item) => (item.trigger + ' ' + item.description + ' ' + (item.group || '')).toLowerCase(),
      rowMeta: (item) => (String(item.description || '').trim()
        ? item.trigger
        : (item.isRegex ? 'regex, ' : '') + item.steps.length + ' step' + (item.steps.length === 1 ? '' : 's')),
      diagnostics: (item) => aliasManager.getAliasDiagnostics(host._draftAliasScope, item.id),
      initialSelectedId: () => {
        const pending = host._pendingAliasSelection;
        host._pendingAliasSelection = null;
        return pending;
      },
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled aliases stay saved but never match or expand.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
        createFlagPill('Regex', 'Treat the pattern as a JavaScript regular expression. Capture groups become %1-%9.',
          item.isRegex === true, (checked) => { item.isRegex = checked; api.render(); }),
        item.isRegex ? createFlagPill('Ignore case', 'Match without caring about capitalization.',
          item.ignoreCase !== false, (checked) => { item.ignoreCase = checked; api.render(); }) : null,
      ].filter(Boolean),
      renderBody: (item, api, container) => {
        appendStepsEditor(container, item, {
          focusPrefix: 'alias',
          toggleTargetType: 'set_trigger_enabled',
          targetNoun: 'trigger',
          targetItems: () => host._draftTriggerScope.triggers,
          targetPattern: (item) => item.pattern,
          variableNamePlaceholder: 'pack',
          sounds,
          stepTypes: [
            { value: 'send_command', type: 'send_command', label: 'Send command' },
            { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
            { value: 'show_message', type: 'show_message', label: 'Show local message' },
            { value: 'set_trigger_enabled:toggle', type: 'set_trigger_enabled', mode: 'toggle', label: 'Toggle trigger' },
            { value: 'set_trigger_enabled:enable', type: 'set_trigger_enabled', mode: 'enable', label: 'Enable trigger' },
            { value: 'set_trigger_enabled:disable', type: 'set_trigger_enabled', mode: 'disable', label: 'Disable trigger' },
          ],
          templatePlaceholder: (step) => (
            step.type === 'show_message' ? 'Pack animal set to: $pack'
              : step.type === 'set_variable' ? '%0'
                : 'give %0 to $pack'
          ),
          syntaxHelp: 'Simple aliases match command words; %0 is everything after the alias. '
            + 'Regex aliases use JavaScript regular expressions with capture groups as %1-%9. '
            + 'Templates support $name variables and ${lower:%1} or ${lower:$name} for lowercase.',
        }, api);
      },
      preview: {
        title: 'Test input',
        hint: 'Type a command line to see which alias matches and what it will do.',
        defaultSample: '',
        makeInput: (onInput) => {
          const input = el('input', 'dw-input');
          input.type = 'text';
          input.placeholder = 'Example: gi sword';
          input.addEventListener('input', () => onInput(input.value));
          return input;
        },
        render: (body, sample) => {
          body.textContent = '';
          if (!sample.trim()) return '';
          const match = aliasManager.matchAliasInAliases(sample, host._draftAliasScope.aliases);
          if (!match) {
            body.appendChild(el('div', 'settings-alias-empty', 'No enabled alias matches this input.'));
            return 'no match';
          }
          body.appendChild(el('div', 'settings-alias-preview-match', 'Matches: ' + match.alias.trigger));

          const previewVariables = { ...host._draftAliasScope.variables };
          const previewTriggers = host._draftTriggerScope.triggers.map((trigger) => ({ ...trigger }));

          for (const step of match.alias.steps) {
            if (step.type === 'set_trigger_enabled' && step.targetId) {
              appendTargetIdPreviewRow(body, step, previewTriggers, (item) => item.pattern);
              continue;
            }

            const resolved = aliasManager.resolveTemplate(
              step.type === 'set_trigger_enabled' ? step.target : step.template,
              { args: match.args, remainder: match.remainder, variables: previewVariables }
            );

            if (step.type === 'set_trigger_enabled') {
              const target = resolved.text.trim();
              const mode = normalizeAutomationMode(step.mode);
              const trigger = previewTriggers.find((item) => item.pattern === target);
              const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), { ...resolved, text: target });
              if (!ok) continue;
              if (!target || !trigger) {
                row.classList.add('warning');
                row.textContent += target ? ' (trigger not found)' : ' (empty target)';
              } else {
                trigger.enabled = mode === 'toggle' ? trigger.enabled === false : mode === 'enable';
                row.textContent += ' -> ' + (trigger.enabled === false ? 'disabled' : 'enabled');
              }
              continue;
            }

            let prefix = 'Send';
            if (step.type === 'set_variable') prefix = 'Set $' + step.name;
            if (step.type === 'show_message') prefix = 'Show';
            const { row, ok } = appendResolvedStepRow(body, prefix, resolved);
            if (!ok) continue;
            if (step.type === 'set_variable' && step.name) previewVariables[step.name] = resolved.text;
          }
          return 'matches ' + match.alias.trigger;
        },
      },
    };
  }

  if (kind === 'trigger') {
    const sounds = makeSoundKit();
    return {
      kind,
      noun: 'trigger',
      plural: 'triggers',
      scopeKey: () => host._triggerScopeKey,
      scopeHint: 'Triggers are saved separately for each server connection target and react to incoming output lines.',
      list: () => host._draftTriggerScope.triggers,
      replaceList: (items) => { host._draftTriggerScope.triggers = items; },
      create: () => triggerManager.createEmptyTrigger(),
      getPattern: (item) => item.pattern,
      setPattern: (item, value) => { item.pattern = value; },
      patternLabel: 'Pattern',
      patternPlaceholder: (item) => (item.isRegex ? 'You are attacked by (.+)' : 'You are attacked by *'),
      emptyText: 'No triggers defined for this scope.',
      emptyDetailText: 'Create a trigger to react to incoming output lines.',
      nameRequired: true,
      namePlaceholder: 'Attack response',
      haystack: (item) => (item.pattern + ' ' + item.description + ' ' + (item.group || '')).toLowerCase(),
      rowMeta: (item) => {
        if (String(item.description || '').trim()) return item.pattern;
        const prefix = item.isRegex ? 'regex, ' : '';
        if (item.gag) return prefix + 'gag enabled';
        if (item.steps[0] && item.steps[0].type === 'play_sound') {
          return prefix + 'Play sound: ' + sounds.label(item.steps[0].category, item.steps[0].sound);
        }
        return prefix + item.steps.length + ' step' + (item.steps.length === 1 ? '' : 's');
      },
      diagnostics: (item) => triggerManager.getTriggerDiagnostics(host._draftTriggerScope, item.id),
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled triggers stay saved but never match incoming output.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
        createFlagPill('Regex', 'Treat the pattern as a JavaScript regular expression. Capture groups become %1-%9.',
          item.isRegex === true, (checked) => { item.isRegex = checked; api.render(); }),
        item.isRegex ? createFlagPill('Ignore case', 'Match without caring about capitalization.',
          item.ignoreCase === true, (checked) => { item.ignoreCase = checked; api.render(); }) : null,
        createFlagPill('Gag line', 'Hide matched lines from the terminal after this trigger runs.',
          item.gag === true, (checked) => { item.gag = checked; api.renderPreview(); }),
      ].filter(Boolean),
      renderBody: (item, api, container) => {
        appendStepsEditor(container, item, {
          focusPrefix: 'trigger',
          toggleTargetType: 'set_alias_enabled',
          targetNoun: 'alias',
          targetItems: () => host._draftAliasScope.aliases,
          targetPattern: (item) => item.trigger,
          variableNamePlaceholder: 'enemy',
          sounds,
          stepTypes: [
            { value: 'send_command', type: 'send_command', label: 'Send command' },
            { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
            { value: 'show_message', type: 'show_message', label: 'Show local message' },
            { value: 'set_alias_enabled:toggle', type: 'set_alias_enabled', mode: 'toggle', label: 'Toggle alias' },
            { value: 'set_alias_enabled:enable', type: 'set_alias_enabled', mode: 'enable', label: 'Enable alias' },
            { value: 'set_alias_enabled:disable', type: 'set_alias_enabled', mode: 'disable', label: 'Disable alias' },
            { value: 'run_alias', type: 'run_alias', label: 'Run alias' },
            { value: 'play_sound', type: 'play_sound', label: 'Play sound' },
          ],
          templatePlaceholder: (step) => (
            step.type === 'show_message' ? 'Attacker: %1'
              : step.type === 'set_variable' ? '%1'
                : step.type === 'run_alias' ? 'assist %1'
                  : 'kill %1'
          ),
          syntaxHelp: 'Simple patterns support * or %1-%9 as captures. '
            + 'Regex triggers use JavaScript regular expressions with capture groups as %1-%9. '
            + 'Templates support %0 for the full match, $name variables, and ${lower:%1} or ${lower:$name} for lowercase.',
        }, api);
      },
      preview: {
        title: 'Test output',
        hint: 'Paste an incoming line to see which triggers match, what they capture, and what they will run.',
        defaultSample: '',
        makeInput: (onInput) => {
          const input = el('textarea', 'dw-input settings-alias-template settings-preview-sample');
          input.placeholder = 'Example incoming line';
          input.addEventListener('input', () => onInput(input.value));
          return input;
        },
        render: (body, sample) => {
          body.textContent = '';
          if (!sample.trim()) return '';
          const result = triggerManager.evaluateLine(sample, host._triggerScopeKey, host._draftTriggerScope);
          if (!result.matches.length) {
            body.appendChild(el('div', 'settings-alias-empty', 'No enabled trigger matches this output.'));
            return 'no match';
          }

          const previewVariables = { ...host._draftAliasScope.variables };
          const previewAliases = host._draftAliasScope.aliases.map((alias) => ({
            ...alias,
            steps: alias.steps.map((step) => ({ ...step })),
          }));

          result.matches.forEach((match) => {
            body.appendChild(el('div', 'settings-alias-preview-match',
              'Matches: ' + match.trigger.pattern + (match.trigger.gag ? ' [gag]' : '')));
            body.appendChild(el('div', 'settings-helper-text', match.captures.length
              ? match.captures.map((value, index) => '%' + (index + 1) + '=' + value).join(' | ')
              : 'No captures'));

            for (const step of match.trigger.steps || []) {
              if (step.type === 'play_sound') {
                const row = el('div', 'settings-alias-preview-step',
                  getAutomationStepLabel(step) + ': ' + sounds.label(step.category, step.sound));
                if (!isKnownSound(step.category, step.sound)) {
                  row.classList.add('warning');
                  row.textContent += ' (sound not found)';
                }
                body.appendChild(row);
                continue;
              }

              if (step.type === 'set_alias_enabled' && step.targetId) {
                appendTargetIdPreviewRow(body, step, previewAliases, (item) => item.trigger);
                continue;
              }

              const resolved = aliasManager.resolveTemplate(
                step.type === 'set_alias_enabled' ? step.target : step.template,
                { args: match.captures, remainder: match.fullMatch, variables: previewVariables }
              );

              if (step.type === 'set_alias_enabled') {
                const target = resolved.text.trim();
                const mode = normalizeAutomationMode(step.mode);
                const alias = previewAliases.find((item) => (
                  item.trigger.trim().replace(/\s+/g, ' ').toLowerCase() === target.trim().replace(/\s+/g, ' ').toLowerCase()
                ));
                const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), { ...resolved, text: target });
                if (!ok) continue;
                if (!target || !alias) {
                  row.classList.add('warning');
                  row.textContent += target ? ' (alias not found)' : ' (empty target)';
                } else {
                  alias.enabled = mode === 'toggle' ? alias.enabled === false : mode === 'enable';
                  row.textContent += ' -> ' + (alias.enabled === false ? 'disabled' : 'enabled');
                }
                continue;
              }

              if (step.type === 'run_alias') {
                const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), resolved);
                if (!ok) continue;
                const aliasMatch = aliasManager.matchAliasInAliases(resolved.text, previewAliases);
                if (!aliasMatch) {
                  row.classList.add('warning');
                  row.textContent += ' (no enabled alias matches)';
                } else {
                  row.textContent += ' -> ' + aliasMatch.alias.trigger;
                }
                continue;
              }

              let prefix = 'Send';
              if (step.type === 'set_variable') prefix = 'Set $' + step.name;
              if (step.type === 'show_message') prefix = 'Show';
              const { ok } = appendResolvedStepRow(body, prefix, resolved);
              if (step.type === 'set_variable' && step.name) previewVariables[step.name] = resolved.text;
            }
          });
          return result.matches.length + ' match' + (result.matches.length === 1 ? '' : 'es');
        },
      },
    };
  }

  // kind === 'highlight'
  return {
    kind,
    noun: 'highlight',
    plural: 'highlights',
    scopeKey: () => host._highlightScopeKey,
    scopeHint: 'Highlights are saved separately for each server connection target and recolor incoming terminal output.',
    list: () => host._draftHighlightScope.rules,
    replaceList: (items) => { host._draftHighlightScope.rules = items; },
    create: () => highlightManager.createEmptyRule(),
    getPattern: (item) => item.patternSource,
    setPattern: (item, value) => { item.patternSource = value; },
    patternLabel: 'Pattern (regex)',
    patternPlaceholder: () => 'You have emptied the keg!',
    emptyText: 'No highlight rules defined for this scope.',
    emptyDetailText: 'Create a highlight rule to start coloring matched terminal output.',
    nameRequired: false,
    namePlaceholder: 'Optional note shown in the list',
    haystack: (item) => (item.patternSource + ' ' + (item.description || '') + ' ' + (item.group || '')).toLowerCase(),
    rowMeta: (item) => highlightManager.formatRuleStyle(item) + (item.ignoreCase ? ' | ignore case' : ''),
    diagnostics: (item) => highlightManager.getRuleDiagnostics(host._draftHighlightScope, item.id),
    flags: (item, api) => [
      createFlagPill('Enabled', 'Disabled highlight rules stay saved but never recolor output.',
        item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
      createFlagPill('Ignore case', 'Match without caring about capitalization.',
        item.ignoreCase === true, (checked) => { item.ignoreCase = checked; api.render(); }),
    ],
    renderBody: (item, api, container) => {
      container.appendChild(el('div', 'settings-label', 'Style'));
      const styleGrid = el('div', 'settings-highlight-style-grid');

      const fgField = el('label', 'dw-field');
      fgField.appendChild(el('div', 'settings-label', 'Foreground'));
      fgField.appendChild(host._createColorSelect(item.style.fg, (value) => {
        item.style.fg = value;
        api.renderPreview();
      }));
      styleGrid.appendChild(fgField);

      const bgField = el('label', 'dw-field');
      bgField.appendChild(el('div', 'settings-label', 'Background'));
      bgField.appendChild(host._createColorSelect(item.style.bg, (value) => {
        item.style.bg = value;
        api.renderPreview();
      }));
      styleGrid.appendChild(bgField);

      const boldWrap = el('div', 'settings-highlight-bold');
      boldWrap.appendChild(createFlagPill('Bold', 'Force matched text to render bold in addition to the selected colors.',
        item.style.bold === true, (checked) => { item.style.bold = checked; api.renderPreview(); }));
      styleGrid.appendChild(boldWrap);

      container.appendChild(styleGrid);
    },
    preview: {
      title: 'Test output',
      hint: 'Sample terminal text recolored with the current rules.',
      defaultSample: 'You have emptied the keg!',
      makeInput: (onInput) => {
        const input = el('textarea', 'dw-input settings-alias-template settings-preview-sample');
        input.placeholder = 'Sample terminal output';
        input.addEventListener('input', () => onInput(input.value));
        return input;
      },
      render: (body, sample) => {
        body.textContent = '';
        const line = el('div', 'settings-alias-preview-step');
        const fragments = highlightManager.applyHighlightsToText(sample, host._draftHighlightScope.rules);
        fragments.forEach((fragment) => {
          const node = styleToElement(fragment.text, fragment.style || {});
          if (node) line.appendChild(node);
        });
        body.appendChild(line);
        const styled = fragments.some((fragment) => fragment.style);
        return styled ? 'styled' : 'no match';
      },
    },
  };
}

export function createAutomationEditor(host, kind) {
  const cfg = buildConfig(host, kind);
  const focus = (key) => host._focusSettingsControl(key);

  const wrapper = el('div', 'settings-automation');

  // ---- toolbar -------------------------------------------------------
  const toolbar = el('div', 'settings-automation-toolbar');

  const search = el('input', 'dw-input');
  search.type = 'text';
  search.placeholder = 'Search ' + cfg.plural;
  search.dataset.focusKey = cfg.kind + '-search';
  toolbar.appendChild(search);

  const addBtn = el('button', 'dw-button dw-button-secondary', 'New ' + cfg.noun);
  addBtn.type = 'button';
  addBtn.dataset.focusKey = cfg.kind + '-add';
  toolbar.appendChild(addBtn);

  const scopeChip = el('span', 'settings-scope-chip', cfg.scopeKey());
  scopeChip.title = cfg.scopeHint + ' Active scope: ' + cfg.scopeKey();
  toolbar.appendChild(scopeChip);
  wrapper.appendChild(toolbar);

  // ---- layout --------------------------------------------------------
  const layout = el('div', 'settings-automation-layout');
  const listPane = el('div', 'settings-automation-list-pane');
  const list = el('div', 'settings-automation-list');
  const listActions = el('div', 'settings-automation-list-actions');
  listPane.appendChild(list);
  listPane.appendChild(listActions);

  const detail = el('div', 'settings-automation-detail');
  detail.dataset.editFocusScope = cfg.kind + '-editor';

  layout.appendChild(listPane);
  layout.appendChild(detail);
  wrapper.appendChild(layout);

  // ---- preview bar ----------------------------------------------------
  const preview = el('div', 'settings-automation-preview');
  preview.dataset.editFocusScope = cfg.kind + '-editor';
  const previewHead = el('div', 'settings-preview-head');
  const previewTitle = el('span', 'settings-label', cfg.preview.title);
  previewTitle.title = cfg.preview.hint;
  const previewSummary = el('span', 'settings-preview-summary');
  const previewToggle = el('button', 'dw-button dw-button-secondary settings-step-btn');
  previewToggle.type = 'button';
  previewHead.appendChild(previewTitle);
  previewHead.appendChild(previewSummary);
  previewHead.appendChild(previewToggle);
  preview.appendChild(previewHead);

  const previewBody = el('div', 'settings-preview-body');
  let sample = cfg.preview.defaultSample;
  const sampleInput = cfg.preview.makeInput((value) => {
    sample = value;
    renderPreviewBody();
  });
  sampleInput.value = sample;
  const previewResults = el('div', 'settings-alias-preview-results settings-preview-results');
  previewBody.appendChild(sampleInput);
  previewBody.appendChild(previewResults);
  preview.appendChild(previewBody);
  wrapper.appendChild(preview);

  let previewCollapsed = loadAutomationUiState().previewCollapsed === true;
  const syncPreviewCollapsed = () => {
    previewBody.style.display = previewCollapsed ? 'none' : '';
    previewToggle.textContent = previewCollapsed ? 'Show' : 'Hide';
    previewToggle.title = previewCollapsed ? 'Show the test area' : 'Hide the test area';
    previewToggle.setAttribute('aria-expanded', previewCollapsed ? 'false' : 'true');
    preview.classList.toggle('collapsed', previewCollapsed);
  };
  previewToggle.addEventListener('click', () => {
    previewCollapsed = !previewCollapsed;
    saveAutomationUiState({ previewCollapsed });
    syncPreviewCollapsed();
  });
  syncPreviewCollapsed();

  // ---- state -----------------------------------------------------------
  const initialPending = cfg.initialSelectedId ? cfg.initialSelectedId() : null;
  let selectedId = initialPending || (cfg.list()[0] ? cfg.list()[0].id : null);
  let searchTerm = '';

  const ensureSelected = () => {
    const items = cfg.list();
    if (!items.length) {
      selectedId = null;
      return null;
    }
    const existing = items.find((item) => item.id === selectedId);
    if (existing) return existing;
    selectedId = items[0].id;
    return items[0];
  };

  const selectedIndex = () => cfg.list().findIndex((item) => item.id === selectedId);

  const renderPreviewBody = () => {
    const summary = cfg.preview.render(previewResults, sample);
    previewSummary.textContent = summary || '';
  };

  // ---- list -------------------------------------------------------------
  const renderListActions = () => {
    listActions.textContent = '';
    const items = cfg.list();
    const index = selectedIndex();
    const hasSelection = index >= 0;

    const moveBtn = (label, title, offset, disabled) => {
      const btn = smallButton(label, title, () => {
        const current = selectedIndex();
        const target = current + offset;
        if (current < 0 || target < 0 || target >= cfg.list().length) return;
        const arr = cfg.list();
        const other = arr[target];
        arr[target] = arr[current];
        arr[current] = other;
        render();
        focus(cfg.kind + '-row-' + selectedId);
      });
      btn.disabled = disabled;
      return btn;
    };

    listActions.appendChild(moveBtn('Up', 'Move ' + cfg.noun + ' earlier (matches and runs first)', -1, !hasSelection || index <= 0));
    listActions.appendChild(moveBtn('Down', 'Move ' + cfg.noun + ' later', 1, !hasSelection || index >= items.length - 1));

    const dupBtn = smallButton('Duplicate', 'Duplicate the selected ' + cfg.noun, () => {
      const current = ensureSelected();
      if (!current) return;
      const clone = JSON.parse(JSON.stringify(current));
      clone.id = cfg.create().id;
      const arr = cfg.list();
      arr.splice(selectedIndex() + 1, 0, clone);
      selectedId = clone.id;
      render();
      focus(cfg.kind + '-pattern');
    });
    dupBtn.disabled = !hasSelection;
    listActions.appendChild(dupBtn);

    const removeBtn = smallButton('Delete', 'Delete the selected ' + cfg.noun, () => {
      const current = ensureSelected();
      if (!current) return;
      const index2 = selectedIndex();
      cfg.replaceList(cfg.list().filter((item) => item.id !== current.id));
      const items2 = cfg.list();
      const next = items2[Math.min(index2, items2.length - 1)];
      selectedId = next ? next.id : null;
      render();
      focus(selectedId ? cfg.kind + '-row-' + selectedId : cfg.kind + '-add');
    });
    removeBtn.classList.add('settings-row-remove');
    removeBtn.disabled = !hasSelection;
    listActions.appendChild(removeBtn);
  };

  const renderList = () => {
    const previousScrollTop = list.scrollTop;
    list.textContent = '';

    const filtered = cfg.list().filter((item) => cfg.haystack(item).includes(searchTerm.trim().toLowerCase()));

    const focusByOffset = (index, offset) => {
      if (!filtered.length) return;
      const nextIndex = Math.max(0, Math.min(filtered.length - 1, index + offset));
      selectedId = filtered[nextIndex].id;
      render();
      focus(cfg.kind + '-row-' + selectedId);
    };

    filtered.forEach((item, index) => {
      const selected = item.id === selectedId;
      const row = el('div', 'settings-alias-list-item' + (selected ? ' active' : ''));

      const rowBtn = el('button', 'settings-alias-list-select');
      rowBtn.type = 'button';
      rowBtn.dataset.focusKey = cfg.kind + '-row-' + item.id;
      rowBtn.tabIndex = selected ? 0 : -1;
      rowBtn.addEventListener('click', () => {
        selectedId = item.id;
        render();
      });
      rowBtn.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusByOffset(index, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusByOffset(index, -1);
        }
      });

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = item.enabled !== false;
      toggle.className = 'settings-alias-list-toggle';
      toggle.dataset.focusKey = cfg.kind + '-toggle-' + item.id;
      toggle.tabIndex = selected ? 0 : -1;
      toggle.title = 'Enable or disable this ' + cfg.noun;
      toggle.addEventListener('change', () => {
        item.enabled = toggle.checked;
        render();
        focus(cfg.kind + '-toggle-' + item.id);
      });
      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusByOffset(index, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusByOffset(index, -1);
        }
      });

      const copy = el('div', 'settings-copy');
      const itemName = String(item.description || '').trim();
      copy.appendChild(el('div', 'settings-label', itemName || cfg.getPattern(item) || '(untitled)'));

      const meta = el('div', 'settings-alias-list-meta');
      const group = (item.group || '').trim();
      if (group) meta.appendChild(el('span', 'settings-row-chip', group));
      meta.appendChild(document.createTextNode(cfg.rowMeta(item)));
      copy.appendChild(meta);

      rowBtn.appendChild(copy);
      row.appendChild(rowBtn);
      row.appendChild(toggle);
      list.appendChild(row);
    });

    if (!filtered.length) {
      list.appendChild(el('div', 'settings-alias-empty', searchTerm
        ? 'No ' + cfg.plural + ' match this filter.'
        : cfg.emptyText));
    }

    renderListActions();
    list.scrollTop = previousScrollTop;
  };

  // ---- detail ------------------------------------------------------------
  const renderDetail = () => {
    detail.textContent = '';
    const item = ensureSelected();
    if (!item) {
      detail.appendChild(el('div', 'settings-alias-empty', cfg.emptyDetailText));
      return;
    }

    const api = {
      render,
      renderPreview: renderPreviewBody,
      focus,
      host,
    };

    const diagnostics = cfg.diagnostics(item);
    if (diagnostics.length) {
      const warningBox = el('div', 'settings-alias-diagnostics');
      diagnostics.forEach((message) => warningBox.appendChild(el('div', '', message)));
      detail.appendChild(warningBox);
    }

    const patternField = el('label', 'dw-field');
    patternField.appendChild(el('div', 'settings-label', cfg.patternLabel));
    const patternInput = el('input', 'dw-input');
    patternInput.type = 'text';
    patternInput.dataset.focusKey = cfg.kind + '-pattern';
    patternInput.placeholder = cfg.patternPlaceholder(item);
    patternInput.value = cfg.getPattern(item);
    patternInput.addEventListener('input', () => {
      cfg.setPattern(item, patternInput.value);
      renderList();
      renderPreviewBody();
    });
    patternInput.addEventListener('blur', () => render());
    patternField.appendChild(patternInput);
    detail.appendChild(patternField);

    const flagRow = el('div', 'settings-flag-row');
    cfg.flags(item, api).forEach((pill) => flagRow.appendChild(pill));
    detail.appendChild(flagRow);

    const metaGrid = el('div', 'settings-meta-grid');
    const nameField = el('label', 'dw-field');
    nameField.appendChild(el('div', 'settings-label', cfg.nameRequired ? 'Name (required)' : 'Name'));
    const nameInput = el('input', 'dw-input');
    nameInput.type = 'text';
    nameInput.dataset.focusKey = cfg.kind + '-name';
    nameInput.placeholder = cfg.namePlaceholder;
    nameInput.value = item.description || '';
    const syncNameValidity = () => {
      nameInput.classList.toggle('settings-input-invalid',
        Boolean(cfg.nameRequired) && !nameInput.value.trim());
    };
    nameInput.addEventListener('input', () => {
      item.description = nameInput.value;
      syncNameValidity();
      renderList();
    });
    syncNameValidity();
    nameField.appendChild(nameInput);
    metaGrid.appendChild(nameField);

    const groupField = el('label', 'dw-field');
    groupField.appendChild(el('div', 'settings-label', 'Group'));
    const groupInput = el('input', 'dw-input');
    groupInput.type = 'text';
    groupInput.placeholder = 'Travel, Combat, Loot';
    groupInput.value = item.group || '';
    groupInput.addEventListener('input', () => {
      item.group = groupInput.value;
      renderList();
    });
    groupField.appendChild(groupInput);
    metaGrid.appendChild(groupField);
    detail.appendChild(metaGrid);

    cfg.renderBody(item, api, detail);
  };

  // ---- wiring -------------------------------------------------------------
  search.addEventListener('input', () => {
    const selectionStart = search.selectionStart;
    const selectionEnd = search.selectionEnd;
    searchTerm = search.value;
    renderList();
    host._focusSettingsTextControl(cfg.kind + '-search', selectionStart, selectionEnd);
  });

  addBtn.addEventListener('click', () => {
    const item = cfg.create();
    cfg.list().push(item);
    selectedId = item.id;
    render();
    focus(cfg.kind + '-pattern');
  });

  const render = () => {
    ensureSelected();
    search.value = searchTerm;
    renderList();
    renderDetail();
    renderPreviewBody();
  };

  render();
  return wrapper;
}
