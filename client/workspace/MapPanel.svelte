<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { Readable } from "svelte/store";
  import type { Session } from "../runtime/session.ts";
  import type { SessionWorldSnapshot, WorldMapSource } from "../runtime/world.ts";
  import type { PanelState } from "./workspace.ts";
  import { loadClientSettings } from "../app/client-settings.ts";
  // @ts-expect-error Retained renderer factory is JavaScript without declarations.
  import { createMapRenderer, mapDetailIconSvg } from "../../public/js/map-renderer-core.js";
  // @ts-expect-error Retained pan controller is JavaScript without declarations.
  import { wireMapPan } from "../../public/js/map-pan.js";
  // @ts-expect-error Retained zoom helpers are JavaScript without declarations.
  import * as zoomHelpers from "../../public/js/map-zoom.js";
  // @ts-expect-error Retained pathfinder is JavaScript without declarations.
  import { findPath } from "../../public/js/map-speedwalk-core.js";
  // @ts-expect-error Route marks are JavaScript without declarations.
  import { mapRouteMarks } from "../../public/js/map-route-core.js";
  // @ts-expect-error The Scene's pure helpers are retained JavaScript without declarations.
  import { sceneAmbience } from "../../public/js/combat-stage-core.mjs";
  // @ts-expect-error Retained terrain vocabulary is JavaScript without declarations.
  import { getPrimaryTerrain } from "../../public/js/terrain-semantics.mjs";
  // @ts-expect-error Retained information renderers are JavaScript without declarations.
  import { skyCurrentState } from "../../public/js/core-information-panel-renderers.mjs";

  const { MAP_ZOOM_LEVELS, formatMapZoom, normalizeMapZoom, stepMapZoom } = zoomHelpers;

  interface RouteMarks {
    rooms: Array<{ id: string; order: number }>;
    links: Array<{ id: string; abbr: string }>;
    targetId: string;
    steps: number;
  }
  interface MapAmbience {
    key: string;
    color: string;
    alpha: number;
    light: boolean;
  }

  let {
    panelId,
    state: panelState,
    session,
  }: { panelId: string; state: Readable<PanelState>; session?: Session } = $props();

  const resolvedSession = untrack(() => session);
  if (!resolvedSession) throw new Error("Map panels require a session");
  const activeSession: Session = resolvedSession;
  const resolvedPanelId = untrack(() => panelId);
  if (resolvedPanelId !== "map" && resolvedPanelId !== "areaMap") {
    throw new Error(`Unsupported map panel '${resolvedPanelId}'`);
  }

  const live = resolvedPanelId === "map";
  const renderer = createMapRenderer();
  let panel: HTMLElement;
  let body: HTMLElement;
  let mapZoom = $state(1);
  let mapStatus = $state("");
  let legendOpen = $state(false);
  let snapshot: SessionWorldSnapshot = activeSession.world.getSnapshot();
  let mapSettings = loadClientSettings(localStorage).settings;

  // The room under the pointer or keyboard focus, whose route is previewed,
  // and the room a speedwalk is heading for, whose route counts down.
  let hoverId: string | null = null;
  let walkTargetId: string | null = null;
  let routeCache: { key: string; marks: RouteMarks | null } | null = null;

  const source = (): WorldMapSource => (live ? snapshot.source : snapshot.browseSource);

  // The game's time of day, as a tint for the live map. Rooms with no sky
  // are left alone, as on the Scene.
  function ambienceInput(): MapAmbience | null {
    if (!live || !mapSettings.mapDayNight) return null;
    const sky = activeSession.information.getSnapshot().sky;
    if (!sky) return null;
    const current = source().getRoom(source().getCurrentRoomId());
    const terrain = getPrimaryTerrain(String(current?.environment ?? "")) as string;
    const ambience = sceneAmbience(
      { stage: String(skyCurrentState(sky).stage), moonLight: Number(sky.moon_light) || 0 },
      terrain,
    ) as { key: string; color: string; backdrop: number } | null;
    if (!ambience) return null;
    return {
      key: ambience.key,
      color: ambience.color,
      alpha: ambience.backdrop * 0.85,
      light: ambience.key.startsWith("night"),
    };
  }

  function enhanceRoomTiles(): void {
    for (const tile of body.querySelectorAll<HTMLElement>(".map-tile-room[data-room-id]")) {
      const name = tile.title.split("\n", 1)[0] || "Mapped room";
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", live ? `Speedwalk to ${name}` : name);
      if (!live) tile.setAttribute("aria-disabled", "true");
    }
  }

  function routeTo(targetId: string): { marks: RouteMarks | null } | null {
    const from = source().getCurrentRoomId();
    if (!from || from === targetId) return null;
    const key = `${snapshot.sourceVersion}|${from}|${targetId}`;
    if (routeCache?.key !== key) {
      const steps = findPath(from, targetId, source()) as Array<{
        dir: string;
        destId: string;
      }> | null;
      routeCache = { key, marks: mapRouteMarks(from, steps) as RouteMarks | null };
    }
    return routeCache;
  }

  function tileFor(id: string): HTMLElement | null {
    return body.querySelector<HTMLElement>(`.map-tile-room[data-room-id="${CSS.escape(id)}"]`);
  }

  function clearRouteMarks(): void {
    delete body.dataset.mapRoute;
    for (const mark of body.querySelectorAll(".map-route-dot, .map-route-count")) mark.remove();
    for (const link of body.querySelectorAll(".map-conn-route")) {
      link.classList.remove("map-conn-route");
    }
    for (const tile of body.querySelectorAll(".map-tile-route-target, .map-tile-route-none")) {
      tile.classList.remove("map-tile-route-target", "map-tile-route-none");
    }
  }

  // Lights the route to the hovered room, or else the rest of the walk in
  // progress. Applied over the rendered tiles, and again after every render.
  function decorateRoute(): void {
    clearRouteMarks();
    if (!live) return;
    const targetId = hoverId ?? (snapshot.speedwalking ? walkTargetId : null);
    if (!targetId) return;
    const route = routeTo(targetId);
    if (!route) return;
    body.dataset.mapRoute = hoverId ? "preview" : "walk";
    const marks = route.marks;
    if (!marks) {
      tileFor(targetId)?.classList.add("map-tile-route-none");
      return;
    }
    for (const room of marks.rooms) {
      if (room.id === marks.targetId) continue;
      const tile = tileFor(room.id);
      if (!tile) continue;
      const dot = document.createElement("span");
      dot.className = "map-route-dot";
      tile.append(dot);
    }
    for (const link of marks.links) {
      tileFor(link.id)
        ?.querySelector(`:scope > .map-conn-${link.abbr}`)
        ?.classList.add("map-conn-route");
    }
    const target = tileFor(marks.targetId);
    if (target) {
      target.classList.add("map-tile-route-target");
      const count = document.createElement("span");
      count.className = "map-route-count";
      count.textContent = String(marks.steps);
      target.append(count);
    }
  }

  function render(): void {
    body.dataset.mapZoom = String(mapZoom);
    renderer.render(body, source(), { ambience: ambienceInput() });
    enhanceRoomTiles();
    decorateRoute();
    mapStatus = snapshot.speedwalking
      ? "Speedwalking"
      : source().getMapStatus() || (live ? "Live map" : "Area map");
  }

  function activateTile(target: EventTarget | null): void {
    if (!live || !(target instanceof Element)) return;
    const tile = target.closest<HTMLElement>(".map-tile-room[data-room-id]");
    const roomId = tile?.dataset.roomId;
    if (!roomId) return;
    // The walk's own route takes over from the preview once it starts.
    walkTargetId = roomId;
    hoverId = null;
    if (!activeSession.world.speedwalkTo(roomId)) walkTargetId = null;
  }

  function handleClick(event: MouseEvent): void {
    activateTile(event.target);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    if (!(event.target instanceof Element)) return;
    const tile = event.target.closest<HTMLElement>(".map-tile-room[data-room-id]");
    if (!tile || !live) return;
    event.preventDefault();
    activateTile(tile);
  }

  function previewFrom(target: EventTarget | null): void {
    const tile =
      target instanceof Element
        ? target.closest<HTMLElement>(".map-tile-room[data-room-id]")
        : null;
    const next = tile?.dataset.roomId ?? null;
    if (next === hoverId) return;
    hoverId = next;
    decorateRoute();
  }

  function handlePointerOver(event: PointerEvent): void {
    if (!live || event.pointerType === "touch" || body.classList.contains("map-panning")) return;
    previewFrom(event.target);
  }

  function handlePointerLeave(): void {
    if (hoverId === null) return;
    hoverId = null;
    decorateRoute();
  }

  function handleFocusIn(event: FocusEvent): void {
    if (live) previewFrom(event.target);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (!body.contains(event.relatedTarget as Node | null)) handlePointerLeave();
  }

  function setZoom(value: unknown): void {
    const next = normalizeMapZoom(value);
    if (next === mapZoom) return;
    mapZoom = next;
    render();
    panel.dispatchEvent(
      new CustomEvent("darkflow:map-panel-state", {
        bubbles: true,
        detail: { panelId: resolvedPanelId, mapZoom },
      }),
    );
  }

  function recenter(): void {
    delete body.dataset.mapPanX;
    delete body.dataset.mapPanY;
    render();
  }

  // Escape anywhere in the panel closes an open legend.
  function handleLegendKeydown(event: KeyboardEvent): void {
    if (!legendOpen || event.key !== "Escape") return;
    event.stopPropagation();
    legendOpen = false;
  }

  const LEGEND_ICONS: Array<{ kind: string; label: string }> = [
    { kind: "shop", label: "Shop" },
    { kind: "bank", label: "Bank" },
    { kind: "guild", label: "Guild" },
    { kind: "pub", label: "Pub" },
    { kind: "post", label: "Post office" },
  ];

  onMount(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = (): void => {
      if (motionQuery.matches) body.dataset.mapMotion = "reduce";
      else delete body.dataset.mapMotion;
    };
    syncMotion();
    motionQuery.addEventListener("change", syncMotion);

    const unsubscribeState = panelState.subscribe((next) => {
      const nextZoom = normalizeMapZoom(next.mapZoom);
      if (nextZoom !== mapZoom) {
        mapZoom = nextZoom;
        render();
      }
    });
    const unsubscribeWorld = activeSession.world.subscribe((next) => {
      snapshot = next;
      if (!next.speedwalking) walkTargetId = null;
      render();
    });

    // The sky moves on between frames; repaint only when the tint changes.
    let ambienceKey = ambienceInput()?.key ?? "";
    const refreshAmbience = (): void => {
      const key = ambienceInput()?.key ?? "";
      if (key === ambienceKey) return;
      ambienceKey = key;
      render();
    };
    const unsubscribeSky = live ? activeSession.information.subscribe(refreshAmbience) : () => {};
    const ambienceTicker = live ? window.setInterval(refreshAmbience, 5_000) : 0;
    const refreshSettings = (): void => {
      mapSettings = loadClientSettings(localStorage).settings;
      ambienceKey = "\u0000";
      refreshAmbience();
    };
    window.addEventListener("darkflow:client-settings-changed", refreshSettings);

    const disposePan = wireMapPan(body, { rerender: render }) as (() => void) | undefined;
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(body);
    body.addEventListener("click", handleClick);
    body.addEventListener("keydown", handleKeydown);
    body.addEventListener("pointerover", handlePointerOver);
    body.addEventListener("pointerleave", handlePointerLeave);
    body.addEventListener("focusin", handleFocusIn);
    body.addEventListener("focusout", handleFocusOut);
    panel.addEventListener("keydown", handleLegendKeydown);

    return () => {
      unsubscribeWorld();
      unsubscribeState();
      unsubscribeSky();
      window.clearInterval(ambienceTicker);
      window.removeEventListener("darkflow:client-settings-changed", refreshSettings);
      motionQuery.removeEventListener("change", syncMotion);
      disposePan?.();
      resizeObserver.disconnect();
      body.removeEventListener("click", handleClick);
      body.removeEventListener("keydown", handleKeydown);
      body.removeEventListener("pointerover", handlePointerOver);
      body.removeEventListener("pointerleave", handlePointerLeave);
      body.removeEventListener("focusin", handleFocusIn);
      body.removeEventListener("focusout", handleFocusOut);
      panel.removeEventListener("keydown", handleLegendKeydown);
      renderer.dispose();
      if (!live) activeSession.world.closeBrowse();
    };
  });
</script>

<section bind:this={panel} class="map-panel" data-panel-id={panelId} data-workspace-owned="true">
  <div class="map-toolbar" role="toolbar" aria-label="Map controls">
    <button
      class="panel-btn map-zoom-btn map-zoom-out"
      type="button"
      aria-label="Zoom map out"
      title="Zoom map out"
      disabled={mapZoom === MAP_ZOOM_LEVELS[0]}
      onclick={() => setZoom(stepMapZoom(mapZoom, -1))}>−</button
    >
    <span class="map-zoom-level" aria-live="polite">{formatMapZoom(mapZoom)}</span>
    <button
      class="panel-btn map-zoom-btn map-zoom-in"
      type="button"
      aria-label="Zoom map in"
      title="Zoom map in"
      disabled={mapZoom === MAP_ZOOM_LEVELS[MAP_ZOOM_LEVELS.length - 1]}
      onclick={() => setZoom(stepMapZoom(mapZoom, 1))}>+</button
    >
    <button
      class="panel-btn map-recenter-btn"
      type="button"
      aria-label="Re-center map"
      title="Re-center map"
      onclick={recenter}>◎</button
    >
    <button
      class="panel-btn map-legend-btn"
      type="button"
      aria-label="Map legend"
      title="Map legend"
      aria-expanded={legendOpen}
      aria-controls={`map-legend-${panelId}`}
      onclick={() => (legendOpen = !legendOpen)}>?</button
    >
    <span class="map-panel-status" role="status" aria-live="polite">{mapStatus}</span>
  </div>
  <div class="map-viewport">
    <div bind:this={body} class="map-body" id={`panel-body-${panelId}`}></div>
    {#if legendOpen}
      <div class="map-legend" id={`map-legend-${panelId}`} role="region" aria-label="Map legend">
        <div class="map-legend-head">
          <span>Legend</span>
          <button
            type="button"
            class="map-legend-close"
            aria-label="Close legend"
            onclick={() => (legendOpen = false)}>×</button
          >
        </div>
        <dl>
          <div>
            <dt><span class="lg-you"></span></dt>
            <dd>You</dd>
          </div>
          {#if live}
            <div>
              <dt><span class="lg-dot lg-preview"></span></dt>
              <dd>Route to the room under the pointer, with its steps</dd>
            </div>
            <div>
              <dt><span class="lg-dot lg-walk"></span></dt>
              <dd>Route being walked</dd>
            </div>
          {/if}
          {#each LEGEND_ICONS as icon (icon.kind)}
            <div>
              <dt class="lg-icon">
                <!-- The icons are fixed markup from the map renderer. -->
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html mapDetailIconSvg(icon.kind)}
              </dt>
              <dd>{icon.label}</dd>
            </div>
          {/each}
          <div>
            <dt><span class="lg-line lg-stub"></span></dt>
            <dd>Exit not explored yet</dd>
          </div>
          <div>
            <dt><span class="lg-line lg-area"></span></dt>
            <dd>Exit to another area</dd>
          </div>
          <div>
            <dt><span class="lg-line lg-adjusted"></span></dt>
            <dd>Exit drawn out of place to make room</dd>
          </div>
          <div>
            <dt><span class="lg-line lg-oneway"></span></dt>
            <dd>One-way exit</dd>
          </div>
          <div>
            <dt>
              <span class="lg-door lg-open"></span><span class="lg-door lg-closed"></span><span
                class="lg-door lg-locked"
              ></span>
            </dt>
            <dd>Door: open, closed, locked</dd>
          </div>
          <div>
            <dt class="lg-glyph">▲ ▼</dt>
            <dd>Way up or down</dd>
          </div>
          <div>
            <dt class="lg-glyph">›‹ ‹›</dt>
            <dd>Way in or out</dd>
          </div>
          <div>
            <dt><span class="lg-special"></span></dt>
            <dd>Other exit</dd>
          </div>
          <div>
            <dt><span class="lg-stack">2</span></dt>
            <dd>Rooms sharing one spot</dd>
          </div>
          <div>
            <dt><span class="lg-unseen"></span></dt>
            <dd>Known but not visited</dd>
          </div>
          <div>
            <dt><span class="lg-fog"></span></dt>
            <dd>Edge of the explored map</dd>
          </div>
        </dl>
      </div>
    {/if}
  </div>
</section>

<style>
  .map-panel {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #000;
  }

  .map-toolbar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.125rem;
    min-height: 1.75rem;
    padding: 0.125rem 0.375rem;
    border-bottom: 1px solid var(--df-border);
    background: var(--df-panel);
  }

  .map-panel-status {
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    color: var(--df-muted);
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map-viewport {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .map-body {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }

  .map-body :global(.map-grid-frame) {
    cursor: grab;
  }

  .map-body:global(.map-panning) :global(.map-grid-frame),
  .map-body:global(.map-panning) :global(.map-tile) {
    cursor: grabbing;
  }

  .map-body :global(.map-tile-room:focus-visible) {
    z-index: 3;
    outline: 2px solid var(--df-accent-blue);
    outline-offset: 1px;
  }

  .map-legend {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    z-index: 20;
    max-width: min(17rem, calc(100% - 0.75rem));
    max-height: calc(100% - 0.75rem);
    overflow: auto;
    padding: 0.375rem 0.5rem 0.5rem;
    border: 1px solid var(--df-border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--df-panel) 94%, transparent);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
    color: var(--df-text);
    font-size: calc(0.6875rem * var(--pane-font-scale, 1));
  }

  .map-legend-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
    font-weight: 700;
  }

  .map-legend-close {
    padding: 0 0.25rem;
    border: 0;
    background: none;
    color: var(--df-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .map-legend dl {
    display: grid;
    gap: 0.25rem;
    margin: 0;
  }

  .map-legend dl > div {
    display: grid;
    grid-template-columns: 2.25rem 1fr;
    align-items: center;
    gap: 0.375rem;
  }

  .map-legend dt {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 14px;
  }

  .map-legend dd {
    margin: 0;
  }

  .lg-icon {
    color: rgba(240, 198, 116, 0.95);
  }

  .lg-icon :global(svg) {
    width: 13px;
    height: 13px;
    fill: currentColor;
  }

  .lg-glyph {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.625rem;
  }

  .lg-you {
    width: 12px;
    height: 12px;
    box-shadow:
      0 0 0 1px #00ffff,
      0 0 5px 1px rgba(0, 255, 255, 0.9);
  }

  .lg-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75);
  }

  .lg-preview {
    background: #f2cc60;
  }

  .lg-walk {
    background: #62e6ff;
  }

  .lg-line {
    width: 16px;
    height: 3px;
  }

  .lg-stub {
    background: repeating-linear-gradient(
      90deg,
      rgba(180, 195, 210, 0.8) 0 2px,
      transparent 2px 4px
    );
  }

  .lg-area {
    background: rgba(242, 204, 96, 0.85);
  }

  .lg-adjusted {
    background: repeating-linear-gradient(
      90deg,
      rgba(114, 199, 189, 0.95) 0 2px,
      transparent 2px 4px
    );
  }

  .lg-oneway {
    background: repeating-linear-gradient(
      90deg,
      rgba(235, 140, 120, 0.9) 0 3px,
      transparent 3px 5px
    );
  }

  .lg-door {
    width: 3px;
    height: 10px;
  }

  .lg-open {
    background: rgba(120, 200, 120, 0.95);
  }

  .lg-closed {
    background: rgba(230, 180, 80, 0.95);
  }

  .lg-locked {
    background: rgba(220, 90, 90, 0.95);
  }

  .lg-special {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(160, 120, 220, 0.9);
  }

  .lg-stack {
    min-width: 12px;
    height: 12px;
    outline: 1px dashed rgba(242, 204, 96, 0.85);
    color: #f2cc60;
    font: 700 8px/12px var(--df-font-mono);
    text-align: center;
  }

  .lg-unseen {
    width: 12px;
    height: 12px;
    background: #4a4d52;
  }

  .lg-fog {
    width: 12px;
    height: 12px;
    background: radial-gradient(circle, rgba(190, 200, 215, 0.45), transparent 75%);
  }
</style>
