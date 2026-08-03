const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export class HowlerAudioEngine {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.unlocked = false;
    this.unlockListeners = new Set();
    this.unlockInFlight = null;
    this.unlockProbe = null;
  }

  isAvailable() {
    return typeof this.runtime.Howl === 'function' && !!this.runtime.Howler;
  }

  isUnlocked() {
    return this.unlocked;
  }

  onUnlock(callback) {
    this.unlockListeners.add(callback);
    return () => this.unlockListeners.delete(callback);
  }

  markLocked() {
    this.unlocked = false;
  }

  setGlobalVolume(volume) {
    if (!this.isAvailable()) return;
    this.runtime.Howler.volume(volume);
  }

  create(src, { html5 = false, preload = true } = {}) {
    if (!this.isAvailable()) {
      throw new Error('Howler audio runtime is unavailable');
    }

    const handle = {
      src,
      html5,
      howl: null,
    };
    handle.howl = new this.runtime.Howl({
      src: [src],
      html5,
      preload,
      onplay: () => this._markUnlocked(),
      onunlock: () => this._markUnlocked(),
    });
    return handle;
  }

  play(handle, { volume = 1, loop = false } = {}) {
    const id = handle.howl.play();
    if (id === null || id === undefined) return null;
    handle.howl.volume(volume, id);
    handle.howl.loop(loop, id);
    return id;
  }

  once(handle, event, callback, id) {
    handle.howl.once(event, callback, id);
  }

  off(handle, event, callback, id) {
    handle.howl.off(event, callback, id);
  }

  stop(handle, id) {
    handle.howl.stop(id);
  }

  setPlaybackVolume(handle, volume, id) {
    handle.howl.volume(volume, id);
  }

  async unlock() {
    if (!this.isAvailable()) return false;
    if (this.unlocked) return true;
    if (this.unlockInFlight) return this.unlockInFlight;

    this.unlockInFlight = this._attemptUnlock().finally(() => {
      this.unlockInFlight = null;
    });
    return this.unlockInFlight;
  }

  async _attemptUnlock() {
    const probe = this._ensureUnlockProbe();
    const howler = this.runtime.Howler;

    if (howler.usingWebAudio && howler.ctx && typeof howler.ctx.resume === 'function') {
      try {
        await howler.ctx.resume();
        if (howler.ctx.state === 'running') {
          this._markUnlocked();
          return true;
        }
      } catch {
        // The playback probe below provides the HTML5 and rejected-resume fallback.
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      let playbackId = null;
      const finish = (unlocked) => {
        if (settled) return;
        settled = true;
        this.runtime.clearTimeout(timeout);
        probe.howl.off('play', onPlay);
        probe.howl.off('playerror', onPlayError);
        if (unlocked) this._markUnlocked();
        resolve(unlocked);
      };
      const onPlay = (id) => {
        probe.howl.stop(id);
        finish(true);
      };
      const onPlayError = () => finish(false);
      const timeout = this.runtime.setTimeout(() => finish(false), 1500);

      probe.howl.once('play', onPlay);
      probe.howl.once('playerror', onPlayError);
      playbackId = probe.howl.play();
      if (playbackId === null || playbackId === undefined) finish(false);
    });
  }

  _ensureUnlockProbe() {
    if (this.unlockProbe) return this.unlockProbe;
    this.unlockProbe = this.create(SILENT_AUDIO_DATA_URI, {
      html5: false,
      preload: true,
    });
    this.unlockProbe.howl.volume(0.001);
    return this.unlockProbe;
  }

  _markUnlocked() {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const callback of this.unlockListeners) callback();
  }
}

export function createHowlerAudioEngine(runtime = globalThis) {
  return new HowlerAudioEngine(runtime);
}
