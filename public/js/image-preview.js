const IMAGE_PREVIEW_TIMEOUT_MS = 30000;
const IMAGE_URL_PATTERN = /https?:\/\/[^\s<>"'\x00-\x1f\x7f]+/gi;
const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const DEFAULT_PANE_WIDTH = 520;

let previewPane = null;
let previewCloseTimer = null;
let previewKeyHandler = null;
let previewDragState = null;

function compactLabel(value) {
  const text = String(value || '').trim();
  if (text.length <= 42) return text;
  return text.slice(0, 20) + '...' + text.slice(-16);
}

function trimTrailingUrlPunctuation(urlText) {
  let end = urlText.length;
  while (end > 0 && /[.,!?;:)\]}>]$/.test(urlText.slice(end - 1, end))) {
    end--;
  }
  return urlText.slice(0, end);
}

function imageLabelForUrl(url) {
  try {
    const parsed = new URL(url);
    const filename = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (filename) return compactLabel(filename);
  } catch (error) {
    void error;
  }
  return 'Image preview';
}

export function isImageFileUrl(url) {
  try {
    const parsed = new URL(url);
    return IMAGE_FILE_EXTENSION_PATTERN.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

export function findFirstImageUrl(text) {
  const value = String(text || '');
  let match;

  IMAGE_URL_PATTERN.lastIndex = 0;
  while ((match = IMAGE_URL_PATTERN.exec(value)) !== null) {
    const url = trimTrailingUrlPunctuation(match[0]);
    if (url && isImageFileUrl(url)) return url;
  }

  return null;
}

export function findFirstImageUrlFromFragments(fragments, fallbackText = '') {
  if (Array.isArray(fragments)) {
    for (const fragment of fragments) {
      if (fragment && fragment.href && isImageFileUrl(fragment.href)) {
        return fragment.href;
      }
    }
  }
  return findFirstImageUrl(fallbackText);
}

export function closeImagePreviewPane() {
  if (previewCloseTimer) {
    clearTimeout(previewCloseTimer);
    previewCloseTimer = null;
  }
  if (previewKeyHandler) {
    document.removeEventListener('keydown', previewKeyHandler);
    previewKeyHandler = null;
  }
  if (previewPane) {
    previewPane.remove();
    previewPane = null;
  }
}

function clampPanePosition(pane) {
  if (!pane) return;
  const rect = pane.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const left = Math.min(Math.max(8, rect.left), maxLeft);
  const top = Math.min(Math.max(8, rect.top), maxTop);
  pane.style.left = left + 'px';
  pane.style.top = top + 'px';
  pane.style.right = 'auto';
  pane.style.bottom = 'auto';
}

function centerPanePosition(pane) {
  if (!pane) return;
  const rect = pane.getBoundingClientRect();
  const left = Math.max(8, Math.round((window.innerWidth - rect.width) / 2));
  const top = Math.max(8, Math.round((window.innerHeight - rect.height) / 2));
  pane.style.left = left + 'px';
  pane.style.top = top + 'px';
  pane.style.right = 'auto';
  pane.style.bottom = 'auto';
  clampPanePosition(pane);
}

function beginPreviewDrag(event) {
  if (!previewPane || event.button !== 0 || event.target.closest('.image-preview-close')) return;

  const rect = previewPane.getBoundingClientRect();
  previewDragState = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  previewPane.classList.add('dragging');
  previewPane.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function movePreviewDrag(event) {
  if (!previewPane || !previewDragState || event.pointerId !== previewDragState.pointerId) return;

  const rect = previewPane.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const left = Math.min(Math.max(8, event.clientX - previewDragState.offsetX), maxLeft);
  const top = Math.min(Math.max(8, event.clientY - previewDragState.offsetY), maxTop);

  previewPane.style.left = left + 'px';
  previewPane.style.top = top + 'px';
  previewPane.style.right = 'auto';
  previewPane.style.bottom = 'auto';
}

function endPreviewDrag(event) {
  if (!previewPane || !previewDragState || event.pointerId !== previewDragState.pointerId) return;

  try {
    previewPane.releasePointerCapture(event.pointerId);
  } catch (error) {
    void error;
  }
  previewDragState = null;
  previewPane.classList.remove('dragging');
}

export function openImagePreviewPane(url, options = {}) {
  if (!url || !isImageFileUrl(url)) return false;

  closeImagePreviewPane();

  const pane = document.createElement('div');
  pane.className = 'image-preview-pane';
  pane.setAttribute('role', 'dialog');
  pane.setAttribute('aria-label', 'Image preview');
  pane.style.width = Math.min(DEFAULT_PANE_WIDTH, window.innerWidth - 24) + 'px';

  const header = document.createElement('div');
  header.className = 'image-preview-header';
  header.addEventListener('pointerdown', beginPreviewDrag);
  pane.addEventListener('pointermove', movePreviewDrag);
  pane.addEventListener('pointerup', endPreviewDrag);
  pane.addEventListener('pointercancel', endPreviewDrag);

  const title = document.createElement('span');
  title.className = 'image-preview-title';
  title.textContent = options.title || imageLabelForUrl(url);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'image-preview-close';
  closeBtn.setAttribute('aria-label', 'Close image preview');
  closeBtn.title = 'Close image preview';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', closeImagePreviewPane);

  const img = document.createElement('img');
  img.className = 'image-preview-img';
  img.src = url;
  img.alt = options.alt || title.textContent || 'Image preview';
  img.draggable = false;

  const footer = document.createElement('a');
  footer.className = 'image-preview-source';
  footer.href = url;
  footer.target = '_blank';
  footer.rel = 'noopener noreferrer';
  footer.textContent = 'Open image in new tab';

  header.appendChild(title);
  header.appendChild(closeBtn);
  pane.appendChild(header);
  pane.appendChild(img);
  pane.appendChild(footer);

  previewKeyHandler = function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeImagePreviewPane();
    }
  };
  document.addEventListener('keydown', previewKeyHandler);

  document.body.appendChild(pane);
  previewPane = pane;
  centerPanePosition(previewPane);
  previewCloseTimer = setTimeout(closeImagePreviewPane, IMAGE_PREVIEW_TIMEOUT_MS);
  return true;
}

export function openFirstImagePreviewFromText(text, options = {}) {
  const url = findFirstImageUrl(text);
  if (!url) return false;
  return openImagePreviewPane(url, options);
}

export function imagePreviewLabel(url) {
  return imageLabelForUrl(url);
}

export function imagePreviewActionLabel(url) {
  return 'Shared the image: ' + imageLabelForUrl(url);
}
