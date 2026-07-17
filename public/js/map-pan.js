const DRAG_THRESHOLD_PX = 4;
const PAN_REBASE_PITCHES = 2;

export function normalizeMapPan(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function splitMapPan(value, pitch) {
  const pan = normalizeMapPan(value);
  const safePitch = Number.isFinite(pitch) && pitch > 0 ? pitch : 1;
  const cells = Math.round(pan);
  return {
    cells,
    offset: (pan - cells) * safePitch,
  };
}

function roundedPan(value) {
  return Math.round(normalizeMapPan(value) * 1000000) / 1000000;
}

function readFrame(bodyEl) {
  const frame = bodyEl.querySelector('.map-grid-frame');
  if (!frame) return null;
  const pitch = Number(frame.dataset.mapPitch);
  return {
    el: frame,
    pitch: Number.isFinite(pitch) && pitch > 0 ? pitch : 1,
    offsetX: normalizeMapPan(frame.dataset.mapPanOffsetX),
    offsetY: normalizeMapPan(frame.dataset.mapPanOffsetY),
  };
}

function isPannableTarget(target) {
  if (!target || !target.closest) return true;
  return !target.closest('.map-tile-room, button, a, input, select, textarea');
}

function writePan(bodyEl, x, y) {
  bodyEl.dataset.mapPanX = String(roundedPan(x));
  bodyEl.dataset.mapPanY = String(roundedPan(y));
}

export function wireMapPan(bodyEl, options = {}) {
  if (!bodyEl || !bodyEl.addEventListener) return;
  if (bodyEl.dataset && bodyEl.dataset.mapPanWired) return;
  if (bodyEl.dataset) bodyEl.dataset.mapPanWired = '1';

  const rerender = typeof options.rerender === 'function' ? options.rerender : () => {};
  const drag = {
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    lastClientX: 0,
    lastClientY: 0,
    startPanX: 0,
    startPanY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    pitch: 1,
    moved: false,
  };
  let suppressClick = false;

  const currentPan = (event) => ({
    x: drag.startPanX + ((event.clientX - drag.startClientX) / drag.pitch),
    y: drag.startPanY + ((event.clientY - drag.startClientY) / drag.pitch),
  });

  const rebase = (event, pan) => {
    writePan(bodyEl, pan.x, pan.y);
    rerender();
    const frame = readFrame(bodyEl);
    drag.startClientX = event.clientX;
    drag.startClientY = event.clientY;
    drag.startPanX = pan.x;
    drag.startPanY = pan.y;
    if (frame) {
      drag.pitch = frame.pitch;
      drag.startOffsetX = frame.offsetX;
      drag.startOffsetY = frame.offsetY;
    } else {
      drag.startOffsetX = 0;
      drag.startOffsetY = 0;
    }
  };

  const finish = (event, cancelled = false) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    const pan = currentPan(event);
    writePan(bodyEl, pan.x, pan.y);
    rerender();
    drag.active = false;
    bodyEl.classList.remove('map-panning');

    if (bodyEl.hasPointerCapture && bodyEl.hasPointerCapture(event.pointerId)) {
      bodyEl.releasePointerCapture(event.pointerId);
    }
    if (drag.moved && !cancelled) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
  };

  bodyEl.addEventListener('pointerdown', (event) => {
    if (drag.active || event.isPrimary === false || event.button !== 0) return;
    if (!isPannableTarget(event.target)) return;
    const frame = readFrame(bodyEl);
    if (!frame) return;

    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.startClientX = event.clientX;
    drag.startClientY = event.clientY;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    drag.startPanX = normalizeMapPan(bodyEl.dataset.mapPanX);
    drag.startPanY = normalizeMapPan(bodyEl.dataset.mapPanY);
    drag.startOffsetX = frame.offsetX;
    drag.startOffsetY = frame.offsetY;
    drag.pitch = frame.pitch;
    drag.moved = false;
    bodyEl.classList.add('map-panning');
    if (bodyEl.setPointerCapture) bodyEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  bodyEl.addEventListener('pointermove', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) drag.moved = true;

    const frame = readFrame(bodyEl);
    if (frame) {
      frame.el.style.transform = 'translate('
        + (drag.startOffsetX + dx) + 'px,'
        + (drag.startOffsetY + dy) + 'px)';
    }
    if (Math.abs(dx) >= drag.pitch * PAN_REBASE_PITCHES
      || Math.abs(dy) >= drag.pitch * PAN_REBASE_PITCHES) {
      rebase(event, currentPan(event));
    }
    event.preventDefault();
  });

  bodyEl.addEventListener('pointerup', (event) => finish(event));
  bodyEl.addEventListener('pointercancel', (event) => finish(event, true));
  bodyEl.addEventListener('lostpointercapture', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    finish({
      pointerId: event.pointerId,
      clientX: drag.lastClientX,
      clientY: drag.lastClientY,
    }, true);
  });
  bodyEl.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
