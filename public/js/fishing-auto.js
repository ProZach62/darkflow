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

import { appendSystemMessage } from './output.js';
import { createFightController } from './fishing-auto-core.mjs';

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
  NO_BAIT: 'Out of bait.',
  SESSION_END: 'The fishing session ended.',
  DISCONNECTED: 'Connection lost.',
  BAD_PARAMS: 'The server sent a fight this addon cannot model.',
};

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

  // The fishing panel manager. Handed over by fishingManager.init() rather
  // than imported, so dependencies only ever flow fishing-manager ->
  // fishing-auto and there is no import cycle to reason about.
  manager: null,

  init() {
    this._resetStats();
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

  // ---- Enable / disable ----------------------------------------------------

  enable() {
    if (this.enabled) return;
    this._resetStats();
    this.stats.startedAt = Date.now();
    this.haltReason = '';
    this.enabled = true;
    appendSystemMessage('Auto-Angler on.');
  },

  // `reason` should be one of HALT_REASONS. Disabling always clears the
  // controller: a controller is only ever valid for the fight it was built for.
  disable(reason = '') {
    if (!this.enabled) return;
    this.enabled = false;
    this.controller = null;
    this.haltReason = reason;
    appendSystemMessage('Auto-Angler off.' + (reason ? ' ' + reason : ''));
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
  //
  // These three entry points do the same thing today. They are separate
  // because they diverge later - onFightEnd feeds the run counters and starts
  // the next cycle (4.7), onDisconnect halts the run outright (4.9) - and
  // naming them now means fishing-manager.js does not need touching again.

  // The local simulation reached an outcome: 'caught', 'snap', or 'slack'.
  // Note this is our *reported* outcome, not the server's verdict, which
  // arrives separately as Caught or Escaped and can disagree.
  onFightEnd() {
    this.controller = null;
  },

  // The server's verdict on the attempt: 'caught', or an Escaped reason
  // ('snap', 'slack', 'timeout', 'implausible').
  //
  // This is the authoritative outcome and the one later work must act on - the
  // server can and does disagree with what we reported, and only it knows
  // whether a catch was accepted. It also covers the case onFightEnd misses:
  // when the server ends an attempt before our local simulation reaches an
  // outcome of its own, such as a bite we never hooked in time.
  onServerVerdict() {
    this.controller = null;
  },

  // The panel reset into a new phase - a new session opened, the session
  // ended, or the player closed the panel.
  onSessionReset() {
    this.controller = null;
  },

  // The socket dropped. The server session nonce is dead, so anything we might
  // send from here would be silently discarded server-side.
  onDisconnect() {
    this.controller = null;
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

  // ---- Status --------------------------------------------------------------

  status() {
    const s = this.stats || { landed: 0, lost: {}, cycles: 0 };
    const lost = Object.values(s.lost).reduce((a, b) => a + b, 0);
    return {
      enabled: this.enabled,
      landed: s.landed,
      lost,
      lostBy: { ...s.lost },
      cycles: s.cycles,
      haltReason: this.haltReason,
    };
  },
};
