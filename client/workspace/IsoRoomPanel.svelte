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
    roomSceneDetails,
    roomSceneDoorSprite,
    roomSceneExitPosition,
    roomSceneOccupantPosition,
    roomSceneOccupantSprite,
    roomScenePropSprite,
    roomSceneTargetMatches,
    roomSceneTargetPosition,
    roomSceneTargets,
    roomSceneTerrain,
    roomSceneTexture,
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
  }

  interface SceneExit {
    direction: string;
    label: string;
    x: number;
    y: number;
    door: string | null;
    blocked: boolean;
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
  const details = $derived.by(() => roomSceneDetails(room?.details).map(String));
  const buildings = $derived.by(() => sceneBuildings(details));
  const targets = $derived.by(() => sceneTargets(room));
  const occupants = $derived.by(() => sceneOccupants(snapshot));
  const exits = $derived.by(() => sceneExits(room));
  let playerTarget = $state<(ScenePosition & { id: string }) | null>(null);
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
      ...(roomSceneTargetPosition(index) as ScenePosition),
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
        destination = roomSceneOccupantPosition(occupantIndex) as ScenePosition;
        targetId = occupant.id;
      }
    }
    if (!destination || !targetId) return;
    clearTimeout(returnTimer);
    playerTarget = { id: targetId, x: destination.x, y: destination.y + 3 };
    returnTimer = setTimeout(() => (playerTarget = null), 1800);
  }

  function lookAt(target: SceneTarget): void {
    activeSession.terminal.sendCommand(`look ${target.nouns[0]}`);
  }

  function sceneOccupants(value: SessionWorldSnapshot): SceneOccupant[] {
    if (value.occupantsDark) return [];
    if (value.occupantsReady) {
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
    return {
      id: occupant.id,
      name: occupant.name,
      kind: occupant.kind,
      ...(occupant.race ? { race: occupant.race } : {}),
      ...(occupant.family ? { family: occupant.family } : {}),
      ...(occupant.gender ? { gender: occupant.gender } : {}),
      ...(occupant.size ? { size: occupant.size } : {}),
      hostile: occupant.hostile === true || occupant.hostile === 1,
      elite: occupant.elite === true || occupant.elite === 1,
      boss: occupant.boss === true || occupant.boss === 1,
      fighting: occupant.fighting === true || occupant.fighting === 1,
      ...(typeof occupant.level === "number" ? { level: occupant.level } : {}),
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
          door: roomSceneDoorSprite(rawDoor) as string | null,
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
    return parts.join(", ");
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
  data-workspace-owned="true"
>
  {#if room?.name}
    <header>
      <div>
        <h2>{room.name}</h2>
        <p>{room.area || "Unknown area"}</p>
      </div>
      <span class="terrain-label">Terrain: {detailLabel(terrain)}</span>
    </header>

    {#key snapshot.roomGeneration}
      <div class="room-stage" aria-label={`Isometric view of ${room.name}`}>
        <div class="stage-haze"></div>
        <img
          class="room-floor"
          src={`/assets/iso/rooms/${texture}.webp`}
          alt=""
          draggable="false"
        />
        <div class="living-surface" aria-hidden="true"></div>

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
            class="room-target"
            class:prop={target.propSprite}
            style={`--x:${target.x}%;--y:${target.y}%;--depth:${Math.round(20 + target.y)}`}
            type="button"
            aria-label={`Look at ${target.name}`}
            title={`Look at ${target.name}`}
            onclick={() => lookAt(target)}
          >
            {#if target.propSprite}
              <img src={`/assets/iso/props/${target.propSprite}.webp`} alt="" draggable="false" />
            {:else}
              <span aria-hidden="true">i</span>
            {/if}
          </button>
        {/each}

        {#each exits as exit (exit.direction)}
          <button
            class="room-exit"
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
            {/if}
            <span>{exit.label}</span>
          </button>
        {/each}

        {#if snapshot.occupantsDark}
          <div class="dark-room-message">It is too dark to make anyone out.</div>
        {:else}
          {#each occupants as occupant, index (occupant.id)}
            {@const home = roomSceneOccupantPosition(index) as ScenePosition}
            {@const position = occupant.kind === "self" && playerTarget ? playerTarget : home}
            <div
              class="occupant"
              class:self={occupant.kind === "self"}
              class:walking={occupant.kind === "self" && playerTarget}
              class:hostile={occupant.hostile}
              class:fighting={occupant.fighting}
              style={`--x:${position.x}%;--y:${position.y}%;--delay:${index * -0.31}s;--depth:${100 + index}`}
              title={occupantLabel(occupant)}
              aria-label={occupantLabel(occupant)}
              role="img"
            >
              <img
                src={`/assets/iso/characters/${roomSceneOccupantSprite(occupant)}.webp`}
                alt=""
                draggable="false"
              />
              <span>{occupant.name}</span>
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
                <li><button type="button" onclick={() => lookAt(target)}>{target.name}</button></li>
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
              {#if snapshot.occupantsMore}<li>+{snapshot.occupantsMore} more</li>{/if}
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

  .room-stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    isolation: isolate;
    animation: scene-enter 260ms ease-out both;
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
    width: clamp(70px, 16%, 124px);
    height: auto;
    border: 0;
    border-radius: 0;
    background: none;
    transform: translate(-50%, -82%);
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

  .building img,
  .occupant img {
    display: block;
    width: 100%;
    height: auto;
    filter: drop-shadow(0 8px 5px rgb(0 0 0 / 50%));
  }

  .room-exit {
    z-index: 8;
    display: grid;
    width: 32px;
    height: 28px;
    place-items: center;
    padding: 0;
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
    .living-surface {
      animation: none;
    }

    .occupant {
      transition: none;
    }
  }
</style>
