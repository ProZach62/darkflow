// Canvas combat stage. Draws the two combatant tokens, the terrain backdrop,
// and the transient effects that combat-stage-core.mjs samples per frame.
//
// Ownership rules:
// - The renderer keeps one stage per Enemy pane body and calls update() on
//   every publish; the stage never reaches into the model on its own.
// - The stage stops its frame loop when its element leaves the document,
//   when the tab is hidden, or when the encounter is over and no effect is
//   still playing. It never keeps a timer alive for a closed pane.
// - Canvas or 2D-context failures surface as null from createCombatStage()
//   so the renderer can pick the DOM fallback instead of pretending.

import {
  buildAction,
  computeStageLayout,
  idleOffset,
  resolveStageBackdrop,
  sampleAction,
} from './combat-stage-core.mjs';
import {
  figureGeometry,
  posePhase,
  resolveFigure,
  resolvePose,
} from './combat-rig-core.mjs';

const MAX_CONCURRENT_ACTIONS = 3;
// Body unit for the procedural figures, as a fraction of the stage radius.
const FIGURE_UNIT_SCALE = 0.7;
const RESULT_BADGES = Object.freeze({
  hit: 'HIT',
  critical: 'CRITICAL',
  miss: 'MISS',
  dodge: 'DODGE',
  absorb: 'ABSORB',
});

function readCssVar(doc, name, fallback) {
  try {
    const root = doc && doc.documentElement;
    const win = doc && doc.defaultView;
    if (!root || !win || typeof win.getComputedStyle !== 'function') return fallback;
    const value = win.getComputedStyle(root).getPropertyValue(name);
    const trimmed = value ? String(value).trim() : '';
    return trimmed || fallback;
  } catch (error) {
    return fallback;
  }
}

export function isCanvasStageSupported(doc) {
  if (!doc || typeof doc.createElement !== 'function') return false;
  try {
    const canvas = doc.createElement('canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    return !!canvas.getContext('2d');
  } catch (error) {
    return false;
  }
}

function fallbackList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item);
  return typeof value === 'string' && value ? [value] : [];
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgba(color, alpha) {
  const rgb = hexToRgb(color) || [240, 189, 105];
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + Math.max(0, Math.min(1, alpha)) + ')';
}

export function createCombatStage(doc, options = {}) {
  if (!isCanvasStageSupported(doc)) return null;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const raf = options.requestAnimationFrame
    || (win && typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : null);
  const caf = options.cancelAnimationFrame
    || (win && typeof win.cancelAnimationFrame === 'function'
      ? win.cancelAnimationFrame.bind(win)
      : null);
  if (!raf) return null;
  const now = options.now || (() => (win && win.performance && typeof win.performance.now === 'function'
    ? win.performance.now()
    : Date.now()));
  const ImageCtor = options.Image || (win && win.Image) || (typeof Image !== 'undefined' ? Image : null);

  const element = doc.createElement('div');
  element.className = 'combat-stage-canvas-wrap';
  const canvas = doc.createElement('canvas');
  canvas.className = 'combat-stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  element.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stage = {
    element,
    canvas,
    ctx,
    destroyed: false,
    running: false,
    _rafId: 0,
    _width: 0,
    _height: 0,
    _dpr: 1,
    _images: new Map(),
    _actions: [],
    _playedSeqs: new Set(),
    _encounterKey: '',
    _view: null,
    _reducedMotion: false,
    _backdrop: resolveStageBackdrop(null),
    _palette: {
      accent: readCssVar(doc, '--df-accent', '#42d6c9'),
      danger: readCssVar(doc, '--df-err', '#f85149'),
      text: readCssVar(doc, '--df-text', '#e2e9ef'),
      muted: readCssVar(doc, '--df-muted', '#8fa3b3'),
    },
    _resizeObserver: null,
    _visibilityHandler: null,
    _lastFrameAt: 0,
    frames: 0,

    update(view, sources = {}) {
      if (this.destroyed || !view) return;
      const key = String(view.epoch || '') + ':' + String(view.encounterId || '');
      if (key !== this._encounterKey) {
        this._encounterKey = key;
        this._actions = [];
        this._playedSeqs.clear();
      }
      this._view = view;
      this._reducedMotion = !!view.reducedMotion;
      this._backdrop = resolveStageBackdrop(sources.room);
      this._ensureImage(this._backdrop.tile, '');
      this._playerFallback = fallbackList(sources.playerFallback);
      this._targetFallback = fallbackList(sources.targetFallback);
      this._ensureImage(view.player.image, this._playerFallback);
      this._ensureImage(view.target.image, this._targetFallback);

      const event = view.event;
      if (event && Number.isFinite(Number(event.seq)) && !this._playedSeqs.has(event.seq)) {
        const action = buildAction(event, view, now());
        if (action) {
          this._playedSeqs.add(event.seq);
          this._actions.push(action);
          if (this._actions.length > MAX_CONCURRENT_ACTIONS) {
            this._actions.splice(0, this._actions.length - MAX_CONCURRENT_ACTIONS);
          }
        }
      }
      if (this._playedSeqs.size > 512) {
        // Sequence numbers only grow; keep the set bounded for long fights.
        const keep = Array.from(this._playedSeqs).slice(-256);
        this._playedSeqs = new Set(keep);
      }
      this._resize();
      this.start();
    },

    start() {
      if (this.destroyed || this.running) return;
      if (doc.hidden) return;
      this.running = true;
      this._rafId = raf((t) => this._tick(t));
    },

    stop() {
      if (this._rafId && caf) caf(this._rafId);
      this._rafId = 0;
      this.running = false;
    },

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.stop();
      if (this._resizeObserver) {
        try { this._resizeObserver.disconnect(); } catch (error) { /* ignore */ }
        this._resizeObserver = null;
      }
      if (this._visibilityHandler && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', this._visibilityHandler);
        this._visibilityHandler = null;
      }
      if (this._resizeHandler && win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
      this._images.clear();
      if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
        element.parentNode.removeChild(element);
      }
    },

    isAttached() {
      if (typeof element.isConnected === 'boolean') return element.isConnected;
      return !!element.parentNode;
    },

    // Loads `url`, then each fallback in turn as earlier candidates fail.
    _ensureImage(url, fallback) {
      const fallbacks = fallbackList(fallback);
      const key = url || fallbacks[0];
      const rest = url ? fallbacks : fallbacks.slice(1);
      if (!key || !ImageCtor || this._images.has(key)) return;
      const entry = { img: null, status: 'loading', fallbacks: rest };
      this._images.set(key, entry);
      try {
        const img = new ImageCtor();
        img.decoding = 'async';
        img.onload = () => {
          entry.status = 'loaded';
          if (!this.running) this.start();
        };
        img.onerror = () => {
          entry.status = 'failed';
          const next = rest.find((candidate) => candidate !== key);
          if (next) this._ensureImage(next, rest.slice(rest.indexOf(next) + 1));
          if (!this.running) this.start();
        };
        img.src = key;
        entry.img = img;
      } catch (error) {
        entry.status = 'failed';
      }
    },

    _imageFor(url, fallback) {
      const candidates = (url ? [url] : []).concat(fallbackList(fallback));
      for (const candidate of candidates) {
        const entry = this._images.get(candidate);
        if (entry && entry.status === 'loaded') return entry.img;
      }
      return null;
    },

    _resize() {
      const parent = element;
      const width = Math.max(1, Math.round(parent.clientWidth || 0));
      const height = Math.max(1, Math.round(parent.clientHeight || 0));
      const dpr = Math.max(1, Math.min(3, (win && win.devicePixelRatio) || 1));
      if (width === this._width && height === this._height && dpr === this._dpr) return;
      this._width = width;
      this._height = height;
      this._dpr = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    },

    _observe() {
      if (this._resizeObserver || this._resizeHandler) return;
      if (win && typeof win.ResizeObserver === 'function') {
        this._resizeObserver = new win.ResizeObserver(() => {
          this._resize();
          if (!this.running) this.start();
        });
        this._resizeObserver.observe(element);
      } else if (win && typeof win.addEventListener === 'function') {
        this._resizeHandler = () => {
          this._resize();
          if (!this.running) this.start();
        };
        win.addEventListener('resize', this._resizeHandler);
      }
      if (typeof doc.addEventListener === 'function') {
        this._visibilityHandler = () => {
          if (doc.hidden) this.stop();
          else this.start();
        };
        doc.addEventListener('visibilitychange', this._visibilityHandler);
      }
    },

    _tick(timestamp) {
      this._rafId = 0;
      if (this.destroyed) return;
      if (!this.isAttached()) {
        this.running = false;
        return;
      }
      // A collapsed or hidden pane has no size. Stop drawing; the resize
      // observer or the next publish restarts the loop when it comes back.
      if (!(element.clientWidth > 0 && element.clientHeight > 0)) {
        this.running = false;
        return;
      }
      const t = Number.isFinite(timestamp) ? timestamp : now();
      this._lastFrameAt = t;
      this._actions = this._actions.filter((action) => t - action.startedAt < action.duration);
      this._draw(t);
      this.frames++;
      const view = this._view;
      const keepGoing = this._actions.length > 0
        || (view && view.active && !this._reducedMotion);
      if (keepGoing) {
        this._rafId = raf((next) => this._tick(next));
      } else {
        this.running = false;
      }
    },

    _draw(t) {
      this._resize();
      const w = this._width;
      const h = this._height;
      const layout = computeStageLayout(w, h);
      const view = this._view;
      const reduced = this._reducedMotion;
      const samples = this._actions.map((action) => ({
        ...sampleAction(action, t, { reducedMotion: reduced }),
        action,
      }));
      const c = ctx;
      c.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      c.clearRect(0, 0, w, h);

      let shake = 0;
      let flash = 0;
      for (const sample of samples) {
        shake = Math.max(shake, sample.shake);
        flash = Math.max(flash, sample.flash);
      }
      const shakeX = shake ? Math.sin(t / 19) * shake * layout.radius * 0.14 : 0;
      const shakeY = shake ? Math.cos(t / 23) * shake * layout.radius * 0.08 : 0;

      c.save();
      c.translate(shakeX, shakeY);
      this._drawBackdrop(c, layout);
      const tokens = this._tokenPositions(layout, samples, t);
      this._drawGround(c, layout, tokens);
      for (const sample of samples) this._drawBackEffects(c, layout, tokens, sample);
      this._drawToken(c, layout, tokens.player, 'player', view.player, samples);
      this._drawToken(c, layout, tokens.target, 'target', view.target, samples);
      for (const sample of samples) this._drawFrontEffects(c, layout, tokens, sample);
      c.restore();

      if (flash > 0) {
        const gradient = c.createLinearGradient(0, 0, w * 0.55, 0);
        gradient.addColorStop(0, rgba(this._palette.danger, 0.42 * flash));
        gradient.addColorStop(1, rgba(this._palette.danger, 0));
        c.fillStyle = gradient;
        c.fillRect(0, 0, w, h);
      }
      if (view && !view.effective) {
        c.fillStyle = 'rgba(3, 7, 11, 0.32)';
        c.fillRect(0, 0, w, h);
      }
    },

    _tokenPositions(layout, samples, t) {
      const positions = {};
      for (const side of ['player', 'target']) {
        const base = layout[side];
        const idle = idleOffset(side, t, this._reducedMotion);
        let x = idle.x;
        let y = idle.y;
        let scale = 1;
        let alpha = 1;
        let flashAmount = 0;
        for (const sample of samples) {
          const offset = sample[side];
          x += offset.x;
          y += offset.y;
          scale *= offset.scale;
          alpha = Math.min(alpha, offset.alpha);
          flashAmount = Math.max(flashAmount, offset.flash);
        }
        positions[side] = {
          x: base.x + x * layout.radius,
          y: base.y + y * layout.radius,
          baseX: base.x,
          baseY: base.y,
          scale,
          alpha,
          flash: flashAmount,
        };
      }
      return positions;
    },

    _drawBackdrop(c, layout) {
      const w = layout.width;
      const h = layout.height;
      const tile = this._imageFor(this._backdrop.tile, '');
      c.fillStyle = '#05090e';
      c.fillRect(-w, -h, w * 3, h * 3);
      if (tile && tile.naturalWidth > 0) {
        const scale = Math.max(w / tile.naturalWidth, h / tile.naturalHeight) * 1.08;
        const drawW = tile.naturalWidth * scale;
        const drawH = tile.naturalHeight * scale;
        c.save();
        c.globalAlpha = 0.55;
        c.drawImage(tile, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
        c.restore();
      }
      const wash = c.createLinearGradient(0, 0, 0, h);
      wash.addColorStop(0, 'rgba(4, 9, 14, 0.66)');
      wash.addColorStop(0.5, 'rgba(4, 9, 14, 0.28)');
      wash.addColorStop(1, 'rgba(2, 5, 8, 0.9)');
      c.fillStyle = wash;
      c.fillRect(-w, -h, w * 3, h * 3);
      const vignette = c.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.25, w / 2, h * 0.5, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
      c.fillStyle = vignette;
      c.fillRect(-w, -h, w * 3, h * 3);
      // Side tints keep the left/right reading even on a neutral tile.
      const left = c.createRadialGradient(layout.player.x, layout.player.y, 0, layout.player.x, layout.player.y, layout.radius * 3.2);
      left.addColorStop(0, rgba(this._palette.accent, 0.16));
      left.addColorStop(1, rgba(this._palette.accent, 0));
      c.fillStyle = left;
      c.fillRect(0, 0, w, h);
      const right = c.createRadialGradient(layout.target.x, layout.target.y, 0, layout.target.x, layout.target.y, layout.radius * 3.2);
      right.addColorStop(0, rgba(this._palette.danger, 0.14));
      right.addColorStop(1, rgba(this._palette.danger, 0));
      c.fillStyle = right;
      c.fillRect(0, 0, w, h);
    },

    _drawGround(c, layout, tokens) {
      const groundY = layout.groundY + layout.radius * 0.95;
      c.save();
      c.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, groundY);
      c.lineTo(layout.width, groundY);
      c.stroke();
      for (const side of ['player', 'target']) {
        const token = tokens[side];
        const lift = Math.max(0, token.baseY - token.y);
        const spread = layout.radius * (0.95 - Math.min(0.35, lift / layout.radius * 0.4));
        c.fillStyle = 'rgba(0, 0, 0, ' + (0.42 * token.alpha) + ')';
        c.beginPath();
        c.ellipse(token.x, groundY, spread, layout.radius * 0.22, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    },

    _drawToken(c, layout, token, side, combatant, samples) {
      const figure = resolveFigure(combatant, side);
      const unit = layout.radius * FIGURE_UNIT_SCALE;
      // Lunge and knockback offsets move the whole figure; vertical offsets
      // lift its ground line so the feet leave the floor together.
      const groundLine = layout.groundY + layout.radius * 0.95 + (token.y - token.baseY);
      let phase = null;
      let isActor = false;
      if (!this._reducedMotion) {
        for (const sample of samples) {
          if (!sample.active || !sample.action) continue;
          const action = sample.action;
          const role = action.actorSide === side
            ? 'actor'
            : (action.impactSide === side ? 'impact' : '');
          if (!role) continue;
          if (role === 'actor' && sample.progress < 0.4) isActor = true;
          const candidate = posePhase(role, action, sample.progress, figure.weapon);
          if (candidate) phase = candidate;
        }
      }
      const joints = resolvePose(phase, this._lastFrameAt, {
        reducedMotion: this._reducedMotion,
        phaseOffset: side === 'player' ? 0 : 2.1,
      });
      const geo = figureGeometry(figure, joints, token.x, groundLine, unit);
      const ringColor = side === 'player' ? this._palette.accent : this._palette.danger;
      const bodyColor = figure.kind === 'beast' ? '#3a1712' : (side === 'player' ? '#12303a' : '#331414');
      const flashMix = token.flash;

      c.save();
      c.globalAlpha = token.alpha;
      // Far limbs first, then torso, near limbs, head, weapon.
      this._drawLimb(c, geo.legs.left.hip, geo.legs.left.knee, geo.legs.left.foot, geo.limbWidth * 0.95, bodyColor, ringColor, 0.55, flashMix);
      this._drawLimb(c, geo.arms.left.shoulder, geo.arms.left.elbow, geo.arms.left.hand, geo.limbWidth * 0.85, bodyColor, ringColor, 0.55, flashMix);
      if (figure.weapon === 'bow') this._drawWeapon(c, geo, ringColor, side);
      else this._drawOffHand(c, geo, ringColor);
      this._drawTorso(c, geo, bodyColor, ringColor, flashMix);
      this._drawLimb(c, geo.legs.right.hip, geo.legs.right.knee, geo.legs.right.foot, geo.limbWidth, bodyColor, ringColor, 0.9, flashMix);
      this._drawHead(c, geo.head, side, combatant, ringColor, isActor, flashMix);
      if (geo.helmet) this._drawHelmet(c, geo.head, geo.facing);
      this._drawLimb(c, geo.arms.right.shoulder, geo.arms.right.elbow, geo.arms.right.hand, geo.limbWidth * 0.9, bodyColor, ringColor, 0.9, flashMix);
      if (figure.weapon !== 'bow') this._drawWeapon(c, geo, ringColor, side);
      c.restore();
    },

    _drawLimb(c, a, b, end, width, fill, edge, edgeAlpha, flashMix) {
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = width + 3;
      c.strokeStyle = rgba(edge, edgeAlpha);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      c.lineWidth = width;
      c.strokeStyle = flashMix > 0 ? rgba('#fff4e6', 0.4 + 0.6 * flashMix) : fill;
      c.stroke();
      c.restore();
    },

    _drawTorso(c, geo, fill, edge, flashMix) {
      c.save();
      c.lineCap = 'round';
      c.lineWidth = geo.torsoWidth + 3;
      c.strokeStyle = rgba(edge, 0.85);
      c.beginPath();
      c.moveTo(geo.hip.x, geo.hip.y);
      c.lineTo(geo.shoulder.x, geo.shoulder.y);
      c.stroke();
      c.lineWidth = geo.torsoWidth;
      c.strokeStyle = flashMix > 0 ? rgba('#fff4e6', 0.4 + 0.6 * flashMix) : fill;
      c.stroke();
      if (geo.armor) {
        c.lineWidth = geo.torsoWidth * 0.55;
        c.strokeStyle = 'rgba(184, 191, 199, 0.55)';
        c.beginPath();
        c.moveTo(geo.hip.x + (geo.shoulder.x - geo.hip.x) * 0.15, geo.hip.y + (geo.shoulder.y - geo.hip.y) * 0.15);
        c.lineTo(geo.hip.x + (geo.shoulder.x - geo.hip.x) * 0.92, geo.hip.y + (geo.shoulder.y - geo.hip.y) * 0.92);
        c.stroke();
      }
      // Chest highlight so the torso reads as a volume, not a line.
      c.lineWidth = Math.max(1, geo.torsoWidth * 0.25);
      c.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      c.beginPath();
      c.moveTo(geo.hip.x + (geo.shoulder.x - geo.hip.x) * 0.25 + geo.facing * geo.torsoWidth * 0.18,
        geo.hip.y + (geo.shoulder.y - geo.hip.y) * 0.25);
      c.lineTo(geo.shoulder.x + geo.facing * geo.torsoWidth * 0.18, geo.shoulder.y + geo.unit * 0.05);
      c.stroke();
      c.restore();
    },

    _drawWeapon(c, geo, ringColor, side) {
      const w = geo.weapon;
      if (w.kind === 'bow') {
        this._drawBow(c, geo, w);
        return;
      }
      this._drawHeldWeapon(c, geo, w.kind, w.hand, w.dx, w.dy, ringColor, geo.twoHanded ? 1.2 : 1);
      void side;
    },

    _drawOffHand(c, geo, ringColor) {
      const w = geo.weapon;
      if (geo.shield) this._drawShieldArm(c, geo, ringColor);
      else if (w.offKind && w.offKind !== 'bow') {
        this._drawHeldWeapon(c, geo, w.offKind, w.offHand, w.offDx, w.offDy, ringColor, 0.85);
      }
    },

    // One-handed weapon shapes, all drawn from the hand along (dx, dy).
    _drawHeldWeapon(c, geo, kind, hand, dx, dy, ringColor, size) {
      const u = geo.unit * size;
      const tip = (length) => ({ x: hand.x + dx * u * length, y: hand.y + dy * u * length });
      const across = (point, length) => ({ x: point.x - dy * u * length, y: point.y + dx * u * length });
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      if (kind === 'blade' || kind === 'knife') {
        const length = kind === 'knife' ? 0.55 : 1.15;
        c.lineWidth = Math.max(2, u * (kind === 'knife' ? 0.07 : 0.09));
        c.strokeStyle = '#d9dee3';
        c.shadowColor = 'rgba(255, 255, 255, 0.35)';
        c.shadowBlur = u * 0.15;
        c.beginPath();
        c.moveTo(hand.x, hand.y);
        const end = tip(length);
        c.lineTo(end.x, end.y);
        c.stroke();
        c.shadowBlur = 0;
        c.lineWidth = Math.max(2, u * 0.07);
        c.strokeStyle = '#8a6a3c';
        const guardA = across(hand, 0.18);
        const guardB = across(hand, -0.18);
        c.beginPath();
        c.moveTo(guardA.x, guardA.y);
        c.lineTo(guardB.x, guardB.y);
        c.stroke();
      } else if (kind === 'axe' || kind === 'blunt') {
        c.lineWidth = Math.max(2, u * 0.08);
        c.strokeStyle = '#8a6a3c';
        c.beginPath();
        c.moveTo(hand.x, hand.y);
        const end = tip(kind === 'axe' ? 0.95 : 0.85);
        c.lineTo(end.x, end.y);
        c.stroke();
        c.fillStyle = '#c9ced4';
        c.strokeStyle = '#eef2f5';
        c.lineWidth = 1;
        if (kind === 'axe') {
          const neck = tip(0.72);
          const edgeA = across(tip(0.98), 0.34);
          const edgeB = across(tip(0.5), 0.3);
          c.beginPath();
          c.moveTo(neck.x, neck.y);
          c.lineTo(edgeA.x, edgeA.y);
          c.lineTo(edgeB.x, edgeB.y);
          c.closePath();
          c.fill();
          c.stroke();
        } else {
          const head = tip(0.85);
          c.beginPath();
          c.arc(head.x, head.y, u * 0.17, 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
      } else if (kind === 'polearm') {
        c.lineWidth = Math.max(2, u * 0.07);
        c.strokeStyle = '#8a6a3c';
        const butt = tip(-0.7);
        const neck = tip(1.35);
        c.beginPath();
        c.moveTo(butt.x, butt.y);
        c.lineTo(neck.x, neck.y);
        c.stroke();
        c.fillStyle = '#d9dee3';
        const point = tip(1.75);
        const barbA = across(neck, 0.12);
        const barbB = across(neck, -0.12);
        c.beginPath();
        c.moveTo(point.x, point.y);
        c.lineTo(barbA.x, barbA.y);
        c.lineTo(barbB.x, barbB.y);
        c.closePath();
        c.fill();
      } else if (kind === 'staff') {
        c.lineWidth = Math.max(2, u * 0.08);
        c.strokeStyle = '#8a6a3c';
        const butt = tip(-0.7);
        const top = tip(1.0);
        c.beginPath();
        c.moveTo(butt.x, butt.y);
        c.lineTo(top.x, top.y);
        c.stroke();
        c.fillStyle = rgba(ringColor, 0.95);
        c.shadowColor = rgba(ringColor, 0.9);
        c.shadowBlur = u * 0.35;
        c.beginPath();
        c.arc(top.x, top.y, u * 0.13, 0, Math.PI * 2);
        c.fill();
      } else {
        // Claws or bare hands.
        c.lineWidth = Math.max(1.5, u * 0.05);
        c.strokeStyle = '#e8e0d0';
        for (let i = -1; i <= 1; i++) {
          const angle = Math.atan2(dy, dx) + i * 0.32;
          c.beginPath();
          c.moveTo(hand.x, hand.y);
          c.lineTo(hand.x + Math.cos(angle) * u * 0.32, hand.y + Math.sin(angle) * u * 0.32);
          c.stroke();
        }
      }
      c.restore();
    },

    _drawBow(c, geo, w) {
      const u = geo.unit;
      const cx = w.offHand.x;
      const cy = w.offHand.y;
      const r = u * 0.75;
      c.save();
      c.lineCap = 'round';
      c.lineWidth = Math.max(2, u * 0.08);
      c.strokeStyle = '#a07a45';
      c.beginPath();
      c.arc(cx, cy, r, -Math.PI / 2 + (geo.facing > 0 ? 0 : Math.PI), Math.PI / 2 + (geo.facing > 0 ? 0 : Math.PI), geo.facing < 0);
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(230, 230, 230, 0.7)';
      c.beginPath();
      c.moveTo(cx, cy - r);
      c.lineTo(w.hand.x, w.hand.y);
      c.lineTo(cx, cy + r);
      c.stroke();
      c.restore();
    },

    // Shield strapped to the left forearm, following its angle.
    _drawShieldArm(c, geo, ringColor) {
      const u = geo.unit;
      const arm = geo.arms.left;
      const angle = Math.atan2(arm.hand.y - arm.elbow.y, arm.hand.x - arm.elbow.x);
      const cx = (arm.hand.x + arm.elbow.x) / 2;
      const cy = (arm.hand.y + arm.elbow.y) / 2;
      c.save();
      c.translate(cx, cy);
      c.rotate(angle);
      c.fillStyle = '#2a2f36';
      c.strokeStyle = rgba(ringColor, 0.9);
      c.lineWidth = Math.max(2, u * 0.07);
      c.beginPath();
      c.ellipse(0, 0, u * 0.5, u * 0.34, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = 'rgba(255, 255, 255, 0.12)';
      c.beginPath();
      c.arc(0, 0, u * 0.12, 0, Math.PI * 2);
      c.fill();
      c.restore();
    },

    // Helmet cap over the portrait disc.
    _drawHelmet(c, head, facing) {
      const r = head.r;
      c.save();
      c.lineCap = 'round';
      c.lineWidth = Math.max(3, r * 0.22);
      c.strokeStyle = '#b8bfc7';
      c.shadowColor = 'rgba(0, 0, 0, 0.6)';
      c.shadowBlur = r * 0.2;
      c.beginPath();
      c.arc(head.x, head.y, r * 1.02, Math.PI * 1.12, Math.PI * 1.88);
      c.stroke();
      c.lineWidth = Math.max(2, r * 0.1);
      c.beginPath();
      c.moveTo(head.x + facing * r * 0.05, head.y - r * 0.95);
      c.lineTo(head.x + facing * r * 0.05, head.y - r * 0.35);
      c.stroke();
      c.restore();
    },

    _drawHead(c, head, side, combatant, ringColor, isActor, flashMix) {
      const radius = head.r;
      const fallback = side === 'player' ? this._playerFallback : this._targetFallback;
      const img = this._imageFor(combatant.image, fallback);
      const x = head.x;
      const y = head.y;
      c.save();
      const glow = c.createRadialGradient(x, y, radius * 0.7, x, y, radius * 1.6);
      glow.addColorStop(0, rgba(ringColor, isActor ? 0.34 : 0.16));
      glow.addColorStop(1, rgba(ringColor, 0));
      c.fillStyle = glow;
      c.beginPath();
      c.arc(x, y, radius * 1.6, 0, Math.PI * 2);
      c.fill();

      c.save();
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.closePath();
      c.clip();
      c.fillStyle = side === 'player' ? '#07131a' : '#180d0b';
      c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      if (img && img.naturalWidth > 0) {
        const scale = Math.max((radius * 2) / img.naturalWidth, (radius * 2) / img.naturalHeight);
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        c.drawImage(img, x - drawW / 2, y - radius - (drawH - radius * 2) * 0.3, drawW, drawH);
      } else {
        this._drawSilhouette(c, { x, y }, radius, combatant, ringColor);
      }
      if (flashMix > 0) {
        c.fillStyle = 'rgba(255, 244, 230, ' + (0.42 * flashMix) + ')';
        c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      c.restore();

      c.lineWidth = Math.max(2, radius * 0.1);
      c.strokeStyle = rgba(ringColor, 0.95);
      c.shadowColor = rgba(ringColor, 0.7);
      c.shadowBlur = isActor ? radius * 0.4 : radius * 0.15;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    },

    _drawProjectile(c, layout, tokens, sample) {
      const action = sample.action;
      if (!action || action.result === 'absorb') return;
      const actorView = this._view && this._view[action.actorSide];
      if (!actorView) return;
      const figure = resolveFigure(actorView, action.actorSide);
      if (figure.weapon !== 'bow' && figure.weapon !== 'staff') return;
      const start = 0.11;
      const end = 0.17;
      if (sample.progress < start || sample.progress > end) return;
      const t = (sample.progress - start) / (end - start);
      const from = tokens[action.actorSide];
      const to = tokens[action.impactSide];
      const unit = layout.radius * FIGURE_UNIT_SCALE;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y - unit * 0.6 + (to.y - from.y) * t - Math.sin(t * Math.PI) * unit * 0.4;
      const dir = action.actorSide === 'player' ? 1 : -1;
      c.save();
      if (figure.weapon === 'bow') {
        c.lineWidth = Math.max(1.5, unit * 0.05);
        c.strokeStyle = '#e6d8b8';
        c.beginPath();
        c.moveTo(x - dir * unit * 0.45, y);
        c.lineTo(x + dir * unit * 0.2, y);
        c.stroke();
      } else {
        const tint = action.actorSide === 'player' ? this._palette.accent : this._palette.danger;
        c.fillStyle = rgba(tint, 0.95);
        c.shadowColor = rgba(tint, 0.9);
        c.shadowBlur = unit * 0.5;
        c.beginPath();
        c.arc(x, y, unit * 0.16, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    },

    _drawSilhouette(c, token, radius, combatant, ringColor) {
      const initial = (combatant && combatant.name ? String(combatant.name).trim() : '')
        .replace(/^(an?|the)\s+/i, '')
        .charAt(0)
        .toUpperCase() || '?';
      // Head and shoulders shape so an unloaded portrait still reads as a body.
      c.fillStyle = rgba(ringColor, 0.22);
      c.beginPath();
      c.arc(token.x, token.y - radius * 0.22, radius * 0.34, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(token.x, token.y + radius * 0.62, radius * 0.72, radius * 0.5, 0, Math.PI, Math.PI * 2);
      c.fill();
      c.fillStyle = rgba(this._palette.text, 0.9);
      c.font = '700 ' + Math.round(radius * 0.62) + 'px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(initial, token.x, token.y + radius * 0.02);
    },

    _drawBackEffects(c, layout, tokens, sample) {
      for (const effect of sample.effects) {
        if (effect.type === 'ghost') this._drawGhost(c, layout, tokens[effect.side], effect);
      }
    },

    _drawFrontEffects(c, layout, tokens, sample) {
      this._drawProjectile(c, layout, tokens, sample);
      for (const effect of sample.effects) {
        const token = tokens[effect.side];
        if (effect.type === 'slash') this._drawSlash(c, layout, token, effect);
        else if (effect.type === 'burst') this._drawBurst(c, layout, token, effect);
        else if (effect.type === 'whiff') this._drawWhiff(c, layout, token, effect);
        else if (effect.type === 'shield') this._drawShield(c, layout, token, effect);
      }
      if (sample.badge) this._drawBadge(c, layout, tokens[sample.badge.side], sample.badge, sample.number);
      if (sample.number) this._drawNumber(c, layout, tokens[sample.number.side], sample.number);
    },

    _drawSlash(c, layout, token, effect) {
      const p = effect.progress;
      if (p >= 1) return;
      const radius = layout.radius;
      const alpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
      const arcs = effect.critical ? 3 : 2;
      c.save();
      c.globalAlpha = Math.max(0, alpha);
      c.lineCap = 'round';
      for (let i = 0; i < arcs; i++) {
        const spread = (i - (arcs - 1) / 2) * radius * 0.42;
        const angle = -0.9 * effect.direction + i * 0.18;
        const sweepStart = angle - 0.7 - p * 0.9;
        const sweepEnd = angle + 0.7 - p * 0.9;
        c.lineWidth = Math.max(2, radius * (effect.critical ? 0.09 : 0.06)) * (1 - p * 0.5);
        c.strokeStyle = rgba(effect.tint, 0.95);
        c.shadowColor = rgba(effect.tint, 0.8);
        c.shadowBlur = radius * 0.3;
        c.beginPath();
        c.arc(token.x + spread * 0.4, token.y - spread * 0.2, radius * (0.75 + i * 0.22), sweepStart, sweepEnd);
        c.stroke();
      }
      c.restore();
    },

    _drawBurst(c, layout, token, effect) {
      const p = effect.progress;
      if (p >= 1) return;
      const radius = layout.radius;
      c.save();
      const ringAlpha = Math.max(0, 1 - p * 1.3);
      c.strokeStyle = rgba(effect.tint, ringAlpha);
      c.lineWidth = Math.max(1, radius * 0.05 * (1 - p));
      c.beginPath();
      c.arc(token.x, token.y, radius * (0.9 + p * (effect.critical ? 1.3 : 0.8)), 0, Math.PI * 2);
      c.stroke();
      if (p < 0.25) {
        c.fillStyle = 'rgba(255, 240, 210, ' + (0.55 * (1 - p / 0.25)) + ')';
        c.beginPath();
        c.arc(token.x, token.y, radius * 0.55 * (1 + p * 2), 0, Math.PI * 2);
        c.fill();
      }
      for (const particle of effect.particles) {
        const life = Math.min(1, p / particle.life);
        if (life >= 1) continue;
        const distance = radius * (0.6 + particle.speed * life * 1.9);
        const x = token.x + Math.cos(particle.angle) * distance;
        const y = token.y + Math.sin(particle.angle) * distance + life * life * radius * 0.5;
        c.fillStyle = rgba(effect.tint, 1 - life);
        c.beginPath();
        c.arc(x, y, particle.size * (1 - life * 0.5), 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    },

    _drawWhiff(c, layout, token, effect) {
      const p = effect.progress;
      if (p >= 1) return;
      const radius = layout.radius;
      const alpha = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      const travel = (p - 0.5) * radius * 1.4 * effect.direction;
      c.save();
      c.globalAlpha = Math.max(0, alpha * 0.7);
      c.strokeStyle = rgba(effect.tint, 0.9);
      c.lineWidth = Math.max(1.5, radius * 0.04);
      c.lineCap = 'round';
      c.setLineDash([radius * 0.18, radius * 0.12]);
      c.beginPath();
      c.arc(token.x + travel - effect.direction * radius * 0.9, token.y - radius * 0.6, radius * 1.15,
        -0.55 * effect.direction - 0.9, -0.55 * effect.direction + 0.9);
      c.stroke();
      c.restore();
    },

    _drawGhost(c, layout, token, effect) {
      const p = effect.progress;
      if (p >= 1) return;
      const radius = layout.radius;
      c.save();
      c.globalAlpha = Math.max(0, 0.55 * (1 - p));
      c.strokeStyle = rgba(effect.tint, 0.9);
      c.lineWidth = Math.max(1.5, radius * 0.05);
      c.setLineDash([radius * 0.12, radius * 0.1]);
      c.beginPath();
      c.arc(token.baseX, token.baseY, radius * (1 + p * 0.1), 0, Math.PI * 2);
      c.stroke();
      c.restore();
    },

    _drawShield(c, layout, token, effect) {
      const p = effect.progress;
      if (p >= 1) return;
      const radius = layout.radius;
      c.save();
      const bubble = c.createRadialGradient(token.x, token.y, radius * 0.9, token.x, token.y, radius * 1.35);
      bubble.addColorStop(0, rgba(effect.tint, 0));
      bubble.addColorStop(0.8, rgba(effect.tint, 0.28 * (1 - p)));
      bubble.addColorStop(1, rgba(effect.tint, 0));
      c.fillStyle = bubble;
      c.beginPath();
      c.arc(token.x, token.y, radius * 1.35, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = rgba(effect.tint, 0.9 * (1 - p));
      c.lineWidth = Math.max(2, radius * 0.06);
      c.beginPath();
      c.arc(token.x, token.y, radius * (1.12 + p * 0.35), 0, Math.PI * 2);
      c.stroke();
      c.restore();
    },

    _drawBadge(c, layout, token, badge, number) {
      // Landed hits let the number speak; other results get a label.
      if ((badge.result === 'hit' || badge.result === 'critical') && number) return;
      const radius = layout.radius;
      const label = RESULT_BADGES[badge.result] || String(badge.result).toUpperCase();
      c.save();
      c.globalAlpha = Math.max(0, badge.alpha);
      c.font = '700 ' + Math.max(10, Math.round(radius * 0.3)) + 'px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      // Badges sit inside the token's upper half so they never collide with
      // the DOM health overlay above the stage.
      const y = token.y - radius * 0.45;
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      c.strokeText(label, token.x, y);
      c.fillStyle = badge.tint;
      c.fillText(label, token.x, y);
      c.restore();
    },

    _drawNumber(c, layout, token, number) {
      const radius = layout.radius;
      const size = Math.max(14, Math.round(radius * (number.critical ? 0.62 : 0.5) * number.scale));
      // Numbers start near the token's heart and rise to its crown. Keeping
      // them inside the token's own footprint stops them from crossing the
      // health bars in short panes.
      const y = token.y + radius * 0.1 - number.rise * radius * 0.55;
      c.save();
      c.globalAlpha = Math.max(0, number.alpha);
      c.font = (number.critical ? '700 ' : '600 ') + size + 'px Georgia, "Times New Roman", serif';
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.lineWidth = Math.max(3, size * 0.12);
      c.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      c.strokeText(String(number.value), token.x, y);
      c.fillStyle = number.side === 'player' ? this._palette.danger : number.tint;
      c.shadowColor = rgba(number.tint, 0.6);
      c.shadowBlur = size * 0.4;
      c.fillText(String(number.value), token.x, y);
      c.restore();
    },
  };

  stage._observe();
  return stage;
}
