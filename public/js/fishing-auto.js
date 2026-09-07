// fishing-auto.js - the Auto-Angler: plays Darkwind's fishing mini-game.
//
// This module owns everything impure - the loop state machine, GMCP wiring,
// timers, panel controls, and the slash command. All the decisions about *how*
// to play live in fishing-auto-core.mjs, which is pure and unit-tested.
//
// Design constraint worth stating up front: when the Auto-Angler is disabled it
// must be completely inert. A player who never turns it on should not be able
// to tell the module exists (PRD metric M8). That is why the hook in
// fishing-manager.js is a single call to resolveHeld() that returns its
// argument unchanged while we are off.
//
// Nothing here reaches the socket or the settings store directly. app.js hands
// over those capabilities through configureRuntime(), the same way the timer
// manager receives its sendCommand, so the tests can capture every command
// and setting without a socket or localStorage.

import { appendSystemMessage } from './output.js';
import {
  createFightController,
  createRng,
  castReleaseMs,
  jitterPower,
  isReleaseUsable,
  hookDelayMs,
  castPowerAt,
  nextCastPower,
  cycleDelayMs,
  baitDelayMs,
  normalizeCastPower,
  normalizePowerOverride,
  parseAutofishCommand,
  formatAutofishStatus,
  formatAutofishSummary,
  TUNING,
} from './fishing-auto-core.mjs';

// Params whose degradation means our model of the fight no longer matches the
// fight the simulation is actually running.
//
// normalizeFightParams clamps a malformed payload into something safe to do
// arithmetic with, but fishing-manager builds the real simulation from the raw
// values - so where the two diverge we would be playing blind. barSize decides
// the catch window, and the two rates decide every progress projection. A bad
// barSize is the worst case: the simulation would compute a negative overlap
// window that no distance can satisfy, making the fight unwinnable, while our
// clamped model happily projects a catch and holds the line until it snaps.
//
// strength and erratic are absent deliberately - the controller never reads
// them. stamina is absent because the simulation applies the same Math.max(1)
// floor we do, so a bad value degrades both models identically.
const MODEL_CRITICAL = new Set(['barSize', 'progressRate', 'drainRate']);

// Why the Auto-Angler stopped. Surfaced through `/autofish` and the panel.
//
// These are appended to "Auto-Angler off." so they read as the reason, not as
// a repeat of the state. Keep them literal - PRD 6.2 allows the panel's dry
// humour for idle flavour, but a halt reason costs the player time to
// misread.
export const HALT_REASONS = {
  MANUAL: 'You took over.',
  SWITCHED_OFF: 'Switched off.',
  NO_BAIT: 'Out of bait.',
  SESSION_END: 'The fishing session ended.',
  DISCONNECTED: 'Connection lost.',
  BAD_PARAMS: 'The server sent a fight this addon cannot model.',
};

// settingsManager keys (PRD 4.7, 4.37). settings-manager.js normalizes these
// on load with the same bounds the core uses.
export const AUTOFISH_SETTINGS = Object.freeze({
  enabled: 'autofishEnabled',
  power: 'autofishCastPower',
  override: 'autofishPowerOverride',
});

// The two MUD commands the loop sends (PRD 4.8, 4.9). Both go out through
// sendAutomaticCommand with echo on, so the player can audit them (PRD 4.43).
const COMMANDS = Object.freeze({
  FISH: 'fish',
  BAIT: 'bait hook',
});

export const fishingAuto = {
  // Master switch. Off until the player asks for it, and off again the moment
  // they touch the panel themselves.
  enabled: false,

  // Controller for the fight currently in progress, or null between fights.
  controller: null,

  // Why we last stopped, for `/autofish` status and the panel message.
  haltReason: '',

  // Per-run tallies. Reset when the player enables the Auto-Angler, not on
  // every fight, so the numbers describe the session they actually started.
  stats: null,

  // Randomness for cast and hook timing. Reseeded on enable; tests replace it
  // to make a run reproducible.
  rand: null,

  // Cast power the adaptive policy has settled on, before per-cast jitter.
  // Persisted, so a restart picks up where the last run left off.
  castPower: TUNING.castPowerStart,

  // `/autofish power <n>` pins the cast power here; null means adaptive.
  powerOverride: null,

  // True between sending "bait hook" and the next session Open. A second
  // unbaited Open while this is set means there was no bait to apply, which is
  // the structured out-of-bait signal PRD 7.4 describes.
  _baitAttempted: false,

  // Pending setTimeout handles, so a phase change can cancel work that is no
  // longer wanted. A stale timer firing into a dead session is the classic way
  // an addon like this sends nonsense to the server.
  _timers: new Set(),

  // The fishing panel manager. Handed over by fishingManager.init() rather
  // than imported, so dependencies only ever flow fishing-manager ->
  // fishing-auto and there is no import cycle to reason about.
  manager: null,

  // Capabilities injected by app.js. Every one is optional: with none of them
  // the addon still plays a session it is handed, it just cannot start one or
  // remember anything.
  _runtime: {
    sendCommand: null,   // (text) => boolean; expected to echo
    isConnected: null,   // () => boolean
    loadSetting: null,   // (key) => value
    saveSetting: null,   // (key, value) => void
  },

  init() {
    this._resetStats();
    this.castPower = normalizeCastPower(this._load(AUTOFISH_SETTINGS.power));
    this.powerOverride = normalizePowerOverride(this._load(AUTOFISH_SETTINGS.override));
    // A run left on when the client closed comes back armed (PRD 4.7). It
    // does not send "fish" on its own: at startup the socket is at the login
    // prompt, where "fish" would be typed as a character name. The armed
    // addon takes over the moment a fishing session opens.
    if (this._load(AUTOFISH_SETTINGS.enabled) === true) this.enable({ restored: true });
  },

  configureRuntime(runtime = {}) {
    this._runtime = { ...this._runtime, ...runtime };
  },

  attach(manager) {
    this.manager = manager;
  },

  _resetStats() {
    this.stats = {
      landed: 0,
      lost: { snap: 0, slack: 0, timeout: 0, implausible: 0, other: 0 },
      cycles: 0,
      startedAt: 0,
    };
  },

  // ---- Runtime capabilities ------------------------------------------------

  _load(key) {
    const fn = this._runtime.loadSetting;
    try {
      return fn ? fn(key) : undefined;
    } catch (err) {
      return undefined;
    }
  },

  _save(key, value) {
    const fn = this._runtime.saveSetting;
    if (!fn) return;
    try {
      fn(key, value);
    } catch (err) {
      console.warn('Auto-Angler could not save ' + key, err);
    }
  },

  _connected() {
    const fn = this._runtime.isConnected;
    return fn ? !!fn() : true;
  },

  _send(command) {
    const fn = this._runtime.sendCommand;
    if (!fn) return false;
    return fn(command) !== false;
  },

  _refreshPanel() {
    const m = this.manager;
    if (m && typeof m._render === 'function') m._render();
  },

  // ---- Enable / disable ----------------------------------------------------

  enable(opts = {}) {
    if (this.enabled) return;
    this._resetStats();
    this.stats.startedAt = Date.now();
    this.haltReason = '';
    this._baitAttempted = false;
    this.rand = createRng(Number.isFinite(opts.seed) ? opts.seed : (Date.now() % 2147483647));
    this.enabled = true;
    this._save(AUTOFISH_SETTINGS.enabled, true);
    appendSystemMessage(opts.restored
      ? 'Auto-Angler on (restored). It takes over when a fishing session opens.'
      : 'Auto-Angler on.');
    this._refreshPanel();
    if (!opts.restored) this._kick();
  },

  // `reason` should be one of HALT_REASONS. Disabling always clears the
  // controller: a controller is only ever valid for the fight it was built for.
  disable(reason = '') {
    if (!this.enabled) return;
    this.enabled = false;
    this.controller = null;
    this._baitAttempted = false;
    this.cancelTimers();
    this.haltReason = reason;
    this._save(AUTOFISH_SETTINGS.enabled, false);
    appendSystemMessage('Auto-Angler off.' + (reason ? ' ' + reason : ''));
    this._refreshPanel();
  },

  // The panel's toggle button.
  toggle() {
    if (this.enabled) this.disable(HALT_REASONS.SWITCHED_OFF);
    else this.enable();
  },

  isActive() {
    return this.enabled;
  },

  // The player touched the fishing panel themselves (PRD 4.40). Hand control
  // straight back - two things driving one bar is worse than either alone.
  //
  // Only deliberate presses reach here. `pointerup`, `pointercancel` and
  // `pointerleave` deliberately do not: a release only matters if a press
  // already happened, and that press already disabled us. `pointerleave` in
  // particular would make the addon unusable, killing a run the moment the
  // cursor drifted off the panel - which for an unattended addon is not a
  // hypothetical. Auto-repeat keydowns are filtered for the same reason: they
  // are one held key, not a new decision.
  notifyManualInput() {
    if (!this.enabled) return;
    this.disable(HALT_REASONS.MANUAL);
  },

  // ---- Timers --------------------------------------------------------------

  _after(delayMs, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, Math.max(0, delayMs));
    this._timers.add(id);
    return id;
  },

  cancelTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  },

  // ---- The loop ------------------------------------------------------------

  // Do whatever the current panel phase calls for (PRD 4.8-4.12). Called when
  // the addon is switched on and at the start of every cycle; the phases in
  // between (casting, waiting, bite, hooking, fight) drive themselves through
  // the manager's notifications.
  _kick() {
    if (!this.enabled) return;
    const m = this.manager;
    const phase = m ? m.phase : 'idle';
    if (!m || !m.session || phase === 'idle') {
      // No session: open one. Nothing to send into when the socket is down;
      // the run halts on the disconnect notification anyway.
      if (this._connected()) this._send(COMMANDS.FISH);
      return;
    }
    if (phase === 'ready') {
      this.beginCast();
      return;
    }
    if (phase === 'nobait' || phase === 'caught' || phase === 'escaped') {
      this._bait();
    }
  },

  // "bait hook", then "fish" a beat later (PRD 4.9). The server answers the
  // second command with a fresh Open, and whether that Open is baited is the
  // only bait signal we act on.
  _bait() {
    if (!this.enabled) return;
    this._baitAttempted = true;
    this._send(COMMANDS.BAIT);
    this._after(baitDelayMs(this.rand), () => {
      if (this.enabled) this._send(COMMANDS.FISH);
    });
  },

  // A session opened. `phase` is 'ready' when the hook is baited, 'nobait'
  // otherwise.
  onSessionOpen(phase) {
    if (!this.enabled) return;
    this.cancelTimers();
    if (phase === 'ready') {
      this._baitAttempted = false;
      this.beginCast();
      return;
    }
    if (phase === 'nobait') {
      if (this._baitAttempted) {
        // We just baited and the hook is still bare: there was nothing to
        // bait it with (PRD 4.10).
        this.disable(HALT_REASONS.NO_BAIT);
        return;
      }
      this._bait();
    }
  },

  // ---- Cast and hook -------------------------------------------------------

  // The power the next cast aims at, before per-cast jitter.
  targetPower() {
    return this.powerOverride === null ? this.castPower : this.powerOverride;
  },

  // Charge and release a cast (PRD 4.14-4.17).
  //
  // The cast goes out through the manager's own _sendCast, and the power is
  // read from the live oscillator at the moment of release rather than chosen
  // and asserted. That is the point of timing the release instead of picking a
  // number: the resulting Darkwind.Fishing.Cast is produced by exactly the code
  // a manual cast runs through, so it cannot differ in form.
  beginCast() {
    const m = this.manager;
    if (!this.enabled || !m || m.phase !== 'ready') return;

    const target = jitterPower(this.targetPower(), this.rand);

    // Mirrors the castDown handler in fishing-manager's _build: enter the
    // charging phase, mark the start, and let the loop animate the meter.
    m.phase = 'casting';
    m._castStart = performance.now();
    m._render();
    // The loop only animates the power meter, and its casting branch reads
    // panel elements directly. Skip it if the panel is not built - the cast
    // still goes out on schedule, it just charges invisibly.
    if (m.els) m._startLoop();

    this._after(castReleaseMs(target), () => this.releaseCast());
  },

  releaseCast() {
    const m = this.manager;
    if (!this.enabled || !m || m.phase !== 'casting') return;

    const elapsed = performance.now() - m._castStart;
    m._stopLoop();

    // A release scheduled late is usually harmless - the power simply reads
    // lower than intended, which is human enough. Past a full oscillator
    // period the wave has wrapped and the reading means nothing, so abandon
    // the cast and let the next cycle try again rather than send a number we
    // did not intend.
    if (!isReleaseUsable(elapsed)) {
      m.phase = 'ready';
      m._render();
      return;
    }

    m._sendCast(castPowerAt(elapsed));
  },

  // A fish is biting. React after a human-plausible delay rather than on the
  // frame the message arrived (PRD 4.18-4.20).
  onBite(windowMs) {
    if (!this.enabled) return;
    this._after(hookDelayMs(windowMs, this.rand), () => {
      // The window may have closed, the player may have taken over, or the
      // session may have ended while this was pending. Hooking into any of
      // those sends a message the server will discard at best.
      if (!this.enabled) return;
      const m = this.manager;
      if (!m || m.phase !== 'bite') return;
      m._sendHook();
    });
  },

  // ---- Fight lifecycle -----------------------------------------------------

  // Called by fishingManager._onFight with the exact params and seed it handed
  // to createFightSim - not the raw message. Passing the same values matters:
  // the manager applies its own `data.params || {}` and `data.seed || 1`
  // fallbacks, and a controller modelling anything else is modelling a
  // different fight.
  onFight(params, seed) {
    if (!this.enabled) return;

    const controller = createFightController(params, { seed });
    const broken = controller.params.degraded.filter((f) => MODEL_CRITICAL.has(f));

    if (broken.length) {
      // We cannot model this fight, so we should not be playing it. Handing
      // back is better than holding a line we cannot reason about.
      this.disable(HALT_REASONS.BAD_PARAMS + ' (' + broken.join(', ') + ')');
      return;
    }

    this.controller = controller;
  },

  // A controller is only ever valid for the one fight it was built for: it
  // carries that fight's seed, its params, and accumulated state like the lag
  // buffer and the stall latch. Reusing one across fights would play the next
  // fish with the last fish's model, so every path that ends a fight or
  // invalidates a session drops it.

  // The local simulation reached an outcome: 'caught', 'snap', or 'slack'.
  // Note this is our *reported* outcome, not the server's verdict, which
  // arrives separately as Caught or Escaped and can disagree.
  onFightEnd() {
    this.controller = null;
  },

  // The server's verdict on the attempt: 'caught', or an Escaped reason
  // ('snap', 'slack', 'timeout', 'implausible').
  //
  // This is the authoritative outcome, so it is what feeds the run counters
  // and the adaptive power (PRD 4.13, 4.33-4.36) - the server can and does
  // disagree with what we reported, and only it knows whether a catch was
  // accepted. It also covers the case onFightEnd misses: when the server ends
  // an attempt before our local simulation reaches an outcome of its own,
  // such as a bite we never hooked in time. The next cycle starts after a
  // randomised pause (PRD 4.12).
  onServerVerdict(outcome) {
    this.controller = null;
    if (!this.enabled) return;
    this._tally(outcome);
    if (this.powerOverride === null) {
      const next = nextCastPower(this.castPower, outcome);
      if (next !== this.castPower) {
        this.castPower = next;
        this._save(AUTOFISH_SETTINGS.power, next);
      }
    }
    this._refreshPanel();
    this._after(cycleDelayMs(this.rand), () => this._kick());
  },

  _tally(outcome) {
    const s = this.stats;
    s.cycles += 1;
    if (outcome === 'caught') s.landed += 1;
    else if (Object.prototype.hasOwnProperty.call(s.lost, outcome)) s.lost[outcome] += 1;
    else s.lost.other += 1;
  },

  // The panel reset into a new phase - a new session opened, the session
  // ended, or the player closed the panel. Only 'idle' is an ending: the
  // server's End, the panel's close handler, and a disconnect all land here,
  // and the run must not try to restart into a dead session (PRD 4.39).
  onSessionReset(phase) {
    this.controller = null;
    // Any pending cast release, hook, or cycle belongs to the phase we left.
    this.cancelTimers();
    if (phase === 'idle' && this.enabled) this.disable(HALT_REASONS.SESSION_END);
  },

  // The socket dropped. The server session nonce is dead, so anything we might
  // send from here would be silently discarded server-side.
  onDisconnect() {
    this.controller = null;
    this.cancelTimers();
    if (this.enabled) this.disable(HALT_REASONS.DISCONNECTED);
  },

  // ---- Manager hook --------------------------------------------------------

  // The single delegation point fishing-manager calls each simulation step.
  //
  // Returns `manualHeld` untouched whenever we are not driving, so the manual
  // game is bit-for-bit what it was before this module existed. Only an active
  // Auto-Angler with a live controller for the current fight takes over.
  resolveHeld(manualHeld, simState, dtMs) {
    if (!this.enabled || !this.controller) return manualHeld;
    return this.controller.decide(simState, dtMs);
  },

  // ---- Command and status --------------------------------------------------

  // `/autofish [on|off|power <n>|power auto]` (PRD 4.1-4.4). `args` are the
  // words after the command.
  handleCommand(args) {
    const parsed = parseAutofishCommand(args);
    switch (parsed.action) {
      case 'error':
        appendSystemMessage('Auto-Angler: ' + parsed.error);
        return;
      case 'on':
        if (this.enabled) appendSystemMessage('Auto-Angler is already on.');
        else this.enable();
        return;
      case 'off':
        if (!this.enabled) appendSystemMessage('Auto-Angler is already off.');
        else this.disable(HALT_REASONS.SWITCHED_OFF);
        return;
      case 'power':
        this.setPowerOverride(parsed.override);
        return;
      default:
        appendSystemMessage(formatAutofishStatus(this.status()));
    }
  },

  // null restores the adaptive policy; a number pins every cast (PRD 4.4).
  setPowerOverride(value) {
    this.powerOverride = normalizePowerOverride(value);
    this._save(AUTOFISH_SETTINGS.override, this.powerOverride);
    appendSystemMessage(this.powerOverride === null
      ? 'Auto-Angler cast power: adaptive (currently ' + this.castPower + ').'
      : 'Auto-Angler cast power fixed at ' + this.powerOverride + '.');
    this._refreshPanel();
  },

  status() {
    const s = this.stats || { landed: 0, lost: {}, cycles: 0 };
    const lost = Object.values(s.lost).reduce((a, b) => a + b, 0);
    return {
      enabled: this.enabled,
      phase: this.manager ? this.manager.phase : 'idle',
      landed: s.landed,
      lost,
      lostBy: { ...s.lost },
      cycles: s.cycles,
      power: this.targetPower(),
      castPower: this.castPower,
      powerOverride: this.powerOverride,
      haltReason: this.haltReason,
    };
  },

  // What the fishing panel renders: the toggle state, a one-line summary for
  // the status strip, and the last halt reason.
  panelState() {
    return {
      enabled: this.enabled,
      summary: formatAutofishSummary(this.status()),
      haltReason: this.haltReason,
    };
  },
};
