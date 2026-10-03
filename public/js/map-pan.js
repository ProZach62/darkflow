const DRAG_THRESHOLD_PX = 4;
const PAN_REBASE_PITCHES = 2;
// A drag let go while moving coasts on and slows to a stop. Speeds are in
// pixels per millisecond, measured over the last part of the drag.
const COAST_SAMPLE_MS = 100;
const COAST_MIN_SPEED = 0.25;
const COAST_STOP_SPEED = 0.02;
const COAST_FRICTION = 0.9;

/** The release velocity of a drag from its recent { t, x, y } samples, or null. */
export function releaseVelocity(samples, now) {
  const recent = (samples || []).filter((s) => Number.isFinite(s.t) && now - s.t <= COAST_SAMPLE_MS);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  if (!(dt > 0)) return null;
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  return Math.hypot(vx, vy) >= COAST_MIN_SPEED ? { vx, vy } : null;
}
const panDisposers = new WeakMap();

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
    pitchX: Number(frame.dataset.mapPitchX) || pitch || 1,
    pitchY: Number(frame.dataset.mapPitchY) || pitch || 1,
    projection: frame.dataset.mapProjection || 'flat',
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
  if (panDisposers.has(bodyEl)) return panDisposers.get(bodyEl);
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
  let suppressClickTimer = null;
  const samples = [];
  let coast = null;

  const currentPan = (event) => {
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (drag.projection === 'iso') {
      return {
        x: drag.startPanX + (dx / drag.pitchX) + (dy / drag.pitchY),
        y: drag.startPanY - (dx / drag.pitchX) + (dy / drag.pitchY),
      };
    }
    return {
      x: drag.startPanX + (dx / drag.pitch),
      y: drag.startPanY + (dy / drag.pitch),
    };
  };

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
      drag.pitchX = frame.pitchX;
      drag.pitchY = frame.pitchY;
      drag.projection = frame.projection;
      drag.startOffsetX = frame.offsetX;
      drag.startOffsetY = frame.offsetY;
    } else {
      drag.startOffsetX = 0;
      drag.startOffsetY = 0;
    }
  };

  // Moves the view to where a pointer at (clientX, clientY) would have
  // dragged it, rebasing the grid when it has travelled far enough.
  const follow = (point) => {
    const dx = point.clientX - drag.startClientX;
    const dy = point.clientY - drag.startClientY;
    const frame = readFrame(bodyEl);
    if (frame) {
      frame.el.style.transform = 'translate('
        + (drag.startOffsetX + dx) + 'px,'
        + (drag.startOffsetY + dy) + 'px)';
    }
    if (Math.abs(dx) >= drag.pitch * PAN_REBASE_PITCHES
      || Math.abs(dy) >= drag.pitch * PAN_REBASE_PITCHES) {
      rebase(point, currentPan(point));
    }
  };

  const canCoast = () => typeof requestAnimationFrame === 'function'
    && !(bodyEl.dataset && bodyEl.dataset.mapMotion === 'reduce');

  const settle = (point) => {
    const pan = currentPan(point);
    writePan(bodyEl, pan.x, pan.y);
    rerender();
  };

  const stopCoast = () => {
    if (!coast) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(coast.frame);
    const point = { clientX: coast.x, clientY: coast.y };
    coast = null;
    bodyEl.classList.remove('map-coasting');
    settle(point);
  };

  const startCoast = (point, velocity) => {
    coast = { x: point.clientX, y: point.clientY, vx: velocity.vx, vy: velocity.vy, last: null, frame: 0 };
    bodyEl.classList.add('map-coasting');
    const step = (time) => {
      if (!coast) return;
      const dt = coast.last === null ? 16 : Math.min(48, Math.max(0, time - coast.last));
      coast.last = time;
      coast.x += coast.vx * dt;
      coast.y += coast.vy * dt;
      const slow = Math.pow(COAST_FRICTION, dt / 16);
      coast.vx *= slow;
      coast.vy *= slow;
      follow({ clientX: coast.x, clientY: coast.y });
      if (Math.hypot(coast.vx, coast.vy) < COAST_STOP_SPEED) {
        stopCoast();
        return;
      }
      coast.frame = requestAnimationFrame(step);
    };
    coast.frame = requestAnimationFrame(step);
  };

  const finish = (event, cancelled = false) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    const velocity = !cancelled && drag.moved && canCoast()
      ? releaseVelocity(samples, Number.isFinite(event.timeStamp) ? event.timeStamp : NaN)
      : null;
    if (velocity) startCoast(event, velocity);
    else settle(event);
    drag.active = false;
    bodyEl.classList.remove('map-panning');

    if (bodyEl.hasPointerCapture && bodyEl.hasPointerCapture(event.pointerId)) {
      bodyEl.releasePointerCapture(event.pointerId);
    }
    if (drag.moved && !cancelled) {
      suppressClick = true;
      suppressClickTimer = setTimeout(() => {
        suppressClick = false;
        suppressClickTimer = null;
      }, 0);
    }
  };

  const onPointerDown = (event) => {
    if (drag.active || event.isPrimary === false || event.button !== 0) return;
    // Catching a coasting map stops it where it is.
    stopCoast();
    if (!isPannableTarget(event.target)) return;
    const frame = readFrame(bodyEl);
    if (!frame) return;
    samples.length = 0;

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
    drag.pitchX = frame.pitchX;
    drag.pitchY = frame.pitchY;
    drag.projection = frame.projection;
    drag.moved = false;
    bodyEl.classList.add('map-panning');
    if (bodyEl.setPointerCapture) bodyEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) drag.moved = true;
    if (Number.isFinite(event.timeStamp)) {
      samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      while (samples.length > 2 && event.timeStamp - samples[0].t > COAST_SAMPLE_MS) samples.shift();
    }
    follow(event);
    event.preventDefault();
  };

  const onPointerUp = (event) => finish(event);
  const onPointerCancel = (event) => finish(event, true);
  const onLostPointerCapture = (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    finish({
      pointerId: event.pointerId,
      clientX: drag.lastClientX,
      clientY: drag.lastClientY,
    }, true);
  };
  const onClick = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const listeners = [
    ['pointerdown', onPointerDown, false],
    ['pointermove', onPointerMove, false],
    ['pointerup', onPointerUp, false],
    ['pointercancel', onPointerCancel, false],
    ['lostpointercapture', onLostPointerCapture, false],
    ['click', onClick, true],
  ];
  for (const [type, handler, capture] of listeners) {
    bodyEl.addEventListener(type, handler, capture);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (coast && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(coast.frame);
    coast = null;
    for (const [type, handler, capture] of listeners) {
      if (bodyEl.removeEventListener) bodyEl.removeEventListener(type, handler, capture);
    }
    if (suppressClickTimer) clearTimeout(suppressClickTimer);
    suppressClickTimer = null;
    suppressClick = false;
    if (drag.active && bodyEl.hasPointerCapture
      && bodyEl.hasPointerCapture(drag.pointerId)) {
      bodyEl.releasePointerCapture(drag.pointerId);
    }
    drag.active = false;
    bodyEl.classList.remove('map-panning');
    if (bodyEl.dataset) delete bodyEl.dataset.mapPanWired;
    if (panDisposers.get(bodyEl) === dispose) panDisposers.delete(bodyEl);
  };
  panDisposers.set(bodyEl, dispose);
  return dispose;
}
