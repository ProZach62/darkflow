import { deepFreeze } from "../configuration/snapshot";
import type { SessionGmcpBus } from "../gmcp/bus";
import {
  DARKWIND_SOUND_CATEGORIES,
  normalizeDarkwindSound,
  type DarkwindSound,
  type DarkwindSoundCategory,
} from "../gmcp/contracts/sound";
import type { TransportReconnectStatusPayload } from "../transport/types";
import type { SessionEventBus } from "./event-bus";
import type { Unsubscribe } from "./events";
import type { SessionInteractions } from "./interactions";
import type { Disposer, ResourceScope } from "./resource-scope";

export const SESSION_AUDIO_CATEGORIES = [
  ...DARKWIND_SOUND_CATEGORIES.slice(0, -1),
  "fishing",
  "ui",
  "music",
] as const;

export type SessionAudioCategory = DarkwindSoundCategory | "fishing" | "music";
export type SessionAudioActivityKind = "play" | "loop" | null;

export interface SessionAudioSnapshot {
  readonly connected: boolean;
  readonly loggedIn: boolean;
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly volume: number;
  readonly audioUnlocked: boolean;
  readonly pendingCount: number;
  readonly currentCategory: SessionAudioCategory | null;
  readonly activityKind: SessionAudioActivityKind;
  readonly categoryEnabled: Readonly<Record<SessionAudioCategory, boolean>>;
  readonly categoryVolume: Readonly<Record<SessionAudioCategory, number>>;
}

export interface SessionAudio {
  getSnapshot(): SessionAudioSnapshot;
  subscribe(listener: (snapshot: SessionAudioSnapshot) => void): Unsubscribe;
  unlock(): Promise<boolean>;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  setCategoryEnabled(category: string, enabled: boolean): void;
  setCategoryVolume(category: string, volume: number): void;
  playLocal(category: string, sound: string, volume?: number): boolean;
  /** When the server last played a sound in this category on this connection; 0 if it has not. */
  serverPlayedAt(category: string): number;
  /**
   * True while the server has a loop of its own running in this category;
   * with `sound`, only a loop of that sound counts.
   */
  serverLoopActive(category: string, sound?: string): boolean;
  /** `fadeInMs` brings the loop up from silence; `fadeOutMs` lets it die away instead of cutting. */
  loopLocal(
    category: string,
    sound: string,
    id: string,
    volume?: number,
    options?: { fadeInMs?: number },
  ): boolean;
  stopLocal(category: string, id?: string, options?: { fadeOutMs?: number }): boolean;
}

interface RetainedSoundSettings {
  enabled: boolean;
  volume: number;
  categoryEnabled: Record<string, boolean>;
  categoryVolume: Record<string, number>;
  audioUnlocked: boolean;
  pendingCount: number;
}

export interface RetainedSoundManager {
  getSettings(): RetainedSoundSettings;
  onChange(listener: () => void): Unsubscribe;
  unlockFromUserGesture(): Promise<boolean>;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  setCategoryEnabled(category: string, enabled: boolean): void;
  setCategoryVolume(category: string, volume: number): void;
  play(category: string, sound: string, volume?: number): void;
  loop(
    category: string,
    sound: string,
    id: string,
    volume?: number,
    options?: { fadeInMs?: number },
  ): void;
  stop(category: string, id?: string, options?: { fadeOutMs?: number }): void;
  handleMessage(message: DarkwindSound): boolean;
  resetSessionPlayback(): void;
}

const SOUND_PACKAGE = "Darkwind.Sound";
const ONE_SHOT_ACTIVITY_MS = 2_000;
const AUTH_WINDOW_IDS = new Set(["login", "newchar", "charselect"]);
const LOGIN_THEME = {
  category: "music" as const,
  sound: "darkwind-theme",
  volume: 0.5,
};
const categorySet = new Set<string>(SESSION_AUDIO_CATEGORIES);
const tokenPattern = /^[A-Za-z0-9_./-]+$/;

function validToken(value: string): boolean {
  const token = value.trim();
  return (
    token.length >= 1 &&
    token.length <= 120 &&
    !token.startsWith("/") &&
    !token.includes("..") &&
    tokenPattern.test(token)
  );
}

function validVolume(volume: number | undefined): boolean {
  return volume === undefined || (Number.isFinite(volume) && volume >= 0 && volume <= 1);
}

function validFade(ms: number | undefined): boolean {
  return ms === undefined || (Number.isFinite(ms) && ms >= 0 && ms <= 10_000);
}

/** Creates the session-owned sound read model over the application-owned retained manager. */
export function createSessionAudio(
  gmcp: SessionGmcpBus,
  scope: ResourceScope,
  eventBus: SessionEventBus,
  interactions: SessionInteractions,
  manager: RetainedSoundManager,
): SessionAudio {
  let connected = false;
  // Client features that make their own sounds stand down for a category the
  // server is already scoring.
  const serverPlayed = new Map<string, number>();
  // Per category: loop id to the sound it is looping.
  const serverLoops = new Map<string, Map<string, string>>();
  let loggedIn = false;
  let supported = false;
  let currentCategory: SessionAudioCategory | null = null;
  let activityKind: SessionAudioActivityKind = null;
  let cancelActivityTimer: Disposer | null = null;
  let loginThemePlayed = false;
  let resetForDisconnect = false;
  let suppressManagerPublish = false;
  let disposed = false;
  const activeLoops = new Map<string, SessionAudioCategory>();
  const listeners = new Set<(snapshot: SessionAudioSnapshot) => void>();

  const createSnapshot = (): SessionAudioSnapshot => {
    const settings = manager.getSettings();
    const categoryEnabled = Object.fromEntries(
      SESSION_AUDIO_CATEGORIES.map((category) => [
        category,
        settings.categoryEnabled[category] !== false,
      ]),
    ) as Record<SessionAudioCategory, boolean>;
    const categoryVolume = Object.fromEntries(
      SESSION_AUDIO_CATEGORIES.map((category) => [
        category,
        settings.categoryVolume[category] ?? 0.5,
      ]),
    ) as Record<SessionAudioCategory, number>;
    return deepFreeze({
      connected,
      loggedIn,
      supported,
      enabled: settings.enabled,
      volume: settings.volume,
      audioUnlocked: settings.audioUnlocked,
      pendingCount: settings.pendingCount,
      currentCategory,
      activityKind,
      categoryEnabled,
      categoryVolume,
    });
  };

  let snapshot = createSnapshot();

  const publish = (): void => {
    if (disposed) return;
    snapshot = createSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const cancelActivity = (): void => {
    cancelActivityTimer?.();
    cancelActivityTimer = null;
  };

  const restoreLoopActivity = (): void => {
    const category = [...activeLoops.values()].at(-1) ?? null;
    currentCategory = category;
    activityKind = category === null ? null : "loop";
  };

  const showPlayActivity = (category: SessionAudioCategory): void => {
    cancelActivity();
    currentCategory = category;
    activityKind = "play";
    cancelActivityTimer = scope.setTimeout(() => {
      cancelActivityTimer = null;
      restoreLoopActivity();
      publish();
    }, ONE_SHOT_ACTIVITY_MS);
  };

  const showLoopActivity = (category: SessionAudioCategory, id: string): void => {
    cancelActivity();
    activeLoops.set(id, category);
    currentCategory = category;
    activityKind = "loop";
  };

  const clearStoppedActivity = (category: SessionAudioCategory, id?: string): void => {
    cancelActivity();
    if (id) activeLoops.delete(id);
    else {
      for (const [loopId, loopCategory] of activeLoops) {
        if (loopCategory === category) activeLoops.delete(loopId);
      }
    }
    restoreLoopActivity();
  };

  const clearActivity = (): void => {
    cancelActivity();
    activeLoops.clear();
    currentCategory = null;
    activityKind = null;
  };

  const runManagerAction = <T>(action: () => T): T => {
    suppressManagerPublish = true;
    try {
      return action();
    } finally {
      suppressManagerPublish = false;
    }
  };

  const play = (category: SessionAudioCategory, sound: string, volume?: number): boolean => {
    if (disposed || !connected) return false;
    runManagerAction(() => manager.play(category, sound, volume));
    showPlayActivity(category);
    publish();
    return true;
  };

  const loop = (
    category: SessionAudioCategory,
    sound: string,
    id: string,
    volume?: number,
    options?: { fadeInMs?: number },
  ): boolean => {
    if (disposed || !connected) return false;
    runManagerAction(() => manager.loop(category, sound, id, volume, options));
    showLoopActivity(category, id);
    publish();
    return true;
  };

  const stop = (
    category: SessionAudioCategory,
    id?: string,
    options?: { fadeOutMs?: number },
  ): boolean => {
    if (disposed) return false;
    runManagerAction(() => manager.stop(category, id, options));
    clearStoppedActivity(category, id);
    publish();
    return true;
  };

  const reconcileAuthWindows = (): void => {
    const settings = manager.getSettings();
    if (
      loginThemePlayed ||
      !connected ||
      !settings.enabled ||
      settings.categoryEnabled.music === false
    )
      return;
    const active = Object.values(interactions.getSnapshot().windows).some(
      (window) => window.type === "modal" && AUTH_WINDOW_IDS.has(window.sourceId),
    );
    if (active) {
      loginThemePlayed = play(LOGIN_THEME.category, LOGIN_THEME.sound, LOGIN_THEME.volume);
    }
  };

  const soundHandler = (data: unknown): void => {
    const sound = normalizeDarkwindSound(data);
    if (!sound || disposed || !connected) return;
    if (!runManagerAction(() => manager.handleMessage(sound))) return;
    if (sound.type === "play") serverPlayed.set(sound.category, Date.now());
    else if (sound.type === "loop") {
      const loops = serverLoops.get(sound.category) ?? new Map<string, string>();
      loops.set(sound.id, sound.sound);
      serverLoops.set(sound.category, loops);
    } else if (sound.id) serverLoops.get(sound.category)?.delete(sound.id);
    else serverLoops.delete(sound.category);
    if (sound.type === "play") showPlayActivity(sound.category);
    else if (sound.type === "loop") showLoopActivity(sound.category, sound.id);
    else clearStoppedActivity(sound.category, sound.id);
    publish();
  };
  gmcp.on(SOUND_PACKAGE, soundHandler);
  scope.own("listener", () => gmcp.off(SOUND_PACKAGE, soundHandler));

  const characterAttachedHandler = (): void => {
    loggedIn = true;
    publish();
  };
  for (const packageName of ["Char.Vitals", "Char.Status", "Darkwind.Session.Recovered"]) {
    gmcp.on(packageName, characterAttachedHandler);
    scope.own("listener", () => gmcp.off(packageName, characterAttachedHandler));
  }

  const supportsHandler = (): void => {
    if (disposed) return;
    supported = connected && gmcp.serverSupportsPackage(SOUND_PACKAGE);
    publish();
  };
  for (const packageName of ["Core.Supports.Set", "Core.Supports.Add", "Core.Supports.Remove"]) {
    gmcp.on(packageName, supportsHandler);
    scope.own("listener", () => gmcp.off(packageName, supportsHandler));
  }

  scope.own(
    "subscription",
    manager.onChange(() => {
      if (!disposed && !suppressManagerPublish) {
        reconcileAuthWindows();
        publish();
      }
    }),
  );

  scope.own(
    "subscription",
    interactions.subscribe(() => reconcileAuthWindows()),
  );

  scope.own(
    "subscription",
    eventBus.subscribe("transport:reconnect-status", (event) => {
      const payload = event.payload as TransportReconnectStatusPayload;
      if (payload.status === "connected") {
        connected = true;
        resetForDisconnect = false;
        supported = gmcp.serverSupportsPackage(SOUND_PACKAGE);
        reconcileAuthWindows();
        publish();
        return;
      }
      connected = false;
      serverPlayed.clear();
      serverLoops.clear();
      loggedIn = false;
      supported = false;
      loginThemePlayed = false;
      clearActivity();
      if (!resetForDisconnect) {
        resetForDisconnect = true;
        runManagerAction(() => manager.resetSessionPlayback());
      }
      publish();
    }),
  );

  scope.own("teardown", () => {
    loginThemePlayed = false;
    disposed = true;
    clearActivity();
    runManagerAction(() => manager.resetSessionPlayback());
    listeners.clear();
  });

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      if (scope.disposed) return () => {};
      listener(snapshot);
      listeners.add(listener);
      return scope.own("subscription", () => listeners.delete(listener));
    },

    unlock() {
      return disposed ? Promise.resolve(false) : manager.unlockFromUserGesture();
    },

    setEnabled(enabled) {
      if (!disposed) manager.setEnabled(enabled);
    },

    setVolume(volume) {
      if (!disposed) manager.setVolume(volume);
    },

    setCategoryEnabled(category, enabled) {
      if (!disposed && categorySet.has(category)) manager.setCategoryEnabled(category, enabled);
    },

    setCategoryVolume(category, volume) {
      if (!disposed && categorySet.has(category) && validVolume(volume)) {
        manager.setCategoryVolume(category, volume);
      }
    },

    serverPlayedAt(category) {
      return serverPlayed.get(category.trim()) ?? 0;
    },

    serverLoopActive(category, sound) {
      const loops = serverLoops.get(category.trim());
      if (!loops?.size) return false;
      if (sound === undefined) return true;
      const wanted = sound.trim();
      for (const looping of loops.values()) if (looping === wanted) return true;
      return false;
    },

    playLocal(category, sound, volume) {
      const normalizedCategory = category.trim();
      const normalizedSound = sound.trim();
      if (
        !categorySet.has(normalizedCategory) ||
        !validToken(normalizedSound) ||
        !validVolume(volume)
      )
        return false;
      return play(normalizedCategory as SessionAudioCategory, normalizedSound, volume);
    },

    loopLocal(category, sound, id, volume, options) {
      const normalizedCategory = category.trim();
      const normalizedSound = sound.trim();
      const normalizedId = id.trim();
      if (
        !categorySet.has(normalizedCategory) ||
        !validToken(normalizedSound) ||
        !validToken(normalizedId) ||
        !validVolume(volume) ||
        !validFade(options?.fadeInMs)
      )
        return false;
      return loop(
        normalizedCategory as SessionAudioCategory,
        normalizedSound,
        normalizedId,
        volume,
        options,
      );
    },

    stopLocal(category, id, options) {
      const normalizedCategory = category.trim();
      const normalizedId = id?.trim();
      if (
        !categorySet.has(normalizedCategory) ||
        (normalizedId !== undefined && !validToken(normalizedId)) ||
        !validFade(options?.fadeOutMs)
      )
        return false;
      return stop(normalizedCategory as SessionAudioCategory, normalizedId, options);
    },
  };
}
