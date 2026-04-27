import { state } from './state.js';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from './brand.js';

let overlayEl = null;
let escHandler = null;

function closeAboutModal() {
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function createInfo(label, value) {
  const row = document.createElement('div');
  row.className = 'darkflow-about-info';

  const labelEl = document.createElement('div');
  labelEl.className = 'darkflow-about-info-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'darkflow-about-info-value';
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

export function openAboutModal() {
  if (overlayEl) {
    closeAboutModal();
  }

  const overlay = document.createElement('div');
  overlay.className = 'dw-modal-overlay darkflow-about-overlay';

  const modal = document.createElement('div');
  modal.className = 'dw-modal darkflow-about-modal';

  const header = document.createElement('div');
  header.className = 'dw-modal-header';

  const title = document.createElement('span');
  title.className = 'dw-modal-title';
  title.textContent = 'About ' + PRODUCT_NAME;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'dw-modal-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', closeAboutModal);

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'dw-modal-body darkflow-about-body';

  const logo = document.createElement('img');
  logo.className = 'darkflow-about-logo';
  logo.src = 'assets/brand/darkflow-logo-horizontal.png';
  logo.alt = PRODUCT_NAME;

  const tagline = document.createElement('div');
  tagline.className = 'darkflow-about-tagline';
  tagline.textContent = PRODUCT_TAGLINE;

  const info = document.createElement('div');
  info.className = 'darkflow-about-info-grid';
  info.appendChild(createInfo('Client version', state.clientVersion || 'unknown'));
  info.appendChild(createInfo('Protocol identity', PRODUCT_NAME + ' via Core.Hello'));

  body.appendChild(logo);
  body.appendChild(tagline);
  body.appendChild(info);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  escHandler = (event) => {
    if (event.key === 'Escape') closeAboutModal();
  };
  document.addEventListener('keydown', escHandler);
  overlayEl = overlay;
}
