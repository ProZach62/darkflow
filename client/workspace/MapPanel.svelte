<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
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
  // @ts-expect-error Map pins are JavaScript without declarations.
  import * as pinHelpers from "../../public/js/map-pins-core.js";
  // @ts-expect-error Map search is JavaScript without declarations.
  import { pinnedRoomsInArea, searchMapRooms } from "../../public/js/map-search-core.js";

  const { MAP_ZOOM_LEVELS, anchoredZoomPan, formatMapZoom, normalizeMapZoom, stepMapZoom } =
    zoomHelpers;
  const {
    MAP_PIN_KINDS,
    MAX_PIN_NOTE,
    mapPinIconSvg,
    mapPinLabel,
    mapPinStorageKey,
    normalizeMapPins,
    removeMapPin,
    setMapPin,
  } = pinHelpers;

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
  interface MapPin {
    kind: string;
    note: string;
    name: string;
    area: string;
    z: number;
    at: number;
  }
  interface MapPins {
    version: 1;
    pins: Record<string, MapPin>;
  }
  interface MapView {
    area: string;
    levels: number[];
    viewZ: number;
    homeZ: number;
    levelOffset: number;
    centerX: number;
    centerY: number;
    pitch: number;
  }
  interface SearchResult {
    id: string;
    name: string;
    z: number;
    details: string[];
    pin: MapPin | null;
  }
  interface PinEditor {
    roomId: string;
    name: string;
    kind: string;
    note: string;
    existing: boolean;
    left: number;
    top: number;
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
  // Levels: how many floors above (+) or below (-) the player's the map shows.
  let levelOffset = $state(0);
  let canLevelUp = $state(false);
  let canLevelDown = $state(false);
  let lastHomeZ: number | null = null;
  let viewLevels: number[] = [];
  // Pins, and the editor open on one room.
  const pinStorageKey = mapPinStorageKey(activeSession.characterProfileId) as string;
  let pins = $state<MapPins>(loadPins());
  let pinEditor = $state<PinEditor | null>(null);
  let pinNoteInput = $state<HTMLInputElement | null>(null);
  // Search, and the room it last flew to.
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchActive = $state(0);
  let searchInput = $state<HTMLInputElement | null>(null);
  let foundId: string | null = null;
  let foundTimer = 0;
  // A zoom that just happened at a point, for the renderer to ease in.
  let pendingZoomAnchor: { x: number; y: number } | null = null;
  // The banner shown on crossing into a new area, and the area last seen.
  let titleCard = $state<{ name: string; key: number } | null>(null);
  let titleCardTimer = 0;
  let lastArea: string | null = null;
  let wheelTotal = 0;
  let lastWheelStep = -Infinity;
  let viewport: HTMLElement;
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

  function loadPins(): MapPins {
    try {
      return normalizeMapPins(JSON.parse(localStorage.getItem(pinStorageKey) ?? "null")) as MapPins;
    } catch {
      return normalizeMapPins(null) as MapPins;
    }
  }

  function savePins(next: MapPins): void {
    pins = next;
    try {
      localStorage.setItem(pinStorageKey, JSON.stringify(next));
    } catch {
      // The pins still hold for this session.
    }
  }

  const reducedMotion = (): boolean => body?.dataset.mapMotion === "reduce";

  function view(): MapView | null {
    return renderer.getView() as MapView | null;
  }

  function currentPan(): { x: number; y: number } {
    return { x: Number(body.dataset.mapPanX) || 0, y: Number(body.dataset.mapPanY) || 0 };
  }

  function setPan(pan: { x: number; y: number }): void {
    if (pan.x || pan.y) {
      body.dataset.mapPanX = String(Math.round(pan.x * 1e6) / 1e6);
      body.dataset.mapPanY = String(Math.round(pan.y * 1e6) / 1e6);
    } else {
      delete body.dataset.mapPanX;
      delete body.dataset.mapPanY;
    }
  }

  // Eases the view in from where it was, given how far the content has to
  // travel in pixels. The grid only reaches a couple of cells past the edge,
  // so a long jump glides the last two cells rather than showing blank map.
  function glideFrom(dx: number, dy: number): void {
    if (reducedMotion()) return;
    const frame = body.querySelector<HTMLElement>(".map-grid-frame");
    if (!frame || typeof frame.animate !== "function") return;
    const pitch = Number(frame.dataset.mapPitch) || 40;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const scale = Math.min(1, (pitch * 2) / length);
    frame.animate([{ translate: `${dx * scale}px ${dy * scale}px` }, { translate: "0px 0px" }], {
      duration: 320,
      easing: "cubic-bezier(0.33, 1, 0.68, 1)",
    });
  }

  function updateLevelControls(current: MapView | null): void {
    viewLevels = current?.levels ?? [];
    canLevelUp = !!current && viewLevels.some((z) => z > current.viewZ);
    canLevelDown = !!current && viewLevels.some((z) => z < current.viewZ);
  }

  // Steps to the next floor up (1) or down (-1) that has rooms.
  function stepLevel(direction: 1 | -1): void {
    const current = view();
    if (!current) return;
    const next =
      direction > 0
        ? viewLevels.find((z) => z > current.viewZ)
        : [...viewLevels].reverse().find((z) => z < current.viewZ);
    if (next === undefined) return;
    levelOffset = next - current.homeZ;
    render();
  }

  // Crossing into a new area shows its name as a banner that fades; the
  // area the map opens in does not.
  function announceArea(area: string): void {
    if (area === lastArea) return;
    const first = lastArea === null;
    lastArea = area;
    if (first) return;
    titleCard = { name: source().getAreaName() || area, key: Date.now() };
    window.clearTimeout(titleCardTimer);
    titleCardTimer = window.setTimeout(() => (titleCard = null), 3_400);
  }

  function decorateFound(): void {
    if (!foundId) return;
    tileFor(foundId)?.classList.add("map-tile-found");
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
    body.dataset.mapStyle = mapSettings.mapPaintedTerrain ? "painted" : "tiles";
    body.dataset.mapLevel = String(levelOffset);
    renderer.render(body, source(), {
      ambience: ambienceInput(),
      pins: pins.pins,
      zoomAnchor: pendingZoomAnchor,
    });
    pendingZoomAnchor = null;
    const current = view();
    // Taking the stairs brings the view back to the player's own floor.
    if (current && lastHomeZ !== null && current.homeZ !== lastHomeZ && levelOffset !== 0) {
      lastHomeZ = current.homeZ;
      levelOffset = 0;
      render();
      return;
    }
    if (current) lastHomeZ = current.homeZ;
    if (live && current?.area) announceArea(current.area);
    updateLevelControls(current);
    enhanceRoomTiles();
    decorateRoute();
    decorateFound();
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

  // Zooms with the world point under anchor (pixels from the middle of the
  // map) held still, and the change eased in around it.
  function zoomAt(value: unknown, anchor: { x: number; y: number }): void {
    const next = normalizeMapZoom(value);
    if (next === mapZoom) return;
    const fromPitch = view()?.pitch ?? 40 * mapZoom;
    const toPitch = (fromPitch / mapZoom) * next;
    setPan(anchoredZoomPan(currentPan(), anchor, fromPitch, toPitch));
    pendingZoomAnchor = anchor;
    setZoom(next);
  }

  // A mouse wheel notch is one zoom step. Its size depends on the screen's
  // scaling (about 50 to 100 pixels), so any single event of 40 or more is a
  // notch. A trackpad's pinch (a wheel with Ctrl held) and its two-finger
  // scroll send many small deltas, gathered into steps. Steps are spaced out
  // so a flick of momentum scrolling does not run through every level.
  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1;
    const delta = event.deltaY * unit;
    if (!event.ctrlKey && Math.abs(delta) >= 40) {
      wheelTotal = delta;
    } else {
      wheelTotal += delta;
      if (Math.abs(wheelTotal) < (event.ctrlKey ? 24 : 100)) return;
    }
    const direction = wheelTotal < 0 ? 1 : -1;
    wheelTotal = 0;
    if (event.timeStamp - lastWheelStep < 70) return;
    lastWheelStep = event.timeStamp;
    const rect = body.getBoundingClientRect();
    zoomAt(stepMapZoom(mapZoom, direction), {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    });
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

  // Back to the player, on the player's own floor, gliding there.
  function recenter(): void {
    const pitch = view()?.pitch ?? 40 * mapZoom;
    const pan = currentPan();
    setPan({ x: 0, y: 0 });
    levelOffset = 0;
    render();
    glideFrom(pan.x * pitch, pan.y * pitch);
  }

  // Centres the view on a room, on its floor, gliding there, and rings it.
  function flyTo(roomId: string): void {
    const current = view();
    const room = source().getRoom(roomId);
    if (!current || !room || typeof room.x !== "number" || typeof room.y !== "number") return;
    const before = currentPan();
    const after = { x: current.centerX - room.x, y: current.centerY - room.y };
    setPan(after);
    levelOffset = typeof room.z === "number" ? room.z - current.homeZ : 0;
    foundId = roomId;
    window.clearTimeout(foundTimer);
    foundTimer = window.setTimeout(() => {
      foundId = null;
      for (const tile of body.querySelectorAll(".map-tile-found")) {
        tile.classList.remove("map-tile-found");
      }
    }, 3_400);
    render();
    glideFrom((before.x - after.x) * current.pitch, (before.y - after.y) * current.pitch);
  }

  // --- Pins ----------------------------------------------------------------
  function openPinEditor(tile: HTMLElement): void {
    const roomId = tile.dataset.roomId;
    const room = roomId ? source().getRoom(roomId) : null;
    if (!roomId || !room) return;
    const existing = pins.pins[roomId];
    const box = viewport.getBoundingClientRect();
    const at = tile.getBoundingClientRect();
    pinEditor = {
      roomId,
      name: String(room.name || "this room"),
      kind: existing?.kind ?? "note",
      note: existing?.note ?? "",
      existing: !!existing,
      left: Math.max(4, Math.min(box.width - 244, at.right - box.left + 6)),
      top: Math.max(4, Math.min(box.height - 170, at.top - box.top - 6)),
    };
    legendOpen = false;
    void tick().then(() => pinNoteInput?.focus());
  }

  function setPinKind(kind: string): void {
    if (pinEditor) pinEditor.kind = kind;
  }

  function closePinEditor(): void {
    const roomId = pinEditor?.roomId;
    pinEditor = null;
    if (roomId) void tick().then(() => tileFor(roomId)?.focus());
  }

  function savePin(): void {
    if (!pinEditor) return;
    const room = source().getRoom(pinEditor.roomId);
    if (room) savePins(setMapPin(pins, room, pinEditor.kind, pinEditor.note) as MapPins);
    render();
    closePinEditor();
  }

  function deletePin(): void {
    if (!pinEditor) return;
    savePins(removeMapPin(pins, pinEditor.roomId) as MapPins);
    render();
    closePinEditor();
  }

  function handleContextMenu(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const tile = event.target.closest<HTMLElement>(".map-tile-room[data-room-id]");
    if (!tile) return;
    event.preventDefault();
    openPinEditor(tile);
  }

  // --- Search ----------------------------------------------------------------
  const searchResults = $derived.by((): SearchResult[] => {
    if (!searchOpen) return [];
    const area = view()?.area;
    if (!area) return [];
    if (!searchQuery.trim()) {
      return (pinnedRoomsInArea(pins.pins, area) as SearchResult[]).slice(0, 8);
    }
    return searchMapRooms(
      source().getRoomsByArea(area),
      searchQuery,
      pins.pins,
      8,
    ) as SearchResult[];
  });

  function toggleSearch(): void {
    searchOpen = !searchOpen;
    searchActive = 0;
    if (searchOpen) {
      legendOpen = false;
      void tick().then(() => searchInput?.focus());
    }
  }

  function closeSearch(): void {
    searchOpen = false;
    searchQuery = "";
    searchActive = 0;
  }

  function goToResult(result: SearchResult | undefined, walk = false): void {
    if (!result) return;
    closeSearch();
    flyTo(result.id);
    if (walk && live) {
      walkTargetId = result.id;
      if (!activeSession.world.speedwalkTo(result.id)) walkTargetId = null;
    }
    void tick().then(() => tileFor(result.id)?.focus());
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = searchResults.length;
      if (!count) return;
      searchActive = (searchActive + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    } else if (event.key === "Enter") {
      event.preventDefault();
      goToResult(searchResults[searchActive], event.shiftKey);
    }
  }

  function resultMeta(result: SearchResult): string {
    const parts: string[] = [];
    if (result.pin) {
      parts.push(mapPinLabel(result.pin.kind) + (result.pin.note ? `: ${result.pin.note}` : ""));
    }
    if (result.details.length) parts.push(result.details.join(", "));
    const current = view();
    if (current && result.z !== current.homeZ) {
      const levels = result.z - current.homeZ;
      parts.push(
        `${Math.abs(levels)} ${Math.abs(levels) === 1 ? "level" : "levels"} ${levels > 0 ? "up" : "down"}`,
      );
    }
    return parts.join(" · ");
  }

  // Escape closes whatever is open in the panel, innermost first.
  function handleLegendKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (pinEditor) {
      event.stopPropagation();
      closePinEditor();
    } else if (searchOpen) {
      event.stopPropagation();
      closeSearch();
    } else if (legendOpen) {
      event.stopPropagation();
      legendOpen = false;
    }
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
    // Pins edited in another Map panel (the area map) show here too.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== pinStorageKey) return;
      pins = loadPins();
      render();
    };
    window.addEventListener("storage", onStorage);
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
      ambienceKey = ambienceInput()?.key ?? "";
      render();
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
    body.addEventListener("contextmenu", handleContextMenu);
    body.addEventListener("wheel", handleWheel, { passive: false });
    panel.addEventListener("keydown", handleLegendKeydown);

    return () => {
      unsubscribeWorld();
      window.removeEventListener("storage", onStorage);
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
      body.removeEventListener("contextmenu", handleContextMenu);
      body.removeEventListener("wheel", handleWheel);
      panel.removeEventListener("keydown", handleLegendKeydown);
      window.clearTimeout(foundTimer);
      window.clearTimeout(titleCardTimer);
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
      onclick={() => zoomAt(stepMapZoom(mapZoom, -1), { x: 0, y: 0 })}>−</button
    >
    <span class="map-zoom-level" aria-live="polite">{formatMapZoom(mapZoom)}</span>
    <button
      class="panel-btn map-zoom-btn map-zoom-in"
      type="button"
      aria-label="Zoom map in"
      title="Zoom map in"
      disabled={mapZoom === MAP_ZOOM_LEVELS[MAP_ZOOM_LEVELS.length - 1]}
      onclick={() => zoomAt(stepMapZoom(mapZoom, 1), { x: 0, y: 0 })}>+</button
    >
    <button
      class="panel-btn map-recenter-btn"
      type="button"
      aria-label="Re-center map"
      title="Re-center map"
      onclick={recenter}>◎</button
    >
    {#if canLevelUp || canLevelDown || levelOffset !== 0}
      <span class="map-level-controls" role="group" aria-label="Map level">
        <button
          class="panel-btn map-level-btn"
          type="button"
          aria-label="Show the level above"
          title="Show the level above"
          disabled={!canLevelUp}
          onclick={() => stepLevel(1)}>▲</button
        >
        <span class="map-level-label" aria-live="polite"
          >{levelOffset === 0
            ? "Your level"
            : `${levelOffset > 0 ? "+" : ""}${levelOffset} level${Math.abs(levelOffset) === 1 ? "" : "s"}`}</span
        >
        <button
          class="panel-btn map-level-btn"
          type="button"
          aria-label="Show the level below"
          title="Show the level below"
          disabled={!canLevelDown}
          onclick={() => stepLevel(-1)}>▼</button
        >
      </span>
    {/if}
    <button
      class="panel-btn map-search-btn"
      type="button"
      aria-label="Search the map"
      title="Search the map"
      aria-expanded={searchOpen}
      onclick={toggleSearch}>⌕</button
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
  <div class="map-viewport" bind:this={viewport}>
    <div bind:this={body} class="map-body" id={`panel-body-${panelId}`}></div>
    {#if titleCard}
      {#key titleCard.key}
        <div class="map-title-card" role="status">
          <span class="map-title-card-kicker">Entering</span>
          <span class="map-title-card-name">{titleCard.name}</span>
        </div>
      {/key}
    {/if}
    {#if searchOpen}
      <div class="map-search" role="search">
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="search"
          class="map-search-input"
          placeholder="Find a room, shop, or pin"
          aria-label="Search the map"
          autocomplete="off"
          spellcheck="false"
          oninput={() => (searchActive = 0)}
          onkeydown={handleSearchKeydown}
        />
        <p class="map-search-count" aria-live="polite">
          {searchQuery.trim()
            ? `${searchResults.length} ${searchResults.length === 1 ? "room" : "rooms"} found`
            : searchResults.length
              ? "Pinned in this area"
              : "Type to search this area"}
        </p>
        {#if searchResults.length}
          <ul class="map-search-results" aria-label="Search results">
            {#each searchResults as result, index (result.id)}
              <li class:map-search-active={index === searchActive}>
                <button
                  type="button"
                  class="map-search-go"
                  aria-label={`Show ${result.name} on the map`}
                  onclick={() => goToResult(result)}
                >
                  {#if result.pin}
                    <span class={`map-search-pin map-pin-${result.pin.kind}`}>
                      <!-- Fixed icon markup from the pin helpers. -->
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html mapPinIconSvg(result.pin.kind)}
                    </span>
                  {/if}
                  <span class="map-search-name">{result.name}</span>
                  {#if resultMeta(result)}<span class="map-search-meta">{resultMeta(result)}</span
                    >{/if}
                </button>
                {#if live}
                  <button
                    type="button"
                    class="map-search-walk"
                    aria-label={`Walk to ${result.name}`}
                    title="Walk there (Shift+Enter)"
                    onclick={() => goToResult(result, true)}>Walk</button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    {#if pinEditor}
      <div
        class="map-pin-editor"
        role="dialog"
        aria-label={`Pin ${pinEditor.name}`}
        style:left={`${pinEditor.left}px`}
        style:top={`${pinEditor.top}px`}
      >
        <p class="map-pin-editor-title">{pinEditor.name}</p>
        <div class="map-pin-kinds" role="radiogroup" aria-label="Kind of pin">
          {#each MAP_PIN_KINDS as option (option.kind)}
            <button
              type="button"
              role="radio"
              class={`map-pin-kind map-pin-${option.kind}`}
              aria-checked={pinEditor.kind === option.kind}
              aria-label={option.label}
              title={option.label}
              onclick={() => setPinKind(option.kind)}
            >
              <!-- Fixed icon markup from the pin helpers. -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html mapPinIconSvg(option.kind)}
            </button>
          {/each}
        </div>
        <input
          bind:this={pinNoteInput}
          bind:value={pinEditor.note}
          class="map-pin-note"
          type="text"
          maxlength={MAX_PIN_NOTE}
          placeholder="Note (optional)"
          aria-label="Pin note"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              savePin();
            }
          }}
        />
        <div class="map-pin-actions">
          <button type="button" class="map-pin-save" onclick={savePin}>Save pin</button>
          {#if pinEditor.existing}
            <button type="button" class="map-pin-remove" onclick={deletePin}>Remove</button>
          {/if}
          <button type="button" onclick={closePinEditor}>Cancel</button>
        </div>
      </div>
    {/if}
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
          <div>
            <dt><span class="lg-ghost"></span></dt>
            <dd>Your floor, seen from another level</dd>
          </div>
          {#each MAP_PIN_KINDS as option (option.kind)}
            <div>
              <dt>
                <span class={`lg-pin map-pin-${option.kind}`}>
                  <!-- Fixed icon markup from the pin helpers. -->
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html mapPinIconSvg(option.kind)}
                </span>
              </dt>
              <dd>Your pin: {option.label.toLowerCase()} (right-click a room)</dd>
            </div>
          {/each}
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

  .map-title-card {
    position: absolute;
    top: 16%;
    left: 50%;
    z-index: 19;
    display: grid;
    justify-items: center;
    gap: 0.125rem;
    max-width: calc(100% - 1.5rem);
    padding: 0.5rem 1.5rem 0.625rem;
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0) 72%);
    pointer-events: none;
    text-align: center;
    transform: translateX(-50%);
    animation: map-title-card 3.2s ease both;
  }

  .map-title-card-kicker {
    color: #cdb88a;
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
    letter-spacing: 0.32em;
    text-transform: uppercase;
  }

  .map-title-card-name {
    padding: 0 0.75rem 0.25rem;
    border-bottom: 1px solid rgba(214, 186, 120, 0.6);
    color: #f3e3b5;
    font-family: Georgia, "Times New Roman", serif;
    font-size: calc(1.25rem * var(--pane-font-scale, 1));
    letter-spacing: 0.04em;
    text-shadow:
      0 2px 6px #000,
      0 0 14px rgba(0, 0, 0, 0.85);
  }

  @keyframes map-title-card {
    0% {
      opacity: 0;
      translate: 0 6px;
    }
    15%,
    72% {
      opacity: 1;
      translate: 0 0;
    }
    100% {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .map-title-card {
      animation: map-title-card-still 3.2s linear both;
    }

    @keyframes map-title-card-still {
      0%,
      85% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
  }

  .map-level-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    margin-left: 0.25rem;
  }

  .map-level-label {
    min-width: 4.5rem;
    color: var(--df-muted);
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
    text-align: center;
    white-space: nowrap;
  }

  .map-search {
    position: absolute;
    top: 0.375rem;
    left: 50%;
    z-index: 21;
    width: min(20rem, calc(100% - 0.75rem));
    padding: 0.375rem;
    border: 1px solid var(--df-border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--df-panel) 95%, transparent);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
    transform: translateX(-50%);
  }

  .map-search-input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--df-border);
    border-radius: 4px;
    background: var(--df-bg, #0f1115);
    color: var(--df-text);
    font: inherit;
  }

  .map-search-count {
    margin: 0.25rem 0.125rem 0;
    color: var(--df-muted);
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
  }

  .map-search-results {
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
  }

  .map-search-results li {
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    border-radius: 4px;
  }

  .map-search-results li.map-search-active {
    background: color-mix(in srgb, var(--df-accent-blue, #4aa3ff) 22%, transparent);
  }

  .map-search-go {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.125rem 0.375rem;
    min-width: 0;
    padding: 0.25rem 0.375rem;
    border: 0;
    background: none;
    color: var(--df-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .map-search-name {
    font-weight: 600;
  }

  .map-search-meta {
    color: var(--df-muted);
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
  }

  .map-search-pin :global(svg),
  .lg-pin :global(svg),
  .map-pin-kind :global(svg) {
    display: block;
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  .map-search-walk {
    padding: 0 0.5rem;
    border: 1px solid var(--df-border);
    border-radius: 4px;
    background: none;
    color: var(--df-muted);
    font: inherit;
    font-size: calc(0.625rem * var(--pane-font-scale, 1));
    cursor: pointer;
  }

  .map-pin-editor {
    position: absolute;
    z-index: 22;
    width: 15rem;
    padding: 0.5rem;
    border: 1px solid var(--df-border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--df-panel) 96%, transparent);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
    color: var(--df-text);
    font-size: calc(0.6875rem * var(--pane-font-scale, 1));
  }

  .map-pin-editor-title {
    margin: 0 0 0.375rem;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map-pin-kinds {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.375rem;
  }

  .map-pin-kind {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--df-border);
    border-radius: 50%;
    background: rgba(16, 16, 16, 0.85);
    cursor: pointer;
  }

  .map-pin-kind[aria-checked="true"] {
    box-shadow: 0 0 0 2px currentColor;
  }

  .map-pin-note {
    box-sizing: border-box;
    width: 100%;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--df-border);
    border-radius: 4px;
    background: var(--df-bg, #0f1115);
    color: var(--df-text);
    font: inherit;
  }

  .map-pin-actions {
    display: flex;
    gap: 0.25rem;
    justify-content: flex-end;
    margin-top: 0.375rem;
  }

  .map-pin-actions button {
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--df-border);
    border-radius: 4px;
    background: none;
    color: var(--df-text);
    font: inherit;
    cursor: pointer;
  }

  .map-pin-actions .map-pin-save {
    border-color: var(--df-accent-blue, #4aa3ff);
  }

  .map-pin-actions .map-pin-remove {
    color: #ef8a80;
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

  .lg-ghost {
    width: 12px;
    height: 12px;
    outline: 1px dashed rgba(170, 190, 210, 0.6);
  }

  .lg-pin {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: rgba(16, 16, 16, 0.88);
    box-shadow: 0 0 0 1px currentColor;
  }

  .lg-fog {
    width: 12px;
    height: 12px;
    background: radial-gradient(circle, rgba(190, 200, 215, 0.45), transparent 75%);
  }
</style>
