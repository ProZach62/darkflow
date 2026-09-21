import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const categories = [
  "combat",
  "spell",
  "skill",
  "potion",
  "quest",
  "celebration",
  "discussion",
  "alert",
  "ambient",
  "fishing",
  "ui",
  "music",
];

async function loadModules(t) {
  const server = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    hmr: false,
    watch: null,
  });
  t.after(async () => server.close());

  const ssr = server.environments.ssr;
  assert.ok(isRunnableDevEnvironment(ssr));
  const [audio, bus, diagnostics, ids, scope, events] = await Promise.all([
    ssr.runner.import("/runtime/audio.ts"),
    ssr.runner.import("/gmcp/bus.ts"),
    ssr.runner.import("/runtime/diagnostics.ts"),
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/runtime/resource-scope.ts"),
    ssr.runner.import("/runtime/event-bus.ts"),
  ]);
  return { ...audio, ...bus, ...diagnostics, ...ids, ...scope, ...events };
}

class FakeSoundManager {
  constructor({ unlocked = true } = {}) {
    this.settings = {
      enabled: true,
      volume: 0.7,
      audioUnlocked: unlocked,
      pendingCount: 0,
      categoryEnabled: Object.fromEntries(categories.map((category) => [category, true])),
      categoryVolume: Object.fromEntries(categories.map((category) => [category, 0.5])),
    };
    this.calls = [];
    this.messages = [];
    this.listeners = new Set();
    this.resetCount = 0;
  }

  getSettings() {
    return {
      ...this.settings,
      categoryEnabled: { ...this.settings.categoryEnabled },
      categoryVolume: { ...this.settings.categoryVolume },
    };
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of [...this.listeners]) listener();
  }

  async unlockFromUserGesture() {
    this.settings.audioUnlocked = true;
    this.settings.pendingCount = 0;
    this.emit();
    return true;
  }

  setEnabled(enabled) {
    this.calls.push(["setEnabled", enabled]);
    this.settings.enabled = enabled;
    this.emit();
  }

  setVolume(volume) {
    this.calls.push(["setVolume", volume]);
    this.settings.volume = Math.max(0, Math.min(1, volume));
    this.emit();
  }

  setCategoryEnabled(category, enabled) {
    this.calls.push(["setCategoryEnabled", category, enabled]);
    this.settings.categoryEnabled[category] = enabled;
    this.emit();
  }

  setCategoryVolume(category, volume) {
    this.calls.push(["setCategoryVolume", category, volume]);
    this.settings.categoryVolume[category] = volume;
    this.emit();
  }

  play(category, sound, volume) {
    this.calls.push(["play", category, sound, volume]);
    if (!this.settings.audioUnlocked) {
      this.settings.pendingCount += 1;
      this.emit();
    }
  }

  loop(category, sound, id, volume, options) {
    if (options !== undefined) (this.fadeCalls ??= []).push(["loop", id, options]);
    this.calls.push(["loop", category, sound, id, volume]);
    if (!this.settings.audioUnlocked) {
      this.settings.pendingCount += 1;
      this.emit();
    }
  }

  stop(category, id, options) {
    if (options !== undefined) (this.fadeCalls ??= []).push(["stop", id, options]);
    this.calls.push(["stop", category, id]);
  }

  handleMessage(message) {
    this.messages.push(message);
    if ((message.type === "play" || message.type === "loop") && message.category === "discussion")
      return false;
    if (message.type === "play") this.play(message.category, message.sound, message.volume);
    else if (message.type === "loop")
      this.loop(message.category, message.sound, message.id, message.volume);
    else this.stop(message.category, message.id);
    return true;
  }

  resetSessionPlayback() {
    this.resetCount += 1;
    this.settings.pendingCount = 0;
    this.emit();
  }
}

class FakeInteractions {
  constructor() {
    this.snapshot = Object.freeze({ windows: Object.freeze({}) });
    this.listeners = new Set();
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener) {
    listener(this.snapshot);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setWindows(windows) {
    this.snapshot = Object.freeze({ windows: Object.freeze({ ...windows }) });
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}

function createAudio(modules, options) {
  const sessionId = modules.createSessionId(modules.createSequentialUuidFactory());
  const diagnostics = new modules.SessionDiagnostics(sessionId);
  const scope = modules.createResourceScope(sessionId, diagnostics);
  const eventBus = modules.createSessionEventBus(sessionId, diagnostics);
  const bus = modules.createSessionGmcpBus(sessionId, () => true, diagnostics);
  const manager = new FakeSoundManager(options);
  const interactions = new FakeInteractions();
  const audio = modules.createSessionAudio(bus, scope, eventBus, interactions, manager);
  return { audio, bus, eventBus, interactions, manager, scope };
}

function connect(eventBus) {
  eventBus.publish("transport:reconnect-status", {
    status: "connected",
    attempt: 0,
    transport: "ws",
  });
}

test("audio snapshots stay frozen and mirror retained settings and locked queues", async (t) => {
  const modules = await loadModules(t);
  const { audio, bus, eventBus, manager, scope } = createAudio(modules, { unlocked: false });
  const snapshots = [];
  audio.subscribe((snapshot) => snapshots.push(snapshot));

  assert.equal(audio.getSnapshot().loggedIn, false);
  assert.deepEqual(Object.keys(audio.getSnapshot().categoryEnabled), categories);
  assert.deepEqual(Object.keys(audio.getSnapshot().categoryVolume), categories);
  assert.equal(audio.getSnapshot().categoryVolume.fishing, 0.5);
  assert.equal(Object.isFrozen(audio.getSnapshot()), true);
  assert.equal(Object.isFrozen(audio.getSnapshot().categoryEnabled), true);
  assert.equal(Object.isFrozen(audio.getSnapshot().categoryVolume), true);

  audio.setEnabled(false);
  audio.setVolume(0.25);
  audio.setCategoryEnabled("fishing", false);
  audio.setCategoryVolume("fishing", 0.35);
  audio.setCategoryVolume("unknown", 0.9);
  audio.setCategoryVolume("fishing", 2);
  audio.setCategoryEnabled("unknown", false);
  assert.deepEqual(manager.calls, [
    ["setEnabled", false],
    ["setVolume", 0.25],
    ["setCategoryEnabled", "fishing", false],
    ["setCategoryVolume", "fishing", 0.35],
  ]);
  assert.equal(audio.getSnapshot().enabled, false);
  assert.equal(audio.getSnapshot().volume, 0.25);
  assert.equal(audio.getSnapshot().categoryEnabled.fishing, false);
  assert.equal(audio.getSnapshot().categoryVolume.fishing, 0.35);

  audio.setEnabled(true);
  connect(eventBus);
  assert.equal(audio.getSnapshot().loggedIn, false);
  bus.dispatch("Char.Status", { name: "Nacho" });
  assert.equal(audio.getSnapshot().loggedIn, true);
  assert.equal(audio.playLocal("alert", "ping", 0.5), true);
  assert.equal(audio.getSnapshot().pendingCount, 1);
  assert.equal(audio.getSnapshot().audioUnlocked, false);
  assert.equal(await audio.unlock(), true);
  assert.equal(audio.getSnapshot().pendingCount, 0);
  assert.equal(audio.getSnapshot().audioUnlocked, true);
  assert.ok(snapshots.length >= 7);
  scope.dispose();
});

test("audio validates inbound directions and tracks server support and activity", async (t) => {
  const modules = await loadModules(t);
  const { audio, bus, eventBus, manager, scope } = createAudio(modules);
  const errorSpy = t.mock.method(console, "error", () => {});
  connect(eventBus);

  bus.dispatch("Core.Supports.Set", []);
  assert.equal(audio.getSnapshot().supported, false);
  bus.dispatch("Core.Supports.Add", ["Darkwind.Sound 1"]);
  assert.equal(audio.getSnapshot().supported, true);
  bus.dispatch("Darkwind.Sound", {
    type: "play",
    category: "combat",
    sound: " hit ",
    volume: 0.5,
    ignored: "extra",
  });
  bus.dispatch("Darkwind.Sound", {
    type: "loop",
    category: "ambient",
    sound: "rain",
    id: "weather",
    ignored: "extra",
  });
  bus.dispatch("Darkwind.Sound", {
    type: "loop",
    category: "ambient",
    sound: "wind",
    id: "weather",
  });
  bus.dispatch("Darkwind.Sound", {
    type: "stop",
    category: "ambient",
    sound: "",
    id: "weather",
    ignored: "extra",
  });
  assert.deepEqual(manager.calls, [
    ["play", "combat", "hit", 0.5],
    ["loop", "ambient", "rain", "weather", undefined],
    ["loop", "ambient", "wind", "weather", undefined],
    ["stop", "ambient", "weather"],
  ]);
  assert.deepEqual(manager.messages[0], {
    type: "play",
    category: "combat",
    sound: "hit",
    volume: 0.5,
  });
  assert.equal(audio.getSnapshot().currentCategory, null);
  assert.equal(audio.getSnapshot().activityKind, null);

  bus.dispatch("Darkwind.Sound", {
    type: "play",
    category: "discussion",
    sound: "tell",
  });
  bus.dispatch("Darkwind.Sound", {
    type: "loop",
    category: "discussion",
    sound: "channel",
    id: "discussion-loop",
  });
  assert.equal(manager.calls.length, 4);
  assert.equal(audio.getSnapshot().currentCategory, null);
  assert.equal(audio.getSnapshot().activityKind, null);

  bus.dispatch("Darkwind.Sound", { type: "play", category: "combat", sound: "../secret" });
  bus.dispatch("Darkwind.Sound", { type: "loop", category: "ambient", sound: "rain" });
  assert.equal(manager.calls.length, 4);
  assert.equal(errorSpy.mock.callCount(), 2);

  bus.dispatch("Core.Supports.Remove", ["Darkwind.Sound"]);
  assert.equal(audio.getSnapshot().supported, false);
  scope.dispose();
});

test("local audio requires a connection except for cleanup and accepts fishing", async (t) => {
  const modules = await loadModules(t);
  const { audio, eventBus, manager, scope } = createAudio(modules);

  assert.equal(audio.playLocal("fishing", "cast"), false);
  assert.equal(audio.loopLocal("fishing", "reel", "fishing-reel", 0.6), false);
  assert.equal(audio.stopLocal("fishing", "fishing-reel"), true);
  connect(eventBus);
  assert.equal(audio.playLocal("fishing", "cast"), true);
  assert.equal(audio.loopLocal("fishing", "reel", "fishing-reel", 0.6), true);
  assert.equal(audio.stopLocal("fishing", "fishing-reel"), true);
  assert.equal(audio.playLocal("ambient", "../secret"), false);
  assert.equal(audio.loopLocal("ambient", "rain", "../loop"), false);
  assert.deepEqual(manager.calls, [
    ["stop", "fishing", "fishing-reel"],
    ["play", "fishing", "cast", undefined],
    ["loop", "fishing", "reel", "fishing-reel", 0.6],
    ["stop", "fishing", "fishing-reel"],
  ]);

  eventBus.publish("transport:reconnect-status", {
    status: "scheduled",
    attempt: 1,
    transport: "ws",
  });
  assert.equal(audio.playLocal("fishing", "cast"), false);
  assert.equal(audio.stopLocal("fishing"), true);
  scope.dispose();
});

test("login theme plays once and continues after auth modal transitions", async (t) => {
  const modules = await loadModules(t);
  const { eventBus, interactions, manager, scope } = createAudio(modules);
  connect(eventBus);
  const authWindow = (sourceId) => ({ type: "modal", sourceId });

  interactions.setWindows({ login: authWindow("login") });
  interactions.setWindows({
    login: authWindow("login"),
    newchar: authWindow("newchar"),
  });
  assert.deepEqual(manager.calls, [
    ["play", "music", "darkwind-theme", 0.5],
  ]);

  interactions.setWindows({});
  interactions.setWindows({ charselect: authWindow("charselect") });
  assert.equal(manager.calls.length, 1);

  interactions.setWindows({});
  assert.equal(manager.calls.length, 1);
  scope.dispose();
});

test("audio preferences gate the one-shot login theme", async (t) => {
  const modules = await loadModules(t);
  const { audio, eventBus, interactions, manager, scope } = createAudio(modules);
  connect(eventBus);
  audio.setEnabled(false);
  audio.setCategoryEnabled("music", false);
  interactions.setWindows({ login: { type: "modal", sourceId: "login" } });
  assert.equal(audio.getSnapshot().currentCategory, null);

  audio.setCategoryEnabled("music", true);
  assert.equal(manager.calls.some(([type]) => type === "play"), false);

  audio.setEnabled(true);
  assert.deepEqual(manager.calls.slice(-2), [
    ["setEnabled", true],
    ["play", "music", "darkwind-theme", 0.5],
  ]);
  assert.equal(audio.getSnapshot().activityKind, "play");

  audio.setCategoryEnabled("music", false);
  audio.setCategoryEnabled("music", true);
  assert.equal(
    manager.calls.filter(([type, category]) => type === "play" && category === "music").length,
    1,
  );
  scope.dispose();
});

test("character attachment lets login audio finish naturally", async (t) => {
  const modules = await loadModules(t);
  const { audio, bus, eventBus, interactions, manager, scope } = createAudio(modules);
  const authWindow = { type: "modal", sourceId: "login" };
  connect(eventBus);

  interactions.setWindows({ login: authWindow });
  bus.dispatch("Char.Vitals", { hp: 1, maxhp: 1 });
  assert.equal(audio.getSnapshot().loggedIn, true);
  assert.deepEqual(manager.calls, [["play", "music", "darkwind-theme", 0.5]]);

  interactions.setWindows({});
  interactions.setWindows({ login: authWindow });
  bus.dispatch("Char.Status", { name: "Nacho" });
  assert.equal(manager.calls.length, 1);

  interactions.setWindows({});
  interactions.setWindows({ login: authWindow });
  bus.dispatch("Darkwind.Session.Recovered", { mode: "linkdead" });
  assert.equal(manager.calls.length, 1);

  scope.dispose();
  assert.equal(interactions.listeners.size, 0);
});

test("early character status does not suppress the later login theme", async (t) => {
  const modules = await loadModules(t);
  const { bus, eventBus, interactions, manager, scope } = createAudio(modules);
  connect(eventBus);

  bus.dispatch("Char.Status", { name: "Nacho" });
  interactions.setWindows({ login: { type: "modal", sourceId: "login" } });

  assert.deepEqual(manager.calls, [["play", "music", "darkwind-theme", 0.5]]);
  scope.dispose();
});

test("disconnect and disposal reset once per lifecycle and isolate sessions", async (t) => {
  const modules = await loadModules(t);
  const first = createAudio(modules);
  const second = createAudio(modules);
  const snapshots = [];
  first.audio.subscribe((snapshot) => snapshots.push(snapshot));

  first.eventBus.publish("transport:reconnect-status", {
    status: "connecting",
    attempt: 0,
    transport: "ws",
  });
  first.eventBus.publish("transport:reconnect-status", {
    status: "scheduled",
    attempt: 1,
    transport: "ws",
  });
  assert.equal(first.manager.resetCount, 1);
  assert.equal(second.manager.resetCount, 0);

  connect(first.eventBus);
  first.bus.dispatch("Core.Supports.Set", ["Darkwind.Sound 1"]);
  first.bus.dispatch("Darkwind.Sound", {
    type: "loop",
    category: "ambient",
    sound: "rain",
    id: "weather",
  });
  first.eventBus.publish("transport:reconnect-status", {
    status: "scheduled",
    attempt: 1,
    transport: "ws",
  });
  first.eventBus.publish("transport:reconnect-status", {
    status: "idle",
    attempt: 1,
    transport: "ws",
  });
  assert.equal(first.manager.resetCount, 2);
  assert.equal(first.audio.getSnapshot().connected, false);
  assert.equal(first.audio.getSnapshot().loggedIn, false);
  assert.equal(first.audio.getSnapshot().supported, false);
  assert.equal(first.audio.getSnapshot().currentCategory, null);

  first.bus.dispatch("Core.Supports.Set", []);
  connect(first.eventBus);
  assert.equal(first.audio.getSnapshot().connected, true);
  assert.equal(first.audio.getSnapshot().supported, false);

  const snapshotCount = snapshots.length;
  first.scope.dispose();
  first.scope.dispose();
  assert.equal(first.manager.resetCount, 3);
  first.bus.dispatch("Darkwind.Sound", { type: "play", category: "combat", sound: "hit" });
  first.eventBus.publish("transport:reconnect-status", {
    status: "connected",
    attempt: 0,
    transport: "ws",
  });
  first.manager.emit();
  assert.equal(first.manager.calls.length, 1);
  assert.equal(first.manager.listeners.size, 0);
  assert.equal(snapshots.length, snapshotCount);
  assert.equal(second.audio.getSnapshot().connected, false);

  second.scope.dispose();
  assert.equal(second.manager.resetCount, 1);
});

test("server-played sounds are remembered per category until the connection drops", async (t) => {
  const modules = await loadModules(t);
  const { audio, bus, eventBus, scope } = createAudio(modules);
  connect(eventBus);
  bus.dispatch("Core.Supports.Add", ["Darkwind.Sound 1"]);

  assert.equal(audio.serverPlayedAt("combat"), 0, "nothing played yet");
  assert.equal(audio.playLocal("combat", "hit"), true);
  assert.equal(audio.serverPlayedAt("combat"), 0, "a local sound is not the server's");

  bus.dispatch("Darkwind.Sound", { type: "play", category: "combat", sound: "hit" });
  assert.ok(audio.serverPlayedAt("combat") > 0);
  assert.ok(audio.serverPlayedAt(" combat ") > 0, "the category is trimmed");
  assert.equal(audio.serverPlayedAt("spell"), 0, "other categories are untouched");
  bus.dispatch("Darkwind.Sound", { type: "loop", category: "ambient", sound: "rain", id: "weather" });
  assert.equal(audio.serverPlayedAt("ambient"), 0, "a loop is not a one-shot");

  eventBus.publish("transport:reconnect-status", { status: "scheduled", attempt: 1, transport: "ws" });
  assert.equal(audio.serverPlayedAt("combat"), 0, "a dropped connection forgets");
  scope.dispose();
});

test("the server's own loops are tracked by category and sound until stopped or disconnected", async (t) => {
  const modules = await loadModules(t);
  const { audio, bus, eventBus, scope } = createAudio(modules);
  connect(eventBus);
  bus.dispatch("Core.Supports.Add", ["Darkwind.Sound 1"]);

  assert.equal(audio.serverLoopActive("ambient"), false);
  assert.equal(audio.loopLocal("music", "boss-battle", "scene-boss-music", 0.6), true);
  assert.equal(audio.serverLoopActive("music"), false, "a local loop is not the server's");

  bus.dispatch("Darkwind.Sound", { type: "loop", category: "ambient", sound: "rain", id: "weather" });
  assert.equal(audio.serverLoopActive("ambient"), true);
  assert.equal(audio.serverLoopActive(" ambient "), true, "the category is trimmed");
  assert.equal(audio.serverLoopActive("ambient", "combat-music"), false, "rain is not combat music");
  assert.equal(audio.serverLoopActive("combat"), false, "other categories are untouched");

  bus.dispatch("Darkwind.Sound", { type: "loop", category: "ambient", sound: "combat-music", id: "fight" });
  assert.equal(audio.serverLoopActive("ambient", "combat-music"), true);
  assert.equal(audio.serverLoopActive("ambient", " combat-music "), true, "the sound is trimmed");
  bus.dispatch("Darkwind.Sound", { type: "stop", category: "ambient", sound: "", id: "fight" });
  assert.equal(audio.serverLoopActive("ambient", "combat-music"), false, "stopped by id");
  assert.equal(audio.serverLoopActive("ambient"), true, "the rain is still looping");
  bus.dispatch("Darkwind.Sound", { type: "stop", category: "ambient", sound: "" });
  assert.equal(audio.serverLoopActive("ambient"), false, "a stop without an id clears the category");
  bus.dispatch("Darkwind.Sound", { type: "loop", category: "music", sound: "darkwind-theme", id: "x" });
  assert.equal(audio.serverLoopActive("music"), false, "the server may not send the music category");

  bus.dispatch("Darkwind.Sound", { type: "loop", category: "ambient", sound: "combat-music", id: "fight" });
  eventBus.publish("transport:reconnect-status", { status: "scheduled", attempt: 1, transport: "ws" });
  assert.equal(audio.serverLoopActive("ambient", "combat-music"), false, "a dropped connection forgets");
  scope.dispose();
});

test("local loops carry their fades to the manager, and a fade that makes no sense is refused", async (t) => {
  const modules = await loadModules(t);
  const { audio, eventBus, manager, scope } = createAudio(modules);
  connect(eventBus);

  assert.equal(audio.loopLocal("music", "boss-battle", "scene-boss-music", 0.6, { fadeInMs: 1500 }), true);
  assert.equal(audio.stopLocal("music", "scene-boss-music", { fadeOutMs: 2500 }), true);
  assert.deepEqual(manager.fadeCalls, [
    ["loop", "scene-boss-music", { fadeInMs: 1500 }],
    ["stop", "scene-boss-music", { fadeOutMs: 2500 }],
  ]);

  const before = manager.calls.length;
  assert.equal(audio.loopLocal("music", "boss-battle", "scene-boss-music", 0.6, { fadeInMs: -1 }), false);
  assert.equal(audio.loopLocal("music", "boss-battle", "scene-boss-music", 0.6, { fadeInMs: 60_000 }), false);
  assert.equal(audio.stopLocal("music", "scene-boss-music", { fadeOutMs: Number.NaN }), false);
  assert.equal(manager.calls.length, before, "nothing reached the manager");
  scope.dispose();
});
