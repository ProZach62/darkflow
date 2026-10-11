<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { Readable } from "svelte/store";
  import type { SessionCombatSnapshot } from "../runtime/combat.ts";
  import type { Session } from "../runtime/session.ts";
  import type { SessionWorldSnapshot } from "../runtime/world.ts";
  import type { PanelState } from "./workspace.ts";
  import { loadClientSettings } from "../app/client-settings.ts";
  // @ts-expect-error The shared sky clock is legacy-compatible JavaScript.
  import { skyCurrentState } from "../../public/js/core-information-panel-renderers.mjs";
  // @ts-expect-error The canvas combat stage is retained JavaScript without a declaration file.
  import * as combatRenderer from "../../public/js/combat-stage-renderer.mjs";
  // @ts-expect-error The stage's pure helpers are retained JavaScript without a declaration file.
  import * as combatStageCore from "../../public/js/combat-stage-core.mjs";

  const { createCombatStageRenderer } = combatRenderer;
  const {
    BOSS_MUSIC_FADE_IN_MS,
    BOSS_MUSIC_FADE_OUT_MS,
    BOSS_TRACKS,
    MAX_BOSS_SIGHTINGS,
    bossKey,
    bossSightings,
    hasBossTag,
    matchesBossSighting,
    partyAllies,
    pickBossTrack,
    summarizeAuras,
  } = combatStageCore;

  const BOSS_MUSIC_ID = "scene-boss-music";

  let {
    panelId,
    state: _state,
    session,
  }: { panelId: string; state: Readable<PanelState>; session?: Session } = $props();

  const resolvedSession = untrack(() => session);
  if (!resolvedSession) throw new Error("Combat panels require a session");
  const activeSession: Session = resolvedSession;
  let root: HTMLElement;
  let body: HTMLElement;

  function roomId(world: SessionWorldSnapshot): string {
    const id = world.room?.num ?? world.room?.id;
    return id === undefined || id === null ? "" : String(id);
  }

  // The room's art, only while it belongs to the room the player is in; a
  // stale image from the previous room must not become this fight's backdrop.
  function roomImageUrl(world: SessionWorldSnapshot): string {
    const art = world.roomImage;
    if (!world.connected || !art) return "";
    const id = roomId(world);
    return id && art.roomId === id && art.generation === world.roomGeneration ? art.url : "";
  }

  function backdropKey(world: SessionWorldSnapshot): string {
    return String(world.roomGeneration) + ":" + roomImageUrl(world);
  }

  onMount(() => {
    let sceneSettings = loadClientSettings(localStorage).settings;
    // The game may score fights itself. Once it has played a combat sound on
    // this connection, the Scene leaves that to it.
    const playSceneSound = (cue: { category?: string; sound: string; volume: number }): void => {
      if (!sceneSettings.sceneSounds) return;
      const category = cue.category ?? "combat";
      if (activeSession.audio.serverPlayedAt(category) > 0) return;
      activeSession.audio.playLocal(category, cue.sound, cue.volume);
    };
    // The sky's stage and moonlight, for the Scene's day and night tint.
    const ambienceInput = (): { stage: string; moonLight: number } | null => {
      if (!sceneSettings.sceneDayNight) return null;
      const sky = activeSession.information.getSnapshot().sky;
      if (!sky) return null;
      return {
        stage: String(skyCurrentState(sky).stage),
        moonLight: Number(sky.moon_light) || 0,
      };
    };
    const ambienceKey = (): string => {
      const ambience = ambienceInput();
      return ambience ? ambience.stage + ":" + ambience.moonLight : "";
    };
    // Party members who are in the room stand behind the player.
    const alliesInput = (): Array<{ name: string; leader: boolean; hpPct: number | null }> => {
      const information = activeSession.information.getSnapshot();
      return partyAllies(information.group, information.status?.name ?? "");
    };
    // When each defence entry was first seen, so its countdown can be followed
    // without the server resending it. Entries are replaced, never mutated.
    const defenceSeenAt = new WeakMap<object, number>();
    const aurasInput = (): { buffs: number; debuffs: number; expiring: boolean; key: string } => {
      const now = Date.now();
      const defences = activeSession.information.getSnapshot().defences;
      for (const item of defences) if (!defenceSeenAt.has(item)) defenceSeenAt.set(item, now);
      return summarizeAuras(defences, (item: object) => defenceSeenAt.get(item) ?? now, now);
    };
    // What the player dealt, from the DPS meter, so the end-of-fight summary
    // never disagrees with the DPS panel.
    const dpsInput = (): Record<string, unknown> | null => {
      const dps = activeSession.dps.getSnapshot();
      if (!dps.hasData) return null;
      return { ...dps.encounter, missingDamageNumbers: dps.missingDamageNumbers };
    };
    const dpsKey = (): string => {
      const dps = activeSession.dps.getSnapshot();
      return [dps.active ? 1 : 0, dps.encounter.swings, dps.encounter.damage].join(":");
    };
    // Everything the Scene shows beyond the fight itself, as one comparable key.
    const sceneKey = (): string =>
      ambienceKey() +
      "|" +
      alliesInput()
        .map(
          (ally) =>
            ally.name +
            (ally.leader ? "*" : "") +
            ":" +
            (ally.hpPct === null ? "" : Math.round(ally.hpPct / 5)),
        )
        .join(",") +
      "|" +
      aurasInput().key +
      "|" +
      dpsKey();
    // The game tags its bosses with "(BOSS)" in the name. These are the
    // untagged enemies this character has starred as bosses too, by bossKey.
    const bossStorageKey = "darkflow-scene-bosses:" + activeSession.characterProfileId;
    const bosses = new SvelteSet<string>();
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(bossStorageKey) ?? "null");
      const names = (stored as { names?: unknown } | null)?.names;
      if (Array.isArray(names)) {
        for (const name of names) if (typeof name === "string" && name) bosses.add(name);
      }
    } catch {
      // A damaged list is an empty list.
    }
    // The name the Scene shows: Char.Enemy's, or the roster's for a fight
    // the player is watching.
    const enemyName = (snapshot: SessionCombatSnapshot | null): string => {
      const named = String(snapshot?.enemy?.enemy_name ?? "").trim();
      if (named || !snapshot) return named;
      const target = snapshot.model.actors.find(
        (actor) => actor.id === snapshot.model.currentTargetId,
      );
      return target?.name ?? "";
    };
    // Char.Enemy and the roster carry a boss's plain name; the tag is only in
    // the game text. These are the names seen wearing it this session.
    const sightings = new SvelteSet<string>();
    const isTagged = (snapshot: SessionCombatSnapshot | null): boolean => {
      const name = enemyName(snapshot);
      return hasBossTag(name) || matchesBossSighting(name, sightings);
    };
    const isBoss = (snapshot: SessionCombatSnapshot | null): boolean =>
      isTagged(snapshot) || bosses.has(bossKey(enemyName(snapshot)));
    // The boss track loops while a presented fight is on against a starred
    // enemy, and gives way to music the game plays itself.
    let bossMusicPlaying = false;
    // One track a fight: music the game interrupts comes back as the same
    // piece, and the next fight takes a different one.
    let bossTrack = "";
    let bossTrackEncounter = "";
    // Starting or stopping the loop makes the audio runtime publish, and the
    // audio subscription below calls back in here before the flag is set.
    let syncingBossMusic = false;
    const syncBossMusic = (): void => {
      if (syncingBossMusic) return;
      const snapshot = lastSnapshot;
      const want =
        sceneSettings.sceneBossMusic &&
        !!snapshot &&
        snapshot.shouldPresent &&
        snapshot.model.active &&
        isBoss(snapshot) &&
        // The server has no music category; its combat music is this loop.
        !activeSession.audio.serverLoopActive("ambient", "combat-music");
      syncingBossMusic = true;
      try {
        if (want && !bossMusicPlaying) {
          const encounter = snapshot.model.encounterId;
          if (!bossTrack || encounter !== bossTrackEncounter) {
            bossTrack = pickBossTrack(BOSS_TRACKS, bossTrack) as string;
            bossTrackEncounter = encounter;
          }
          bossMusicPlaying =
            !!bossTrack &&
            activeSession.audio.loopLocal("music", bossTrack, BOSS_MUSIC_ID, 0.6, {
              fadeInMs: BOSS_MUSIC_FADE_IN_MS,
            });
        } else if (!want && bossMusicPlaying) {
          bossMusicPlaying = false;
          activeSession.audio.stopLocal("music", BOSS_MUSIC_ID, {
            fadeOutMs: BOSS_MUSIC_FADE_OUT_MS,
          });
        }
      } finally {
        syncingBossMusic = false;
      }
    };
    const toggleBoss = (): void => {
      const key = bossKey(enemyName(lastSnapshot));
      if (!key) return;
      if (!bosses.delete(key)) bosses.add(key);
      try {
        localStorage.setItem(
          bossStorageKey,
          JSON.stringify({ version: 1, names: [...bosses].sort() }),
        );
      } catch {
        // The mark still holds for this session.
      }
      if (lastSnapshot) render(lastSnapshot);
    };
    const renderer = createCombatStageRenderer(body, {
      onSound: playSceneSound,
      onToggleBoss: toggleBoss,
    });
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = (): void => {
      activeSession.combat.setReducedMotion(motionQuery.matches);
    };
    let renderSucceeded = false;
    let shouldPresent = false;

    const reportReady = (ready: boolean): void => {
      if (activeSession.combat.getSnapshot().presentationReady === ready) return;
      activeSession.combat.setPresentationReady(ready);
    };

    const syncReadiness = (): void => {
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      reportReady(
        renderSucceeded &&
          shouldPresent &&
          root.isConnected &&
          bounds.width > 0 &&
          bounds.height > 0,
      );
    };

    let lastSnapshot: SessionCombatSnapshot | null = null;
    const render = (snapshot: SessionCombatSnapshot): void => {
      lastSnapshot = snapshot;
      shouldPresent = snapshot.shouldPresent;
      const world = activeSession.world.getSnapshot();
      try {
        renderSucceeded =
          renderer.render({
            model: snapshot.model,
            enemy: snapshot.enemy,
            vitals: snapshot.vitals,
            avatar: snapshot.avatar,
            status: snapshot.status,
            inventory: snapshot.inventory,
            // Off while the server has visual combat disabled or the player
            // dismissed this encounter: the stage then shows the room scene
            // instead of the fight.
            present: snapshot.shouldPresent,
            // The stage paints the room's image as the backdrop when one is
            // showing, and the terrain tile otherwise.
            room: world.room,
            roomImage: roomImageUrl(world),
            // Other players in the room, drawn as bystanders on the idle scene.
            players: world.players,
            ambience: ambienceInput(),
            allies: alliesInput(),
            auras: aurasInput(),
            dps: dpsInput(),
            boss: {
              tagged: isTagged(snapshot),
              canMark: true,
              marked: bosses.has(bossKey(enemyName(snapshot))),
            },
          }) !== false;
        syncReadiness();
        syncBossMusic();
      } catch (error) {
        renderSucceeded = false;
        reportReady(false);
        console.error("Combat renderer failed", error);
      }
    };

    syncReducedMotion();
    motionQuery.addEventListener("change", syncReducedMotion);
    window.addEventListener("darkflow:workspace-layout-changed", syncReadiness);
    const sizeObserver = new ResizeObserver(syncReadiness);
    sizeObserver.observe(root);
    const unsubscribe = activeSession.combat.subscribe(render);
    // Looks and walks from the activity feed play on the idle scene. The
    // subscription replays the current snapshot on attach, which is skipped
    // so a remounted panel does not re-enact an old walk.
    let seenActivitySeq = activeSession.activity.getSnapshot().seq;
    const unsubscribeActivity = activeSession.activity.subscribe((activity) => {
      if (activity.seq === seenActivitySeq || !activity.latest) return;
      seenActivitySeq = activity.seq;
      renderer.playActivity(activity.latest);
    });
    const worldKey = (world: SessionWorldSnapshot): string =>
      backdropKey(world) + "|" + world.players.map((player) => player.name).join(",");
    let lastBackdropKey = worldKey(activeSession.world.getSnapshot());
    const unsubscribeWorld = activeSession.world.subscribe((world) => {
      const key = worldKey(world);
      if (key === lastBackdropKey) return;
      lastBackdropKey = key;
      if (lastSnapshot) render(lastSnapshot);
    });
    // The time of day moves on between sky frames and a buff's last seconds
    // arrive without any message, so the Scene's extras are checked once a
    // second as well as on every information update.
    let lastAmbienceKey = sceneKey();
    const refreshAmbience = (): void => {
      const key = sceneKey();
      if (key === lastAmbienceKey) return;
      lastAmbienceKey = key;
      if (lastSnapshot) render(lastSnapshot);
    };
    const unsubscribeSky = activeSession.information.subscribe(refreshAmbience);
    const ambienceTicker = window.setInterval(refreshAmbience, 1_000);
    const refreshSceneSettings = (): void => {
      sceneSettings = loadClientSettings(localStorage).settings;
      refreshAmbience();
      syncBossMusic();
    };
    window.addEventListener("darkflow:client-settings-changed", refreshSceneSettings);
    // Read the boss tag off the game text. Subscribing replays the scrollback,
    // so a boss announced before the Scene opened still counts.
    const noteSightings = (text: string): boolean => {
      let added = false;
      for (const name of bossSightings(text) as string[]) {
        const key = bossKey(name);
        if (!key || sightings.has(key)) continue;
        if (sightings.size >= MAX_BOSS_SIGHTINGS) {
          const oldest = sightings.values().next().value;
          if (oldest !== undefined) sightings.delete(oldest);
        }
        sightings.add(key);
        added = true;
      }
      return added;
    };
    const unsubscribeBossText = activeSession.terminal.subscribeOutput((event) => {
      let added = false;
      if (event.type === "reset") {
        for (const record of event.records)
          if (record.complete) added = noteSightings(record.text) || added;
      } else if (event.type === "upsert" && event.record.complete) {
        added = noteSightings(event.record.text);
      }
      if (added && lastSnapshot) render(lastSnapshot);
    });
    // The game starting or stopping its own music changes whether ours may play.
    const unsubscribeAudio = activeSession.audio.subscribe(syncBossMusic);
    // The DPS meter closes out a fight on its own clock; pick its figures up
    // as soon as they settle rather than on the next tick.
    const unsubscribeDps = activeSession.dps.subscribe(refreshAmbience);
    return () => {
      unsubscribeAudio();
      unsubscribeBossText();
      unsubscribeDps();
      if (bossMusicPlaying) {
        activeSession.audio.stopLocal("music", BOSS_MUSIC_ID, { fadeOutMs: 800 });
      }
      unsubscribeSky();
      window.clearInterval(ambienceTicker);
      window.removeEventListener("darkflow:client-settings-changed", refreshSceneSettings);
      unsubscribe();
      unsubscribeActivity();
      unsubscribeWorld();
      sizeObserver.disconnect();
      motionQuery.removeEventListener("change", syncReducedMotion);
      window.removeEventListener("darkflow:workspace-layout-changed", syncReadiness);
      reportReady(false);
      renderer.dispose();
    };
  });
</script>

<section
  bind:this={root}
  class="combat-panel"
  data-panel-id={panelId}
  data-workspace-owned="true"
  data-tutorial-target="enemy-panel"
  aria-label="Combat"
>
  <div bind:this={body}></div>
</section>
