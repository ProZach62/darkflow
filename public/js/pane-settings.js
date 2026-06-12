// pane-settings.js
//
// A small per-pane settings modal. Opened from a pane's gear button; lets the
// user pick font settings and a persistent layer for just that pane. The owner
// (panel-manager) persists and applies the choices; this module is only the UI.

const FAMILIES = [
  { label: 'Default', value: 'default' },
  { label: 'Monospace', value: 'ui-monospace, "SFMono-Regular", Menlo, Monaco, "Consolas", "Liberation Mono", monospace' },
  { label: 'System sans-serif', value: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", "Comic Sans", cursive' },
];

const SIZES = [
  { label: 'Default', value: 'default' },
  { label: 'Tiny (10px)', value: '10' },
  { label: 'Small (11px)', value: '11' },
  { label: 'Normal (12px)', value: '12' },
  { label: 'Medium (14px)', value: '14' },
  { label: 'Large (16px)', value: '16' },
  { label: 'Extra large (18px)', value: '18' },
  { label: 'Huge (22px)', value: '22' },
];

const WEIGHTS = [
  { label: 'Default', value: 'default' },
  { label: 'Light', value: '300' },
  { label: 'Normal', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold', value: '700' },
];

let overlayEl = null;
let escHandler = null;

export function closePaneFontSettings() {
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function makeSelect(options, current, onChange) {
  const sel = document.createElement('select');
  sel.className = 'dw-select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(current)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeRow(labelText, select) {
  const row = document.createElement('div');
  row.className = 'pane-settings-row';
  const label = document.createElement('label');
  label.className = 'pane-settings-label';
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(select);
  return row;
}

function makeNumberInput(current, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'dw-input pane-settings-number';
  input.min = '0';
  input.max = '999';
  input.step = '1';
  input.value = String(current);
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

// font: { family?, size?, weight? } current values for the pane.
// zLayer: current persistent pane layer.
// onChange({ family, size, weight }) — each null when "default".
// onLayerChange(zLayer) — applies the pane layer.
// onReset() — clear the pane overrides.
export function openPaneFontSettings({ title, font, zLayer, defaultLayer, onChange, onLayerChange, onReset }) {
  closePaneFontSettings();

  const current = {
    family: (font && font.family) || 'default',
    size: (font && font.size) || 'default',
    weight: (font && font.weight) || 'default',
    zLayer: zLayer !== undefined ? zLayer : (defaultLayer || 0),
  };
  const emit = () => onChange({
    family: current.family === 'default' ? null : current.family,
    size: current.size === 'default' ? null : current.size,
    weight: current.weight === 'default' ? null : current.weight,
  });

  overlayEl = document.createElement('div');
  overlayEl.className = 'pane-settings-overlay';
  overlayEl.addEventListener('mousedown', (e) => { if (e.target === overlayEl) closePaneFontSettings(); });

  const modal = document.createElement('div');
  modal.className = 'pane-settings-modal';

  const heading = document.createElement('div');
  heading.className = 'pane-settings-title';
  heading.textContent = (title || 'Pane') + ' — Settings';

  const familySel = makeSelect(FAMILIES, current.family, (v) => { current.family = v; emit(); });
  const sizeSel = makeSelect(SIZES, current.size, (v) => { current.size = v; emit(); });
  const weightSel = makeSelect(WEIGHTS, current.weight, (v) => { current.weight = v; emit(); });
  const layerInput = makeNumberInput(current.zLayer, (v) => {
    const next = Number(v);
    if (!Number.isFinite(next)) return;
    current.zLayer = Math.max(0, Math.min(999, Math.round(next)));
    layerInput.value = String(current.zLayer);
    if (onLayerChange) onLayerChange(current.zLayer);
  });

  const actions = document.createElement('div');
  actions.className = 'pane-settings-actions';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'dw-button';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => {
    current.family = 'default';
    current.size = 'default';
    current.weight = 'default';
    familySel.value = 'default';
    sizeSel.value = 'default';
    weightSel.value = 'default';
    current.zLayer = defaultLayer || 0;
    layerInput.value = String(current.zLayer);
    if (onReset) onReset();
  });

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'dw-button';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', closePaneFontSettings);

  actions.appendChild(resetBtn);
  actions.appendChild(doneBtn);

  modal.appendChild(heading);
  modal.appendChild(makeRow('Font family', familySel));
  modal.appendChild(makeRow('Font size', sizeSel));
  modal.appendChild(makeRow('Font weight', weightSel));
  modal.appendChild(makeRow('Layer', layerInput));
  modal.appendChild(actions);
  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);

  escHandler = (e) => { if (e.key === 'Escape') closePaneFontSettings(); };
  document.addEventListener('keydown', escHandler);
  familySel.focus();
}
