<script lang="ts">
  import { onMount, untrack } from "svelte";
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

  const { createCombatStageRenderer } = combatRenderer;

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
    const playSceneSound = (cue: { sound: string; volume: number }): void => {
      if (!sceneSettings.sceneSounds) return;
      if (activeSession.audio.serverPlayedAt("combat") > 0) return;
      activeSession.audio.playLocal("combat", cue.sound, cue.volume);
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
    const renderer = createCombatStageRenderer(body, { onSound: playSceneSound });
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
          }) !== false;
        syncReadiness();
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
    // The stage of the day moves on between sky frames, so the tint is
    // checked on a slow timer as well as on every information update.
    let lastAmbienceKey = ambienceKey();
    const refreshAmbience = (): void => {
      const key = ambienceKey();
      if (key === lastAmbienceKey) return;
      lastAmbienceKey = key;
      if (lastSnapshot) render(lastSnapshot);
    };
    const unsubscribeSky = activeSession.information.subscribe(refreshAmbience);
    const ambienceTicker = window.setInterval(refreshAmbience, 30_000);
    const refreshSceneSettings = (): void => {
      sceneSettings = loadClientSettings(localStorage).settings;
      refreshAmbience();
    };
    window.addEventListener("darkflow:client-settings-changed", refreshSceneSettings);
    return () => {
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
