import { gmcp } from './gmcp.js';
import {
  createDpsState,
  finalizeEncounter,
  reduceDpsEvents,
  reduceDpsIdle,
  reduceDpsState,
  resetDpsSession,
  selectDpsView,
} from './dps-meter-core.mjs';

// The DPS panel is fed by document events rather than by a direct panel call,
// so the meter and the renderer stay decoupled the same way the Connection
// Health panel and lag-monitor do.
export const DPS_UPDATE_EVENT = 'dw:dps-update';
export const DPS_RESET_EVENT = 'dw:dps-reset';

// A live fight is re-rendered once a second so the elapsed clock and the
// rolling window keep moving between swings.
const DPS_TICK_MS = 1000;

export const dpsMeterManager = {
  model: createDpsState(),
  initialized: false,
  _tickTimer: null,

  init() {
    if (this.initialized) return;

    gmcp.on('Darkwind.Combat.State', (data) => this.handleState(data));
    gmcp.on('Darkwind.Combat.Events', (data) => this.handleEvents(data));
    // Some development servers emit one event per frame instead of a batch.
    // combat-visual-manager accepts the singular spelling too; matching it
    // keeps the meter from going silent on a mixed-version session.
    gmcp.on('Darkwind.Combat.Event', (data) => this.handleEvents({
      epoch: data && data.epoch,
      encounter_id: data && data.encounter_id,
      first_seq: data && data.seq,
      last_seq: data && data.seq,
      events: data ? [data] : [],
    }));

    if (typeof document !== 'undefined') {
      document.addEventListener(DPS_RESET_EVENT, () => this.resetSession());
    }

    this.initialized = true;
    this._publish();
  },

  handleState(payload) {
    if (!this.initialized) this.init();
    const next = reduceDpsState(this.model, payload);
    if (next === this.model) return;
    this.model = next;
    this._publish();
  },

  handleEvents(payload) {
    if (!this.initialized) this.init();
    const next = reduceDpsEvents(this.model, payload);
    if (next === this.model) return;
    this.model = next;
    this._publish();
  },

  resetSession() {
    this.model = resetDpsSession(this.model);
    this._publish();
  },

  getSnapshot() {
    return selectDpsView(this.model);
  },

  handleDisconnect() {
    // Close the live fight but keep the session totals on screen. A reconnect
    // arrives with a new epoch, which clears them.
    this.model = finalizeEncounter(this.model);
    this._publish();
  },

  _publish() {
    this._syncTicker();
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent(DPS_UPDATE_EVENT, {
      detail: selectDpsView(this.model),
    }));
  },

  _syncTicker() {
    if (!this.model.active) {
      this._clearTicker();
      return;
    }
    if (this._tickTimer || typeof setInterval !== 'function') return;
    this._tickTimer = setInterval(() => this._tick(), DPS_TICK_MS);
  },

  _tick() {
    const next = reduceDpsIdle(this.model);
    const closed = next !== this.model;
    this.model = next;
    if (closed) {
      this._publish();
      return;
    }
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent(DPS_UPDATE_EVENT, {
      detail: selectDpsView(this.model),
    }));
  },

  _clearTicker() {
    if (!this._tickTimer) return;
    clearInterval(this._tickTimer);
    this._tickTimer = null;
  },
};
