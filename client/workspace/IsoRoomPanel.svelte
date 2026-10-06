<script lang="ts">
  import { untrack } from "svelte";
  import type { DarkwindRoomOccupant } from "../gmcp/contracts/world.ts";
  import type { RoomInfo } from "../gmcp/contracts/room.ts";
  import type { SceneActivity } from "../runtime/activity.ts";
  import type { Session } from "../runtime/session.ts";
  import type { SessionWorldSnapshot } from "../runtime/world.ts";
  // @ts-expect-error Retained room-scene helpers are JavaScript without declarations.
  import * as roomSceneCore from "../../public/js/room-scene-core.mjs";

  const {
    roomSceneBuildingPosition,
    roomSceneBuildingSprite,
    roomSceneAtmosphere,
    roomSceneDetails,
    roomSceneDoorSprite,
    roomSceneExitKind,
    roomSceneExitPosition,
    roomSceneOccupantPosition,
    roomSceneOccupantSprite,
    roomScenePropSprite,
    roomSceneTargetMatches,
    roomSceneTargetCommand,
    roomSceneTargetPosition,
    roomSceneTargets,
    roomSceneTerrain,
    roomSceneTexture,
    roomSceneWeaponSprite,
  } = roomSceneCore;

  interface SceneOccupant {
    id: string;
    name: string;
    kind: "self" | "player" | "npc" | "pet";
    race?: string;
    family?: string;
    gender?: string;
    size?: string;
    hostile?: boolean;
    elite?: boolean;
    boss?: boolean;
    fighting?: boolean;
    level?: number;
    role?: string;
    activity?: string;
    anchor_id?: string;
    weapon?: string;
    weaponSprite?: string | null;
    shield?: boolean;
    helmet?: string;
    armor?: string;
    faction?: string;
    cue?: string;
    engaged_with?: string;
    condition?: string;
  }

  interface SceneExit {
    direction: string;
    label: string;
    x: number;
    y: number;
    door: string | null;
    blocked: boolean;
    kind: string;
  }

  interface SceneBuilding {
    detail: string;
    sprite: string;
    x: number;
    y: number;
  }

  interface SceneTarget {
    id: string;
    name: string;
    nouns: string[];
    kind?: string;
    sprite?: string;
    state?: string;
    category?: string;
    cue?: string;
    verbs: string[];
    propSprite: string | null;
    x: number;
    y: number;
  }

  interface ScenePosition {
    x: number;
    y: number;
  }

  let { panelId, session }: { panelId: string; session?: Session } = $props();

  const resolvedSession = untrack(() => session);
  if (!resolvedSession) throw new Error("Isometric Room requires a session");
  const activeSession: Session = resolvedSession;

  let snapshot = $state<SessionWorldSnapshot>(activeSession.world.getSnapshot());
  const room = $derived(snapshot.room);
  const environment = $derived(
    String(room?.environment ?? room?.terrain ?? room?.env ?? "outside"),
  );
  const terrain = $derived(String(roomSceneTerrain(environment)));
  const texture = $derived(String(roomSceneTexture(environment)));
  const details = $derived.by(() =>
    snapshot.occupantsDark || snapshot.occupantsUnavailable
      ? []
      : roomSceneDetails(room?.details).map(String),
  );
  const buildings = $derived.by(() => sceneBuildings(details));
  const targets = $derived.by(() =>
    snapshot.occupantsDark || snapshot.occupantsUnavailable ? [] : sceneTargets(room),
  );
  const occupants = $derived.by(() => sceneOccupants(snapshot));
  const occupantsOverflow = $derived(
    snapshot.occupantsMore + Math.max(0, snapshot.occupants.length - occupants.length),
  );
  const exits = $derived.by(() => (snapshot.occupantsDark ? [] : sceneExits(room)));
  const atmosphere = $derived(
    roomSceneAtmosphere(room?.scene) as {
      time: string;
      weather: string;
      lighting: string;
    },
  );
  const combatActive = $derived(occupants.some((occupant) => occupant.fighting));
  let playerTarget = $state<(ScenePosition & { id: string }) | null>(null);
  let selectedTargetId = $state("");
  const selectedTarget = $derived(targets.find((target) => target.id === selectedTargetId) ?? null);
  let lastActivitySeq = untrack(() => activeSession.activity.getSnapshot().seq);
  let returnTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => activeSession.world.subscribe((next) => (snapshot = next)));
  $effect(() =>
    activeSession.activity.subscribe((next) => {
      if (!next.latest || next.seq <= lastActivitySeq) return;
      lastActivitySeq = next.seq;
      animatePlayerTo(next.latest);
    }),
  );
  $effect(() => {
    snapshot.roomGeneration;
    playerTarget = null;
    selectedTargetId = "";
    clearTimeout(returnTimer);
    return () => clearTimeout(returnTimer);
  });

  function sceneBuildings(values: string[]): SceneBuilding[] {
    return values
      .map((detail) => ({ detail, sprite: roomSceneBuildingSprite(detail) as string | null }))
      .filter((entry): entry is { detail: string; sprite: string } => Boolean(entry.sprite))
      .slice(0, 3)
      .map((entry, index) => ({ ...entry, ...roomSceneBuildingPosition(index) }));
  }

  function sceneTargets(value: RoomInfo | null): SceneTarget[] {
    return (
      roomSceneTargets(value?.looks, value?.details) as Omit<
        SceneTarget,
        "propSprite" | "x" | "y"
      >[]
    ).map((target, index) => ({
      ...target,
      propSprite: roomScenePropSprite(target) as string | null,
      ...(roomSceneTargetPosition(index, target) as ScenePosition),
    }));
  }

  function animatePlayerTo(activity: SceneActivity): void {
    if (activity.kind !== "look" || !activity.target) return;
    const target = targets.find((candidate) => roomSceneTargetMatches(candidate, activity.target));
    let destination: ScenePosition | undefined = target;
    let targetId = target?.id;
    if (!destination) {
      const occupantIndex = occupants.findIndex((occupant) =>
        roomSceneTargetMatches(
          { id: occupant.id, name: occupant.name, nouns: [occupant.name] },
          activity.target,
        ),
      );
      if (occupantIndex >= 0) {
        const occupant = occupants[occupantIndex];
        if (!occupant) return;
        destination = roomSceneOccupantPosition(occupantIndex, occupant, targets) as ScenePosition;
        targetId = occupant.id;
      }
    }
    if (!destination || !targetId) return;
    movePlayerTo(targetId, destination);
  }

  function movePlayerTo(targetId: string, destination: ScenePosition): void {
    clearTimeout(returnTimer);
    playerTarget = { id: targetId, x: destination.x, y: destination.y + 3 };
    returnTimer = setTimeout(() => (playerTarget = null), 1800);
  }

  function targetVerbs(target: SceneTarget): string[] {
    return ["look", ...(target.verbs ?? []).filter((verb) => verb !== "look")];
  }

  function sendTargetAction(target: SceneTarget, verb: string): void {
    const command = roomSceneTargetCommand(target, verb) as string;
    if (!command) return;
    selectedTargetId = target.id;
    movePlayerTo(target.id, target);
    activeSession.terminal.sendCommand(command);
  }

  function sceneOccupants(value: SessionWorldSnapshot): SceneOccupant[] {
    if (value.occupantsDark) return [];
    if (value.occupantsAuthoritative) {
      return value.occupants.slice(0, 8).map(normalizeOccupant).sort(occupantOrder);
    }
    const status = activeSession.information.getSnapshot().status as {
      name?: unknown;
      fullname?: unknown;
      race?: unknown;
      gender?: unknown;
    } | null;
    const selfName = String(status?.name || status?.fullname || "You");
    const foldedSelf = selfName.toLocaleLowerCase();
    return [
      {
        id: "self",
        name: selfName,
        kind: "self",
        ...(status?.race ? { race: String(status.race) } : {}),
        ...(status?.gender ? { gender: String(status.gender) } : {}),
      },
      ...value.players
        .filter((player) => player.name.toLocaleLowerCase() !== foldedSelf)
        .slice(0, 7)
        .map((player) => ({
          id: `player:${player.name}`,
          name: player.fullname || player.name,
          kind: "player" as const,
        })),
    ];
  }

  function normalizeOccupant(occupant: DarkwindRoomOccupant): SceneOccupant {
    const appearance = occupant.appearance ?? {};
    const equipment = occupant.equipment ?? {};
    return {
      id: occupant.id,
      name: occupant.name,
      kind: occupant.kind,
      ...(appearance.race || occupant.race ? { race: appearance.race || occupant.race } : {}),
      ...(appearance.family || occupant.family
        ? { family: appearance.family || occupant.family }
        : {}),
      ...(appearance.gender || occupant.gender
        ? { gender: appearance.gender || occupant.gender }
        : {}),
      ...(appearance.size || occupant.size ? { size: appearance.size || occupant.size } : {}),
      hostile: occupant.hostile === true || occupant.hostile === 1,
      elite: occupant.elite === true || occupant.elite === 1 || !!occupant.public_state?.elite,
      boss: occupant.boss === true || occupant.boss === 1 || !!occupant.public_state?.boss,
      fighting: occupant.fighting === true || occupant.fighting === 1,
      ...(typeof occupant.level === "number" ? { level: occupant.level } : {}),
      ...(occupant.role ? { role: occupant.role } : {}),
      ...(occupant.activity ? { activity: sceneToken(occupant.activity) } : {}),
      ...(occupant.anchor_id ? { anchor_id: occupant.anchor_id } : {}),
      ...(equipment.main_hand || occupant.weapon
        ? { weapon: equipment.main_hand || occupant.weapon }
        : {}),
      weaponSprite: roomSceneWeaponSprite(equipment.main_hand || occupant.weapon) as string | null,
      shield: Boolean(equipment.shield) || occupant.shield === true || occupant.shield === 1,
      ...(equipment.helmet || occupant.helmet
        ? { helmet: equipment.helmet || occupant.helmet }
        : {}),
      ...(equipment.armor || occupant.armor ? { armor: equipment.armor || occupant.armor } : {}),
      ...(occupant.faction ? { faction: occupant.faction } : {}),
      ...(occupant.cue ? { cue: sceneToken(occupant.cue) } : {}),
      ...(occupant.engaged_with ? { engaged_with: occupant.engaged_with } : {}),
      ...(occupant.public_state?.condition ? { condition: occupant.public_state.condition } : {}),
    };
  }

  function occupantOrder(left: SceneOccupant, right: SceneOccupant): number {
    const rank = { self: 0, player: 1, pet: 2, npc: 3 };
    return rank[left.kind] - rank[right.kind] || left.name.localeCompare(right.name);
  }

  function roomExits(value: RoomInfo | null): Record<string, string | number> {
    return value?.exits && typeof value.exits === "object" ? value.exits : {};
  }

  function sceneExits(value: RoomInfo | null): SceneExit[] {
    const roomDirections = roomExits(value);
    const roomDoors = value?.exit_states ?? {};
    const roomExitDetails = value?.exit_details ?? {};
    const directions = new Set(Object.keys(roomDirections));
    return [...directions]
      .map((direction) => {
        const position = roomSceneExitPosition(direction) as {
          x: number;
          y: number;
          label: string;
        } | null;
        if (!position) return null;
        const rawDoor = roomDoors[direction];
        return {
          direction,
          ...position,
          label: roomExitDetails[direction]?.label || position.label,
          door: roomSceneDoorSprite(rawDoor) as string | null,
          kind: roomSceneExitKind(direction, roomExitDetails[direction]) as string,
          blocked:
            Number(rawDoor) > 1 ||
            /closed|locked/i.test(String(rawDoor === undefined ? "" : rawDoor)),
        };
      })
      .filter((exit): exit is SceneExit => Boolean(exit));
  }

  function occupantLabel(occupant: SceneOccupant): string {
    const parts = [occupant.name];
    if (occupant.level !== undefined) parts.push(`level ${occupant.level}`);
    if (occupant.boss) parts.push("boss");
    else if (occupant.elite) parts.push("elite");
    if (occupant.hostile) parts.push("hostile");
    if (occupant.role) parts.push(occupant.role);
    if (occupant.activity) parts.push(occupant.activity);
    if (occupant.weapon) parts.push(`wielding ${occupant.weapon}`);
    if (occupant.condition) parts.push(occupant.condition);
    return parts.join(", ");
  }

  function sceneToken(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 24);
  }

  function detailLabel(detail: string): string {
    return detail
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
</script>

<section
  class={`iso-room-panel terrain-${terrain}`}
  data-panel-id={panelId}
  data-room-terrain={terrain}
  data-room-occupants={occupants.length}
  data-room-buildings={buildings.length}
  data-room-targets={targets.length}
  data-player-target={playerTarget?.id ?? ""}
  data-room-weather={atmosphere.weather}
  data-room-time={atmosphere.time}
  data-room-lighting={atmosphere.lighting}
  data-room-combat={combatActive}
  data-workspace-owned="true"
>
  {#if room?.name}
    <header>
      <div>
        <h2>{room.name}</h2>
        <p>{room.area || "Unknown area"}</p>
      </div>
      <div class="scene-labels">
        <span class="terrain-label">{detailLabel(terrain)}</span>
        {#if atmosphere.weather !== "clear"}
          <span class="terrain-label">{detailLabel(atmosphere.weather)}</span>
        {/if}
        {#if atmosphere.time !== "day"}
          <span class="terrain-label">{detailLabel(atmosphere.time)}</span>
        {/if}
      </div>
    </header>

    {#key snapshot.roomGeneration}
      <div
        class={`room-stage time-${atmosphere.time} lighting-${atmosphere.lighting}`}
        class:in-combat={combatActive}
        aria-label={`Isometric view of ${room.name}`}
      >
        <div class="stage-haze"></div>
        <img
          class="room-floor"
          src={`/assets/iso/rooms/${texture}.webp`}
          alt=""
          draggable="false"
        />
        <div class="living-surface" aria-hidden="true"></div>
        <div class={`weather-layer weather-${atmosphere.weather}`} aria-hidden="true">
          {#each Array(12) as _, index (index)}<i style={`--particle:${index}`}></i>{/each}
        </div>
        {#if combatActive}<div class="combat-clash" aria-hidden="true"><span>VS</span></div>{/if}

        {#each buildings as building (building.detail)}
          <div
            class="building"
            style={`--x:${building.x}%;--y:${building.y}%`}
            title={detailLabel(building.detail)}
          >
            <img
              src={`/assets/iso/buildings/${building.sprite}.webp`}
              alt={detailLabel(building.detail)}
              draggable="false"
            />
          </div>
        {/each}

        {#each targets as target (target.id)}
          <button
            class={`room-target state-${target.state || "normal"} category-${target.category || "scenery"}`}
            class:prop={target.propSprite}
            class:selected={selectedTargetId === target.id}
            style={`--x:${target.x}%;--y:${target.y}%;--depth:${Math.round(20 + target.y)}`}
            type="button"
            aria-label={`Look at ${target.name}`}
            title={`Look at ${target.name}`}
            aria-pressed={selectedTargetId === target.id}
            data-cue={target.cue ?? ""}
            onclick={() => sendTargetAction(target, "look")}
          >
            {#if target.propSprite}
              <img src={`/assets/iso/props/${target.propSprite}.webp`} alt="" draggable="false" />
            {:else}
              <span aria-hidden="true">i</span>
            {/if}
            {#if target.state}<small>{detailLabel(target.state)}</small>{/if}
          </button>
        {/each}

        {#if selectedTarget}
          <div
            class="target-actions"
            style={`--x:${selectedTarget.x}%;--y:${selectedTarget.y}%`}
            role="group"
            aria-label={`Actions for ${selectedTarget.name}`}
          >
            <strong>{selectedTarget.name}</strong>
            {#each targetVerbs(selectedTarget) as verb (verb)}
              <button type="button" onclick={() => sendTargetAction(selectedTarget, verb)}>
                {detailLabel(verb)}
              </button>
            {/each}
          </div>
        {/if}

        {#each exits as exit (exit.direction)}
          <button
            class={`room-exit exit-${exit.kind}`}
            class:blocked={exit.blocked}
            style={`--x:${exit.x}%;--y:${exit.y}%`}
            type="button"
            aria-label={`Go ${exit.direction}`}
            title={exit.blocked
              ? `${detailLabel(exit.direction)} (${exit.door?.slice(5)})`
              : detailLabel(exit.direction)}
            onclick={() => activeSession.terminal.sendCommand(exit.direction)}
          >
            {#if exit.door}
              <img src={`/assets/iso/buildings/${exit.door}.webp`} alt="" draggable="false" />
            {:else if exit.kind === "stairs"}
              <img src="/assets/iso/buildings/stairs.webp" alt="" draggable="false" />
            {:else if exit.kind === "gate"}
              <img src="/assets/iso/props/gate.webp" alt="" draggable="false" />
            {:else if exit.kind === "cave"}
              <img src="/assets/iso/props/rubble.webp" alt="" draggable="false" />
            {:else}
              <i aria-hidden="true"></i>
            {/if}
            <span>{exit.label}</span>
          </button>
        {/each}

        {#if snapshot.occupantsDark}
          <div class="dark-room-message">It is too dark to make anyone out.</div>
        {:else if snapshot.occupantsUnavailable}
          <div class="dark-room-message">The room view is unavailable.</div>
        {:else}
          {#each occupants as occupant, index (occupant.id)}
            {@const home = roomSceneOccupantPosition(index, occupant, targets) as ScenePosition}
            {@const position = occupant.kind === "self" && playerTarget ? playerTarget : home}
            <div
              class={`occupant activity-${occupant.activity || "idle"} size-${sceneToken(occupant.size || "medium")}`}
              class:self={occupant.kind === "self"}
              class:walking={occupant.kind === "self" && playerTarget}
              class:hostile={occupant.hostile}
              class:fighting={occupant.fighting}
              class:anchored={occupant.anchor_id}
              style={`--x:${position.x}%;--y:${position.y}%;--delay:${index * -0.31}s;--depth:${100 + index};--label-shift:${index % 2 ? -10 : 10}px`}
              title={occupantLabel(occupant)}
              aria-label={occupantLabel(occupant)}
              data-engaged-with={occupant.engaged_with ?? ""}
              data-cue={occupant.cue ?? ""}
              role="img"
            >
              <img
                class="figure"
                src={`/assets/iso/characters/${roomSceneOccupantSprite(occupant)}.webp`}
                alt=""
                draggable="false"
              />
              {#if occupant.weaponSprite}
                <img
                  class="equipment weapon"
                  src={`/assets/sprites/weapons/${occupant.weaponSprite}.png`}
                  alt=""
                  draggable="false"
                />
              {/if}
              {#if occupant.shield}
                <img
                  class="equipment shield"
                  src="/assets/sprites/weapons/shield.png"
                  alt=""
                  draggable="false"
                />
              {/if}
              <span>
                {occupant.name}{occupant.cue ? ` - ${detailLabel(occupant.cue)}` : ""}
              </span>
              {#if occupant.role || occupant.activity || occupant.helmet || occupant.armor}
                <em>
                  {[occupant.role, occupant.activity, occupant.helmet, occupant.armor]
                    .filter(Boolean)
                    .join(" / ")}
                </em>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/key}

    <footer>
      <div class="room-facts">
        {#if targets.length}
          <div class="fact-group">
            <strong>Look At</strong>
            <ul class="target-catalogue" aria-label="Things to look at">
              {#each targets as target (target.id)}
                <li>
                  <button
                    class="catalogue-target"
                    type="button"
                    title={target.name}
                    onclick={() => sendTargetAction(target, "look")}
                  >
                    {target.name}{target.state ? ` (${target.state})` : ""}{target.cue
                      ? ` - ${detailLabel(target.cue)}`
                      : ""}
                  </button>
                  {#each targetVerbs(target).filter((verb) => verb !== "look") as verb (verb)}
                    <button
                      class="quick-action"
                      type="button"
                      aria-label={`${detailLabel(verb)} ${target.name}`}
                      onclick={() => sendTargetAction(target, verb)}>{detailLabel(verb)}</button
                    >
                  {/each}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        <div class="fact-group">
          <strong>Exits</strong>
          {#if exits.length}
            <ul aria-label="Room exits">
              {#each exits as exit (exit.direction)}
                <li class:warning={exit.blocked}>
                  {detailLabel(exit.direction)}{exit.blocked ? ` (${exit.door?.slice(5)})` : ""}
                </li>
              {/each}
            </ul>
          {:else}<span>None visible</span>{/if}
        </div>
        <div class="fact-group occupants-summary">
          <strong>Occupants</strong>
          {#if snapshot.occupantsDark}<span>Hidden by darkness</span>
          {:else if occupants.length}
            <ul aria-label="Room occupants">
              {#each occupants as occupant (occupant.id)}
                <li class:warning={occupant.hostile}>{occupant.name}</li>
              {/each}
              {#if occupantsOverflow}<li>+{occupantsOverflow} more</li>{/if}
            </ul>
          {:else}<span>None visible</span>{/if}
        </div>
      </div>
    </footer>
  {:else}
    <p class="placeholder">No room data.</p>
  {/if}
</section>

<style>
  .iso-room-panel {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto minmax(230px, 1fr) auto;
    min-width: 0;
    min-height: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 42%, rgb(36 45 52 / 72%), transparent 56%),
      linear-gradient(180deg, #111820, #080c11 72%);
    color: var(--df-text, #c9d1d9);
  }

  header {
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.65rem 0.85rem 0.45rem;
    background: linear-gradient(180deg, rgb(8 12 17 / 92%), rgb(8 12 17 / 30%));
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    overflow: hidden;
    color: var(--df-text-strong, #e6edf3);
    font-size: calc(14px * var(--pane-font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header p,
  .terrain-label,
  footer {
    color: var(--df-muted, #8b949e);
    font-size: calc(11px * var(--pane-font-scale, 1));
  }

  .terrain-label {
    flex: 0 0 auto;
    padding: 0.18rem 0.45rem;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 999px;
    background: rgb(0 0 0 / 24%);
    letter-spacing: 0.04em;
  }

  .scene-labels {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.3rem;
  }

  .room-stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    isolation: isolate;
    animation: scene-enter 260ms ease-out both;
  }

  .room-stage::after {
    position: absolute;
    z-index: 190;
    inset: 0;
    content: "";
    pointer-events: none;
  }

  .room-stage.time-dawn::after {
    background: linear-gradient(130deg, rgb(238 150 89 / 16%), transparent 48%);
  }

  .room-stage.time-dusk::after {
    background: linear-gradient(145deg, rgb(119 68 145 / 18%), rgb(22 30 67 / 24%));
  }

  .room-stage.time-night::after {
    background: linear-gradient(160deg, rgb(10 25 58 / 38%), rgb(0 4 14 / 30%));
  }

  .room-stage.lighting-dim::after {
    background-color: rgb(0 0 0 / 25%);
  }

  .room-stage.lighting-fire::after {
    background: radial-gradient(circle at 28% 62%, rgb(255 135 45 / 19%), transparent 38%);
    animation: fire-light 1.8s ease-in-out infinite;
  }

  .room-stage.lighting-magic::after {
    background: radial-gradient(circle at 68% 50%, rgb(94 107 255 / 18%), transparent 40%);
  }

  .room-floor {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: 50%;
    width: min(94%, 768px);
    max-height: 88%;
    object-fit: contain;
    filter: drop-shadow(0 18px 22px rgb(0 0 0 / 55%));
    transform: translate(-50%, -48%);
    user-select: none;
  }

  .stage-haze {
    position: absolute;
    z-index: 0;
    inset: 17% 8% 4%;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgb(101 124 113 / 13%), transparent 68%);
    filter: blur(22px);
  }

  .living-surface {
    position: absolute;
    z-index: 2;
    top: 46%;
    left: 50%;
    width: min(58%, 430px);
    aspect-ratio: 3 / 1;
    border-radius: 50%;
    opacity: 0;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .weather-layer {
    position: absolute;
    z-index: 180;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .weather-layer i {
    position: absolute;
    display: none;
    left: calc((var(--particle) * 8%));
    animation-delay: calc(var(--particle) * -0.19s);
  }

  .weather-rain i {
    display: block;
    top: -18%;
    width: 2px;
    height: 20%;
    background: linear-gradient(transparent, rgb(190 227 248 / 76%));
    transform: rotate(13deg);
    animation: weather-fall 1.1s linear infinite;
  }

  .weather-rain {
    background: repeating-linear-gradient(
      102deg,
      transparent 0 42px,
      rgb(190 227 248 / 18%) 43px 45px,
      transparent 46px 84px
    );
    animation: rain-sheet 1.2s linear infinite;
  }

  .weather-snow i,
  .weather-ash i,
  .weather-sand i {
    display: block;
    top: -8%;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgb(234 244 251 / 80%);
    animation: weather-drift 4.5s linear infinite;
  }

  .weather-ash i {
    background: rgb(94 84 77 / 75%);
  }

  .weather-sand i {
    width: 8px;
    height: 2px;
    border-radius: 0;
    background: rgb(222 184 111 / 62%);
  }

  .weather-fog {
    background: linear-gradient(100deg, transparent, rgb(211 220 219 / 18%), transparent);
    filter: blur(10px);
    animation: fog-drift 7s ease-in-out infinite;
  }

  .combat-clash {
    position: absolute;
    z-index: 125;
    top: 60%;
    left: 50%;
    width: 56px;
    height: 56px;
    border: 2px solid rgb(255 184 83 / 68%);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: combat-clash 1.1s ease-out infinite;
    pointer-events: none;
  }

  .combat-clash span {
    position: absolute;
    top: 50%;
    left: 50%;
    color: #ffd38a;
    font: 800 9px/1 sans-serif;
    text-shadow: 0 1px 4px #000;
    transform: translate(-50%, -50%);
  }

  :global(.terrain-river) .living-surface,
  :global(.terrain-lake) .living-surface,
  :global(.terrain-sea) .living-surface,
  :global(.terrain-underwater) .living-surface {
    opacity: 0.4;
    background: linear-gradient(
      105deg,
      transparent 20%,
      rgb(196 239 246 / 45%) 45%,
      transparent 68%
    );
    filter: blur(2px);
    animation: water-shimmer 3.8s ease-in-out infinite;
  }

  :global(.terrain-swamp) .living-surface {
    opacity: 0.28;
    background: radial-gradient(ellipse, rgb(210 226 205 / 58%), transparent 62%);
    filter: blur(9px);
    animation: swamp-mist 5.2s ease-in-out infinite;
  }

  .building,
  .room-target,
  .occupant,
  .room-exit {
    position: absolute;
    top: var(--y);
    left: var(--x);
    transform: translate(-50%, -82%);
  }

  .building {
    z-index: 5;
    width: clamp(84px, 21%, 150px);
    pointer-events: none;
  }

  .room-target {
    z-index: var(--depth);
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    padding: 0;
    border: 1px solid rgb(230 219 174 / 45%);
    border-radius: 50%;
    background: rgb(8 12 17 / 72%);
    color: #e8ddb6;
    cursor: pointer;
    transform: translate(-50%, -50%);
  }

  .room-target.prop {
    width: clamp(58px, 12%, 92px);
    height: auto;
    border: 0;
    border-radius: 0;
    background: none;
    transform: translate(-50%, -82%);
  }

  .room-target.category-item {
    width: clamp(46px, 8%, 64px);
  }

  .room-target.category-workplace {
    width: clamp(54px, 10%, 78px);
  }

  .room-target img {
    display: block;
    width: 100%;
    height: auto;
    filter: drop-shadow(0 7px 5px rgb(0 0 0 / 48%));
  }

  .room-target:hover,
  .room-target:focus-visible {
    outline: 2px solid rgb(142 216 255 / 72%);
    outline-offset: 2px;
    filter: brightness(1.12);
  }

  .room-target.selected {
    filter: brightness(1.18) drop-shadow(0 0 7px rgb(142 216 255 / 75%));
  }

  .room-target.state-lit,
  .room-target.state-active,
  .room-target.state-burning {
    filter: drop-shadow(0 0 10px rgb(255 167 70 / 72%));
  }

  .room-target.state-broken,
  .room-target.state-empty,
  .room-target.state-dormant {
    filter: saturate(0.45) brightness(0.78);
  }

  .room-target small {
    position: absolute;
    top: 95%;
    left: 50%;
    padding: 1px 3px;
    border-radius: 3px;
    background: rgb(5 8 11 / 82%);
    color: #d8cda8;
    font-size: 8px;
    line-height: 1;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .room-target[data-cue="quest"],
  .room-target[data-cue="objective"],
  .room-target[data-cue="loot"],
  .occupant[data-cue="quest"],
  .occupant[data-cue="objective"] {
    filter: drop-shadow(0 0 6px rgb(233 198 90 / 68%));
  }

  .target-actions {
    position: absolute;
    z-index: 170;
    top: calc(var(--y) + 8%);
    left: var(--x);
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid rgb(142 216 255 / 38%);
    border-radius: 4px;
    background: rgb(5 9 13 / 90%);
    transform: translateX(-50%);
    box-shadow: 0 4px 12px rgb(0 0 0 / 55%);
  }

  .target-actions strong {
    align-self: center;
    max-width: 90px;
    overflow: hidden;
    padding-inline: 3px;
    color: #d8cda8;
    font-size: 9px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-actions::before {
    position: absolute;
    bottom: 100%;
    left: 50%;
    width: 1px;
    height: 20px;
    background: rgb(142 216 255 / 52%);
    content: "";
  }

  .target-actions button {
    padding: 2px 5px;
    border: 0;
    border-radius: 2px;
    background: rgb(255 255 255 / 8%);
    color: #dbe9f2;
    font-size: 9px;
    cursor: pointer;
  }

  .building img,
  .occupant > img.figure {
    display: block;
    width: 100%;
    height: auto;
    filter: drop-shadow(0 8px 5px rgb(0 0 0 / 50%));
  }

  .room-exit {
    z-index: 8;
    display: grid;
    width: auto;
    min-width: 32px;
    height: 28px;
    place-items: center;
    padding: 0 5px;
    border: 1px solid rgb(230 219 174 / 42%);
    border-radius: 50%;
    background: rgb(8 12 17 / 78%);
    color: #e8ddb6;
    font:
      700 10px/1 ui-monospace,
      monospace;
    cursor: pointer;
    transform: translate(-50%, -50%);
    box-shadow: 0 3px 8px rgb(0 0 0 / 45%);
  }

  .room-exit:hover,
  .room-exit:focus-visible {
    border-color: #8ed8ff;
    color: #fff;
    outline: none;
    box-shadow: 0 0 0 2px rgb(88 166 255 / 25%);
  }

  .room-exit.blocked {
    border-color: rgb(210 126 98 / 58%);
    color: #eeb3a0;
  }

  .room-exit img {
    position: absolute;
    bottom: 12px;
    left: 50%;
    width: 55px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .room-exit > i {
    position: absolute;
    bottom: 6px;
    left: 50%;
    width: 68px;
    height: 17px;
    border: 1px solid rgb(213 197 147 / 28%);
    border-radius: 50%;
    background: linear-gradient(90deg, transparent, rgb(171 143 89 / 38%), transparent);
    transform: translateX(-50%) rotate(-8deg);
    pointer-events: none;
  }

  .room-exit.exit-portal > i {
    bottom: 5px;
    width: 44px;
    height: 70px;
    border: 3px solid rgb(129 114 255 / 68%);
    border-radius: 50%;
    background: radial-gradient(ellipse, rgb(91 65 203 / 60%), transparent 62%);
    filter: drop-shadow(0 0 8px rgb(108 91 255 / 80%));
    transform: translateX(-50%);
    animation: portal-pulse 2.2s ease-in-out infinite;
  }

  .occupant {
    z-index: var(--depth);
    width: clamp(46px, 10%, 76px);
    transform: translate(-50%, -88%);
    animation: occupant-idle 2.8s ease-in-out var(--delay) infinite;
    transition:
      top 650ms ease-in-out,
      left 650ms ease-in-out;
  }

  .occupant.walking {
    animation-duration: 420ms;
  }

  .occupant::after {
    position: absolute;
    right: 18%;
    bottom: 4%;
    left: 18%;
    height: 8%;
    border: 2px solid #67aada;
    border-radius: 50%;
    content: "";
    box-shadow: 0 0 7px rgb(81 161 218 / 70%);
  }

  .occupant.self::after {
    border-color: #f2cb62;
    box-shadow: 0 0 7px rgb(242 203 98 / 75%);
  }

  .occupant.hostile::after {
    border-color: #e35f54;
    box-shadow: 0 0 8px rgb(227 95 84 / 80%);
  }

  .occupant.fighting img {
    filter: drop-shadow(0 0 7px rgb(225 76 59 / 50%));
  }

  .occupant.fighting {
    animation: combat-lunge 0.9s ease-in-out infinite;
  }

  .occupant.activity-patrol,
  .occupant.activity-wander {
    animation: npc-patrol 4s ease-in-out var(--delay) infinite;
  }

  .occupant.activity-work {
    animation: npc-work 1.2s ease-in-out var(--delay) infinite;
  }

  .occupant.activity-sit,
  .occupant.activity-sleep {
    width: clamp(40px, 8%, 64px);
    transform: translate(-50%, -72%) scaleY(0.82);
  }

  .occupant.size-huge,
  .occupant.size-gigantic {
    width: clamp(48px, 8%, 62px);
  }

  .occupant .equipment {
    position: absolute;
    z-index: 3;
    object-fit: contain;
    pointer-events: none;
  }

  .occupant .weapon {
    top: 42%;
    right: -18%;
    width: 68%;
    transform: rotate(-48deg);
    filter: drop-shadow(0 2px 2px rgb(0 0 0 / 75%));
  }

  .occupant .shield {
    top: 48%;
    left: -4%;
    width: 40%;
    filter: drop-shadow(0 2px 2px rgb(0 0 0 / 70%));
  }

  .occupant span {
    position: absolute;
    top: 96%;
    left: 50%;
    max-width: 120px;
    overflow: hidden;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgb(5 8 11 / 78%);
    color: #edf2f6;
    font-size: 9px;
    line-height: 1.25;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px #000;
    transform: translateX(-50%) translateX(var(--label-shift));
    white-space: nowrap;
  }

  .occupant em {
    position: absolute;
    top: -10px;
    left: 50%;
    max-width: 130px;
    overflow: hidden;
    padding: 1px 3px;
    border-radius: 3px;
    z-index: 4;
    background: rgb(5 8 11 / 92%);
    color: #e0e8ed;
    font-size: 10px;
    font-style: normal;
    text-overflow: ellipsis;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .dark-room-message {
    position: absolute;
    z-index: 12;
    top: 54%;
    left: 50%;
    padding: 0.45rem 0.7rem;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 4px;
    background: rgb(0 0 0 / 68%);
    color: #aeb5bc;
    font-size: 0.75rem;
    transform: translate(-50%, -50%);
  }

  footer {
    z-index: 20;
    padding: 0.45rem 0.7rem 0.6rem;
    border-top: 1px solid rgb(255 255 255 / 7%);
    background: rgb(7 10 14 / 88%);
  }

  .room-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.65rem;
  }

  .fact-group {
    min-width: 0;
  }

  .fact-group strong {
    display: block;
    margin-bottom: 0.2rem;
    color: #d9c99b;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .fact-group ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .fact-group li {
    overflow: hidden;
    color: var(--df-text, #c9d1d9);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fact-group li.warning {
    color: #eaa191;
  }

  .target-catalogue button {
    padding: 0.12rem 0.35rem;
    border: 1px solid rgb(230 219 174 / 22%);
    border-radius: 3px;
    background: rgb(255 255 255 / 4%);
    color: #cfd7de;
    font: inherit;
    cursor: pointer;
  }

  .target-catalogue li {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
  }

  .target-catalogue button.catalogue-target {
    min-width: 0;
    overflow: hidden;
    flex: 1 1 auto;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-catalogue button.quick-action {
    flex: 0 0 auto;
    padding-inline: 0.25rem;
    border-color: rgb(112 200 239 / 24%);
    color: #8ed8ff;
    font-size: 8px;
    text-transform: uppercase;
  }

  .target-catalogue button:hover,
  .target-catalogue button:focus-visible {
    border-color: #8ed8ff;
    color: #fff;
    outline: none;
  }

  .occupants-summary ul {
    max-height: 2.6em;
    overflow: hidden;
  }

  .placeholder {
    margin: 0;
    padding: 0.75rem;
    color: var(--df-muted, #8b949e);
    font-size: 0.75rem;
  }

  @keyframes scene-enter {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @keyframes fire-light {
    50% {
      opacity: 0.68;
    }
  }

  @keyframes weather-fall {
    to {
      transform: translate(55px, 620px) rotate(13deg);
    }
  }

  @keyframes rain-sheet {
    to {
      background-position: 52px 90px;
    }
  }

  @keyframes weather-drift {
    to {
      transform: translate(34px, 620px) rotate(220deg);
    }
  }

  @keyframes fog-drift {
    0%,
    100% {
      transform: translateX(-12%);
    }
    50% {
      transform: translateX(12%);
    }
  }

  @keyframes portal-pulse {
    50% {
      opacity: 0.72;
      filter: drop-shadow(0 0 14px rgb(108 91 255 / 95%));
    }
  }

  @keyframes combat-clash {
    from {
      opacity: 0.8;
      transform: translate(-50%, -50%) scale(0.2);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.2);
    }
  }

  @keyframes combat-lunge {
    0%,
    100% {
      margin-left: 0;
    }
    50% {
      margin-left: 5px;
    }
  }

  @keyframes npc-patrol {
    0%,
    100% {
      margin-left: -5px;
    }
    50% {
      margin-left: 5px;
    }
  }

  @keyframes npc-work {
    0%,
    100% {
      margin-top: 0;
      transform: translate(-50%, -88%) rotate(0deg);
    }
    50% {
      margin-top: 2px;
      transform: translate(-50%, -88%) rotate(2deg);
    }
  }

  @keyframes occupant-idle {
    0%,
    100% {
      margin-top: 0;
    }
    50% {
      margin-top: -3px;
    }
  }

  @keyframes water-shimmer {
    0%,
    100% {
      transform: translate(-54%, -50%);
    }
    50% {
      transform: translate(-46%, -50%);
    }
  }

  @keyframes swamp-mist {
    0%,
    100% {
      opacity: 0.18;
      transform: translate(-52%, -48%);
    }
    50% {
      opacity: 0.34;
      transform: translate(-48%, -56%);
    }
  }

  @media (max-width: 520px) {
    .iso-room-panel {
      grid-template-rows: auto minmax(210px, 1fr) auto;
    }

    .room-facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .occupants-summary {
      grid-column: 1 / -1;
    }

    .building {
      width: clamp(64px, 20%, 104px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .room-stage,
    .occupant,
    .living-surface,
    .weather-layer i,
    .weather-layer,
    .combat-clash,
    .room-exit.exit-portal > i {
      animation: none;
    }

    .occupant {
      transition: none;
    }
  }
</style>
