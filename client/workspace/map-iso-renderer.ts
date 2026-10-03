import type { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { WorldMapRoom, WorldMapSource } from "../runtime/world";
// @ts-expect-error Pure retained JavaScript module without declarations.
import * as isoCore from "../../public/js/map-iso-core.js";
// @ts-expect-error Retained terrain vocabulary is JavaScript without declarations.
import { getPrimaryTerrain } from "../../public/js/terrain-semantics.mjs";

const {
  ISO_FLOOR_LIFT,
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  isoAdjacentMove,
  isoBuildingSprite,
  isoDepthKey,
  isoMovementProgress,
  isoOccupantSprite,
  isoRoomVariant,
  isoTerrainColor,
  isoTerrainMotion,
  isoTerrainSprite,
  isoVisible,
  projectIso,
} = isoCore;

export interface MapOccupant {
  id: string;
  name: string;
  kind: "self" | "player" | "npc" | "pet";
  hostile?: boolean;
  elite?: boolean;
  boss?: boolean;
  level?: number;
  race?: string;
  family?: string;
  gender?: string;
  size?: string;
}

interface IsoExtras {
  ambience?: { color: string; alpha: number } | null;
  living?: boolean;
  occupants?: readonly MapOccupant[];
  pins?: Record<string, { kind?: string }>;
  tileLabel?: "walk" | "browse";
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

interface RenderInput {
  body: HTMLElement;
  source: WorldMapSource;
  extras: IsoExtras;
}

interface PixiModule {
  Application: typeof Application;
  Assets: typeof Assets;
  Container: typeof Container;
  Graphics: typeof Graphics;
  Sprite: typeof Sprite;
  Text: typeof Text;
}

interface RoomPosition {
  id: string;
  area: string;
  x: number;
  y: number;
  z: number;
}

interface LivingNode {
  node: Container;
  terrain: string;
  variant: number;
}

interface FigureNode {
  baseX: number;
  baseY: number;
  node: Container;
  phase: number;
  moving: boolean;
}

interface RoomMovement {
  from: RoomPosition;
  to: RoomPosition;
  startedAt: number;
  duration: number;
  moverIds: ReadonlySet<string>;
  screenX: number;
  screenY: number;
}

const WATER = new Set(["sea", "lake", "river", "underwater"]);
const WOODED = new Set(["forest", "jungle", "canopy"]);
const ISO_RENDER_SCALE = 2;
const MOVE_DURATION_MS = 900;
const SPATIAL_EXITS = new Set([
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
]);

const lighten = (color: number, amount: number): number => {
  const r = Math.max(0, Math.min(255, (color >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (color & 255) + amount));
  return (r << 16) | (g << 8) | b;
};

const darken = (color: number, amount: number): number => lighten(color, -amount);

function roomLabel(room: WorldMapRoom, action: IsoExtras["tileLabel"]): string {
  const name = String(room.name || "Mapped room");
  return action === "walk" ? `Speedwalk to ${name}` : `Browse ${name}`;
}

function positionedRooms(source: WorldMapSource, area: string): WorldMapRoom[] {
  return source
    .getRoomsByArea(area)
    .filter(
      (room): room is WorldMapRoom & { x: number; y: number; z: number } =>
        typeof room.x === "number" && typeof room.y === "number" && typeof room.z === "number",
    );
}

/** Pixi renderer with a DOM interaction layer matching the retained flat renderer. */
export function createIsoMapRenderer() {
  let app: Application | null = null;
  let pixi: PixiModule | null = null;
  let input: RenderInput | null = null;
  let body: HTMLElement | null = null;
  let frame: HTMLElement | null = null;
  let buttons: HTMLElement | null = null;
  let initializing: Promise<void> | null = null;
  let disposed = false;
  let view: MapView | null = null;
  let worldLayer: Container | null = null;
  let movement: RoomMovement | null = null;
  let lastCurrentRoom: RoomPosition | null = null;
  let lastOccupantIds = new Set<string>();
  let livingNodes: LivingNode[] = [];
  let figureNodes: FigureNode[] = [];
  const textures = new Map<string, Texture | null>();
  const loadingTextures = new Set<string>();

  const motionAllowed = (): boolean => body?.dataset.mapMotion !== "reduce";

  const resetAnimatedPositions = (): void => {
    worldLayer?.position.set(0, 0);
    if (buttons) buttons.style.transform = "";
    for (const { node } of livingNodes) node.position.set(0, 0);
    for (const actor of figureNodes) actor.node.position.set(actor.baseX, actor.baseY);
  };

  const animate = (): void => {
    if (!frame || !input) return;
    const now = performance.now();
    const allowed = motionAllowed();
    const living = allowed && input.extras.living === true;
    if (living) frame.dataset.mapAnimationPhase = String(Math.round(now));
    else delete frame.dataset.mapAnimationPhase;

    for (const actor of livingNodes) {
      const motion = living
        ? isoTerrainMotion(actor.terrain, now / 1_000, actor.variant)
        : { x: 0, y: 0, alpha: 0 };
      actor.node.position.set(motion.x, motion.y);
      actor.node.alpha = motion.alpha;
    }

    let figureX = 0;
    let figureY = 0;
    let cameraX = 0;
    let cameraY = 0;
    if (movement && allowed) {
      const progress = isoMovementProgress(now - movement.startedAt, movement.duration);
      cameraX = movement.screenX * (1 - progress.camera);
      cameraY = movement.screenY * (1 - progress.camera);
      figureX = -movement.screenX * (1 - progress.figure);
      figureY = -movement.screenY * (1 - progress.figure);
      frame.dataset.mapMovementProgress = String(Math.round(progress.figure * 1_000) / 1_000);
      if (progress.done) movement = null;
    } else if (movement) {
      movement = null;
    }

    worldLayer?.position.set(cameraX, cameraY);
    if (buttons) {
      buttons.style.transform = cameraX || cameraY ? `translate(${cameraX}px, ${cameraY}px)` : "";
    }
    figureNodes.forEach((actor, index) => {
      const idle = living ? Math.sin(now / 260 + actor.phase) * 1.5 : 0;
      actor.node.position.set(
        actor.baseX + (actor.moving ? figureX : 0),
        actor.baseY + (actor.moving ? figureY : 0) + idle,
      );
      actor.node.rotation = living ? Math.sin(now / 430 + index) * 0.012 : 0;
    });
    frame.dataset.mapAnimating = String(living || movement !== null);
  };

  const textureUrl = (kind: "buildings" | "characters" | "terrain", name: string): string =>
    `/assets/iso/${kind}/${name}.webp`;

  const loadTexture = (url: string): Texture | null => {
    const cached = textures.get(url);
    if (cached !== undefined) return cached;
    if (!pixi || loadingTextures.has(url)) return null;
    loadingTextures.add(url);
    void (pixi.Assets.load(url) as Promise<Texture>)
      .then((texture) => {
        loadingTextures.delete(url);
        textures.set(url, texture);
        if (!disposed) draw();
      })
      .catch(() => {
        loadingTextures.delete(url);
        textures.set(url, null);
      });
    return null;
  };

  const clearStage = (): void => {
    if (!app) return;
    for (const child of app.stage.removeChildren()) child.destroy({ children: true });
  };

  const mount = (nextBody: HTMLElement): void => {
    if (body === nextBody && frame?.isConnected) return;
    if (app) {
      app.destroy(true, { children: true });
      app = null;
      initializing = null;
    }
    body = nextBody;
    frame = document.createElement("div");
    frame.className = "map-grid-frame map-iso-frame";
    frame.dataset.mapProjection = "iso";
    const canvasHost = document.createElement("div");
    canvasHost.className = "map-iso-canvas";
    buttons = document.createElement("div");
    buttons.className = "map-iso-rooms";
    frame.append(canvasHost, buttons);
    nextBody.replaceChildren(frame);
  };

  const ensurePixi = (): void => {
    if (!body || !frame || app || initializing) return;
    const host = frame.querySelector<HTMLElement>(".map-iso-canvas");
    if (!host) return;
    initializing = import("pixi.js").then(async (module) => {
      if (disposed || !body || !host.isConnected) return;
      pixi = module as unknown as PixiModule;
      const next = new pixi.Application();
      await next.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        height: Math.max(1, body.clientHeight),
        preference: "webgl",
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        width: Math.max(1, body.clientWidth),
      });
      if (disposed || !host.isConnected) {
        next.destroy(true, { children: true });
        return;
      }
      app = next;
      app.canvas.setAttribute("aria-hidden", "true");
      host.append(app.canvas);
      app.ticker.add(animate);
      draw();
    });
  };

  const addTerrainDetails = (
    layer: Container,
    terrain: string,
    x: number,
    y: number,
    width: number,
    height: number,
    variant: number,
  ): void => {
    if (!pixi) return;
    if (WATER.has(terrain)) {
      for (let index = 0; index < 3; index += 1) {
        const offset = (index - 1) * height * 0.14;
        layer.addChild(
          new pixi.Graphics()
            .moveTo(x - width * 0.25, y + offset)
            .lineTo(x, y + height * 0.12 + offset)
            .lineTo(x + width * 0.25, y + offset)
            .stroke({ color: 0x9ed2dc, alpha: 0.5, width: 1 }),
        );
      }
    } else if (WOODED.has(terrain)) {
      for (let index = 0; index < 2 + variant; index += 1) {
        const treeX = x + (index - 1) * width * 0.13;
        const treeY = y - height * (0.05 + (index % 2) * 0.14);
        layer.addChild(
          new pixi.Graphics()
            .moveTo(treeX, treeY - height * 0.55)
            .lineTo(treeX - width * 0.09, treeY + height * 0.05)
            .lineTo(treeX + width * 0.09, treeY + height * 0.05)
            .closePath()
            .fill({ color: index % 2 ? 0x20492f : 0x2f6940 })
            .rect(treeX - 1.5, treeY, 3, height * 0.24)
            .fill({ color: 0x4d3826 }),
        );
      }
    } else if (terrain === "mountain" || terrain === "hills") {
      layer.addChild(
        new pixi.Graphics()
          .moveTo(x - width * 0.24, y + height * 0.1)
          .lineTo(x, y - height * (terrain === "mountain" ? 0.85 : 0.45))
          .lineTo(x + width * 0.25, y + height * 0.1)
          .closePath()
          .fill({ color: terrain === "mountain" ? 0x858886 : 0x6f8154 })
          .moveTo(x, y - height * (terrain === "mountain" ? 0.85 : 0.45))
          .lineTo(x + width * 0.25, y + height * 0.1)
          .lineTo(x + width * 0.04, y - height * 0.05)
          .closePath()
          .fill({ color: 0x505852, alpha: 0.7 }),
      );
    }
  };

  const addLivingTerrain = (
    layer: Container,
    terrain: string,
    x: number,
    y: number,
    width: number,
    height: number,
    variant: number,
  ): void => {
    if (!pixi || (!WATER.has(terrain) && terrain !== "swamp")) return;
    let node: Graphics;
    if (terrain === "swamp") {
      node = new pixi.Graphics()
        .ellipse(x - width * 0.12, y - height * 0.16, width * 0.2, height * 0.1)
        .ellipse(x + width * 0.12, y - height * 0.3, width * 0.16, height * 0.08)
        .fill({ color: 0xd8e5d4 });
    } else {
      node = new pixi.Graphics();
      const slant = terrain === "river" ? height * 0.1 : 0;
      for (let index = 0; index < 3; index += 1) {
        const offset = (index - 1) * height * 0.14;
        node
          .moveTo(x - width * 0.24, y + offset - slant)
          .quadraticCurveTo(x, y + height * 0.1 + offset, x + width * 0.24, y + offset + slant)
          .stroke({ color: 0xd7f5ff, width: Math.max(1, width / 128) });
      }
    }
    node.alpha = 0;
    layer.addChild(node);
    livingNodes.push({ node, terrain, variant });
  };

  const addExits = (
    layer: Container,
    room: WorldMapRoom,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    if (!pixi) return;
    const points: Record<string, [number, number]> = {
      north: [x + width * 0.25, y - height * 0.25],
      northeast: [x + width * 0.38, y],
      east: [x + width * 0.25, y + height * 0.25],
      southeast: [x, y + height * 0.42],
      south: [x - width * 0.25, y + height * 0.25],
      southwest: [x - width * 0.38, y],
      west: [x - width * 0.25, y - height * 0.25],
      northwest: [x, y - height * 0.42],
    };
    for (const direction of Object.keys(room.exits ?? {})) {
      if (!SPATIAL_EXITS.has(direction)) continue;
      const point = points[direction];
      if (!point) continue;
      const door = Number(room.exitDoors?.[direction]) || 0;
      layer.addChild(
        new pixi.Graphics()
          .moveTo(x, y)
          .lineTo(point[0], point[1])
          .stroke({
            color: door >= 3 ? 0xd4584d : door >= 2 ? 0xc99954 : 0xd8d0ad,
            alpha: 0.9,
            width: door ? 4 : 2,
          }),
      );
    }
    if (room.exits?.up !== undefined || room.exits?.down !== undefined) {
      const glyph =
        room.exits?.up !== undefined && room.exits?.down !== undefined
          ? "UD"
          : room.exits?.up !== undefined
            ? "U"
            : "D";
      const label = new pixi.Text({
        text: glyph,
        style: { fill: 0xf4e4ae, fontFamily: "sans-serif", fontSize: 9, fontWeight: "bold" },
      });
      label.anchor.set(0.5);
      label.position.set(x - width * 0.28, y);
      layer.addChild(label);
    }
  };

  const addBuildings = (
    layer: Container,
    room: WorldMapRoom,
    terrain: string,
    x: number,
    y: number,
    width: number,
    height: number,
    paintedTerrain: boolean,
  ): number => {
    if (!pixi) return 0;
    const module = pixi;
    const details = Array.isArray(room.details) ? room.details.map(String) : [];
    if (terrain === "inside" && !paintedTerrain) {
      layer.addChild(
        new module.Graphics()
          .moveTo(x - width / 2, y)
          .lineTo(x, y - height / 2)
          .lineTo(x, y - height * 0.72)
          .lineTo(x - width / 2, y - height * 0.2)
          .closePath()
          .fill({ color: 0x4a382f, alpha: 0.85 })
          .moveTo(x, y - height / 2)
          .lineTo(x + width / 2, y)
          .lineTo(x + width / 2, y - height * 0.2)
          .lineTo(x, y - height * 0.72)
          .closePath()
          .fill({ color: 0x5a4435, alpha: 0.82 }),
      );
    }
    const letters: Record<string, string> = {
      bank: "B",
      guild: "G",
      post: "M",
      pub: "P",
      shop: "S",
    };
    let painted = 0;
    const visibleDetails = details.slice(0, 4);
    visibleDetails.forEach((detail, index) => {
      const propX = x + (index - (visibleDetails.length - 1) / 2) * width * 0.32;
      const propY = y - height * 0.35 - (index % 2) * 4;
      const spriteName = isoBuildingSprite(detail);
      const texture = spriteName ? loadTexture(textureUrl("buildings", String(spriteName))) : null;
      if (texture) {
        const sprite = new module.Sprite(texture);
        const side = width * (visibleDetails.length === 1 ? 0.82 : 0.35);
        sprite.anchor.set(0.5, 0.82);
        sprite.position.set(propX, y + height * 0.1 - (index % 2) * 3);
        sprite.width = side;
        sprite.height = side;
        layer.addChild(sprite);
        painted += 1;
        return;
      }
      layer.addChild(
        new module.Graphics()
          .roundRect(propX - 9, propY - 15, 18, 18, 2)
          .fill({ color: detail === "bank" ? 0xb5b8ad : 0x8d4f3c })
          .stroke({ color: 0x271d19, width: 1 }),
      );
      const label = new module.Text({
        text: letters[detail] ?? detail.charAt(0).toUpperCase(),
        style: { fill: 0xffedc2, fontFamily: "sans-serif", fontSize: 11, fontWeight: "bold" },
      });
      label.anchor.set(0.5);
      label.position.set(propX, propY - 5);
      layer.addChild(label);
    });
    return painted;
  };

  const addOccupants = (
    layer: Container,
    occupants: readonly MapOccupant[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): number => {
    if (!pixi) return 0;
    const module = pixi;
    const visible = occupants.slice(0, 8);
    let painted = 0;
    visible.forEach((occupant, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const figureX = x + (column - (Math.min(visible.length, 4) - 1) / 2) * width * 0.22;
      const figureY = y + height * (0.38 - row * 0.28);
      const actor = new module.Container();
      actor.position.set(figureX, figureY);
      layer.addChild(actor);
      const ring =
        occupant.kind === "self"
          ? 0xf1c75b
          : occupant.hostile
            ? 0xd9574f
            : occupant.kind === "player"
              ? 0x55a6d8
              : 0xb4aa91;
      const ringGraphic = new module.Graphics()
        .ellipse(0, 7, 11, 5)
        .stroke({ color: ring, alpha: 0.95, width: 2 });
      actor.addChild(ringGraphic);
      const texture = loadTexture(textureUrl("characters", String(isoOccupantSprite(occupant))));
      if (texture) {
        const sprite = new module.Sprite(texture);
        const side = width * 0.3;
        sprite.anchor.set(0.5, 0.9);
        sprite.position.set(0, 8);
        sprite.width = side;
        sprite.height = side;
        actor.addChild(sprite);
        painted += 1;
      } else {
        actor.addChild(
          new module.Graphics()
            .circle(0, -18, 5)
            .fill({ color: occupant.kind === "self" ? 0xf0d6a2 : 0xd4c7ac })
            .moveTo(-8, 4)
            .lineTo(0, -15)
            .lineTo(8, 4)
            .closePath()
            .fill({ color: occupant.kind === "player" ? 0x477da4 : 0x625b53 }),
        );
      }
      if (occupant.elite || occupant.boss) {
        actor.addChild(
          new module.Graphics().circle(0, -27, occupant.boss ? 3 : 2).fill({ color: 0xefcb61 }),
        );
      }
      figureNodes.push({
        baseX: figureX,
        baseY: figureY,
        node: actor,
        phase: isoRoomVariant(occupant.id, 11) * 0.57,
        moving: Boolean(
          movement && (occupant.kind === "self" || movement.moverIds.has(occupant.id)),
        ),
      });
    });
    if (occupants.length > visible.length) {
      const more = new module.Text({
        text: `+${occupants.length - visible.length}`,
        style: { fill: 0xffffff, fontFamily: "sans-serif", fontSize: 10, fontWeight: "bold" },
      });
      more.anchor.set(0.5);
      more.position.set(x + width * 0.26, y - height * 0.2);
      layer.addChild(more);
    }
    return painted;
  };

  const draw = (): void => {
    if (!app || !pixi || !input || !body || !frame || !buttons) return;
    const { source, extras } = input;
    const width = Math.max(1, body.clientWidth);
    const height = Math.max(1, body.clientHeight);
    app.renderer.resize(width, height);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    buttons.replaceChildren();
    clearStage();
    worldLayer = null;
    livingNodes = [];
    figureNodes = [];

    const currentId = source.getCurrentRoomId();
    const currentRoomId = currentId === null ? null : String(currentId);
    const current = source.getRoom(currentId);
    const fallback = source.getRoomsByArea()[0] ?? null;
    const center = current?.x != null ? current : fallback;
    if (!center || typeof center.x !== "number" || typeof center.y !== "number") {
      const empty = document.createElement("p");
      empty.className = "map-empty-msg";
      empty.textContent = "No positioned map data yet. Explore to build the map.";
      buttons.append(empty);
      view = null;
      return;
    }
    const currentPosition: RoomPosition | null =
      current &&
      typeof current.x === "number" &&
      typeof current.y === "number" &&
      typeof current.z === "number"
        ? {
            id: String(current.id),
            area: String(current.area ?? ""),
            x: current.x,
            y: current.y,
            z: current.z,
          }
        : null;
    if (currentPosition?.id !== lastCurrentRoom?.id) {
      movement =
        lastCurrentRoom && currentPosition && isoAdjacentMove(lastCurrentRoom, currentPosition)
          ? {
              from: lastCurrentRoom,
              to: currentPosition,
              startedAt: performance.now(),
              duration: MOVE_DURATION_MS,
              moverIds: new Set(lastOccupantIds),
              screenX: 0,
              screenY: 0,
            }
          : null;
      lastCurrentRoom = currentPosition;
    }
    const centerX = center.x;
    const centerY = center.y;
    const zoom = Number(body.dataset.mapZoom) || 1;
    const tileWidth = ISO_TILE_WIDTH * zoom * ISO_RENDER_SCALE;
    const tileHeight = ISO_TILE_HEIGHT * zoom * ISO_RENDER_SCALE;
    const floorLift = ISO_FLOOR_LIFT * zoom * ISO_RENDER_SCALE;
    const panX = Number(body.dataset.mapPanX) || 0;
    const panY = Number(body.dataset.mapPanY) || 0;
    const homeZ = Number(center.z) || 0;
    const levelOffset = Number(body.dataset.mapLevel) || 0;
    const viewZ = homeZ + levelOffset;
    const area = String(center.area || "");
    const rooms = positionedRooms(source, area);
    const levels = [...new Set(rooms.map((room) => Number(room.z)))].sort((a, b) => a - b);
    view = {
      area,
      levels,
      viewZ,
      homeZ,
      levelOffset,
      centerX,
      centerY,
      pitch: tileWidth,
    };
    frame.dataset.mapPitch = String(tileWidth);
    frame.dataset.mapPitchX = String(tileWidth);
    frame.dataset.mapPitchY = String(tileHeight);
    frame.dataset.mapPanOffsetX = "0";
    frame.dataset.mapPanOffsetY = "0";
    frame.dataset.mapOccupants = String(extras.occupants?.length ?? 0);

    if (movement) {
      const offset = projectIso(movement.to.x, movement.to.y, movement.to.z, {
        centerX: movement.from.x,
        centerY: movement.from.y,
        centerZ: movement.from.z,
        floorLift,
        height: tileHeight,
        width: tileWidth,
      });
      movement.screenX = offset.x;
      movement.screenY = offset.y;
    }

    const ground = new pixi.Container();
    const features = new pixi.Container();
    const figures = new pixi.Container();
    const world = new pixi.Container();
    world.addChild(ground, features, figures);
    worldLayer = world;
    app.stage.addChild(world);
    const visibleRooms = rooms
      .filter((room) => room.z === viewZ)
      .map((room) => ({
        room,
        point: projectIso(room.x!, room.y!, room.z!, {
          centerX: centerX - panX,
          centerY: centerY - panY,
          centerZ: viewZ,
          floorLift,
          height: tileHeight,
          width: tileWidth,
        }),
      }))
      .map(({ room, point }) => ({
        room,
        point: { x: point.x + width / 2, y: point.y + height / 2 },
      }))
      .filter(({ point }) => isoVisible(point, { width, height }, tileWidth))
      .sort((a, b) => isoDepthKey(a.room) - isoDepthKey(b.room));

    let paintedSprites = 0;
    let paintedTerrainSprites = 0;
    for (const { room, point } of visibleRooms) {
      const terrain = String(getPrimaryTerrain(room.environment));
      const color = isoTerrainColor(terrain);
      const diamond = new pixi.Graphics()
        .moveTo(point.x, point.y - tileHeight / 2)
        .lineTo(point.x + tileWidth / 2, point.y)
        .lineTo(point.x, point.y + tileHeight / 2)
        .lineTo(point.x - tileWidth / 2, point.y)
        .closePath()
        .fill({ color: lighten(color, isoRoomVariant(room.id, 3) * 5), alpha: 0.98 })
        .stroke({ color: darken(color, 30), alpha: 0.9, width: Math.max(1, zoom) });
      ground.addChild(diamond);
      const terrainTexture = loadTexture(textureUrl("terrain", String(isoTerrainSprite(terrain))));
      if (terrainTexture) {
        const terrainSprite = new pixi.Sprite(terrainTexture);
        terrainSprite.anchor.set(0.5, 0.6);
        terrainSprite.position.set(point.x, point.y);
        terrainSprite.width = tileWidth;
        terrainSprite.height = tileWidth;
        ground.addChild(terrainSprite);
        paintedTerrainSprites += 1;
      } else {
        addTerrainDetails(
          features,
          terrain,
          point.x,
          point.y,
          tileWidth,
          tileHeight,
          isoRoomVariant(room.id, 3),
        );
      }
      addLivingTerrain(
        features,
        terrain,
        point.x,
        point.y,
        tileWidth,
        tileHeight,
        isoRoomVariant(room.id, 7),
      );
      addExits(features, room, point.x, point.y, tileWidth, tileHeight);
      paintedSprites += addBuildings(
        features,
        room,
        terrain,
        point.x,
        point.y,
        tileWidth,
        tileHeight,
        Boolean(terrainTexture),
      );

      if (extras.pins?.[room.id]) {
        features.addChild(
          new pixi.Graphics()
            .circle(point.x + tileWidth * 0.31, point.y - tileHeight * 0.18, 4 * zoom)
            .fill({ color: 0xf0c55a })
            .stroke({ color: 0x342811, width: 1 }),
        );
      }
      if (String(room.id) === currentRoomId && extras.occupants?.length) {
        paintedSprites += addOccupants(
          figures,
          extras.occupants,
          point.x,
          point.y,
          tileWidth,
          tileHeight,
        );
      }

      const button = document.createElement("div");
      button.className = `map-tile map-tile-room map-iso-room map-tile-${terrain}${String(room.id) === currentRoomId ? " map-tile-player" : ""}`;
      button.dataset.roomId = room.id;
      button.setAttribute("role", "button");
      button.setAttribute("tabindex", "0");
      button.setAttribute("aria-label", roomLabel(room, extras.tileLabel));
      button.style.left = `${point.x - tileWidth / 2}px`;
      button.style.top = `${point.y - tileHeight / 2}px`;
      button.style.width = `${tileWidth}px`;
      button.style.height = `${tileHeight}px`;
      buttons.append(button);
    }
    frame.dataset.mapSprites = String(paintedSprites);
    frame.dataset.mapTerrainSprites = String(paintedTerrainSprites);
    frame.dataset.mapLivingLayers = String(livingNodes.length);
    frame.dataset.mapMovingSprites = String(figureNodes.filter(({ moving }) => moving).length);
    if (extras.occupants?.length) {
      lastOccupantIds = new Set(extras.occupants.map(({ id }) => id));
    }

    if (extras.ambience?.alpha) {
      app.stage.addChild(
        new pixi.Graphics()
          .rect(0, 0, width, height)
          .fill({ color: extras.ambience.color, alpha: extras.ambience.alpha }),
      );
    }
    animate();
  };

  return {
    render(nextBody: HTMLElement, source: WorldMapSource, extras: IsoExtras = {}): void {
      if (disposed) return;
      input = { body: nextBody, source, extras };
      mount(nextBody);
      if (app) draw();
      else ensurePixi();
    },
    getView(): MapView | null {
      return view;
    },
    dispose(): void {
      disposed = true;
      resetAnimatedPositions();
      input = null;
      view = null;
      movement = null;
      lastCurrentRoom = null;
      lastOccupantIds.clear();
      livingNodes = [];
      figureNodes = [];
      worldLayer = null;
      clearStage();
      app?.destroy(true, { children: true });
      app = null;
      body = null;
      frame = null;
      buttons = null;
    },
  };
}
