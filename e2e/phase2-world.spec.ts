import { Buffer } from "node:buffer";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TransportFixtureOwner, type TransportEndpoint } from "./fixtures/transport-fixtures";

let fixtures: TransportFixtureOwner;

test.beforeAll(async () => {
  fixtures = await TransportFixtureOwner.start();
});

test.afterAll(async () => {
  await fixtures.close();
});

async function connect(page: Page): Promise<TransportEndpoint> {
  const endpoint = fixtures.endpoints.ws;
  await page.goto("/phase2/");
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Port", { exact: true }).fill(String(endpoint.port));
  await page.getByLabel("Connection protocol").selectOption("ws");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
  return endpoint;
}

async function togglePanel(page: Page, title: string): Promise<void> {
  const onMobile = (page.viewportSize()?.width ?? Infinity) <= 700;
  await page.getByRole("button", { name: "Panels", exact: true }).click();
  if (onMobile) {
    // Mobile sheet uses Open/Close buttons and closes on selection.
    await page
      .getByRole("dialog", { name: "Panels", exact: true })
      .getByRole("button", { name: new RegExp(`^(?:Open|Close) ${title}$`) })
      .click();
  } else {
    // Desktop launcher is a checkbox list that stays open while toggling.
    await page.getByRole("checkbox", { name: title, exact: true }).click();
    await page.keyboard.press("Escape");
  }
}

function panelDragHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-panel-drag-handle][data-panel-id="${panelId}"]`);
}

async function dockPanelAsTab(page: Page, panelId: string, targetPanelId: string): Promise<void> {
  const source = await panelDragHandle(page, panelId)
    .locator(".dv-default-tab-content")
    .boundingBox();
  const target = await panelDragHandle(page, targetPanelId)
    .locator(".dv-default-tab-content")
    .boundingBox();

  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function dragPanelToRail(page: Page, panelId: string, side: "left" | "right"): Promise<void> {
  const source = await panelDragHandle(page, panelId)
    .locator(".dv-default-tab-content")
    .boundingBox();
  const rail = await page.locator(`[data-rail="${side}"]`).boundingBox();
  expect(source).not.toBeNull();
  expect(rail).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rail!.x + rail!.width / 2, rail!.y + 40, { steps: 12 });
  await page.mouse.up();
}

function currentRoom(id: number, name: string, x: number, exits: Record<string, number> = {}) {
  return {
    protocol: 2,
    mapEpoch: "fixture-epoch",
    areaGeneration: 1,
    areaVersion: 1,
    id,
    name,
    area: "Fixture Town",
    positioned: 1,
    x,
    y: 0,
    z: 0,
    exits,
    liveExits: exits,
    liveDoors: {},
    walkSafe: Object.fromEntries(Object.keys(exits).map((direction) => [direction, 1])),
  };
}

const playlistState = {
  enabled: 1,
  room_id: 101,
  revision: 7,
  server_time: Math.floor(Date.now() / 1_000),
  name: "Fixture Jukebox",
  playback: {
    status: "playing",
    position: 3,
    start_at: Math.floor(Date.now() / 1_000) - 1,
    current: {
      id: 9,
      video_id: "dQw4w9WgXcQ",
      title: "Current video",
      added_by: "Nacho",
      duration: 212,
      can_remove: 0,
    },
  },
  queue: [
    {
      id: 10,
      video_id: "M7lc1UVf-VE",
      title: "Next video",
      added_by: "Denian",
      duration: 95,
      can_remove: 32,
    },
    {
      id: 12,
      video_id: "aqz-KE-bpKQ",
      title: "Second queued video",
      added_by: "Lydia",
      duration: 596,
      can_remove: 1,
    },
  ],
  skip_votes: 1,
  skip_needed: 2,
  permissions: { add: 1, moderate: 32 },
};

test("room and chat panels render session-owned GMCP state and clear on disconnect", async ({
  page,
}) => {
  const endpoint = await connect(page);
  const room = page.locator('.room-panel[data-panel-id="room"]');
  const chat = page.locator('.chat-panel[data-panel-id="chat"]');
  if ((await room.count()) === 0) await togglePanel(page, "Room");
  if ((await chat.count()) === 0) await togglePanel(page, "Chat");
  await expect(page.locator('[data-panel-drag-handle][data-panel-id="chat"]')).toBeVisible();
  await expect(chat).toContainText("No messages.");

  endpoint.sendGmcp("Room.Info", {
    num: 101,
    name: "Atrium",
    area: "Fixture Town",
    environment: "Inside",
    exits: { north: 102, east: 103 },
    exit_states: { east: "closed" },
  });
  endpoint.sendGmcp("Room.Players", [{ name: "Alice", fullname: "Alice Example" }]);
  endpoint.sendGmcp("Room.AddPlayer", { name: "Bob" });
  endpoint.sendGmcp("Room.RemovePlayer", "Alice");
  await expect(room).toContainText("Atrium");
  await expect(room).toContainText("Fixture Town");
  await expect(room).toContainText("Players: Bob");
  await expect(room.getByRole("button", { name: "Go east" })).toHaveCount(0);
  await room.getByRole("button", { name: "Go north" }).click();
  await expect.poll(() => endpoint.commands).toContain("north");

  endpoint.sendGmcp("Comm.Channel.List", [
    { name: "gossip", caption: "Gossip" },
    { name: "tell", caption: "Tells" },
  ]);
  endpoint.sendGmcp("Comm.Channel.Players", [{ name: "Alice" }, { name: "Bob" }]);
  endpoint.sendGmcp("Comm.Channel.Start", "gossip");
  const message = { channel: "gossip", talker: "alice", text: "[gossip] Alice: Hello there." };
  endpoint.sendGmcp("Comm.Channel.Text", {
    ...message,
    ansi: "\u001b[31m[gossip] Alice: Hello there.",
  });
  endpoint.sendGmcp("Comm.Channel", {
    channel: "tell",
    talker: "bob",
    text: "Bob: A private message.",
  });
  const outgoingTell = {
    channel: "tell",
    talker: "",
    text: "You tell Bob: Hello.",
  };
  endpoint.sendGmcp("Comm.Channel.Text", outgoingTell);
  endpoint.sendGmcp("Comm.Channel.Text", outgoingTell);
  endpoint.sendGmcp("Comm.Channel.Text", {
    channel: "emote",
    talker: "",
    text: "You smile.",
  });
  endpoint.sendGmcp("Comm.Channel", {
    channel: "events",
    text: "[Events] Lottery: Tickets are now on sale.",
  });
  endpoint.sendGmcp("Comm.Channel", {
    channel: "lunar",
    text: "[LUNAR ANNOUNCE] A new Lunar Mage has arrived.",
  });
  endpoint.sendGmcp("Comm.Channel.Text", {
    channel: "ansi256",
    text: "256 color",
    ansi: "\u001b[38;5;208m256 color",
  });
  endpoint.sendGmcp("Comm.Channel.Text", {
    channel: "rgb",
    text: "RGB color",
    ansi: "\u001b[38;2;1;2;3mRGB color",
  });
  endpoint.sendGmcp("Comm.Channel.Text", {
    channel: "fallback",
    text: "fallback color",
    ansi: "\u001b[1;48;5;1mfallback color",
  });
  endpoint.sendGmcp("Comm.Channel.Text", {
    channel: "fallback",
    text: "out-of-range ANSI color",
    ansi: "\u001b[38;5;999mout-of-range ANSI color",
  });
  const duplicate = { channel: "duplicate", text: "Duplicate aliases" };
  endpoint.sendGmcp("Comm.Channel", duplicate);
  endpoint.sendGmcp("Comm.Channel.Text", duplicate);
  await expect(chat).toContainText("Gossip");
  await expect(chat).toContainText("2 online");
  await expect(chat).toContainText("[gossip] Alice: Hello there.");
  await expect(chat.locator(".chat-entry")).toHaveCount(11);
  await expect(chat).toContainText("A private message.");
  await expect(chat).toContainText("[tell] You tell Bob: Hello.");
  await expect(chat).toContainText("[emote] You smile.");
  await expect(
    chat.locator(".chat-entry").filter({ hasText: "You tell Bob: Hello." }).locator(".talker"),
  ).toHaveCount(0);
  await expect(
    chat.locator(".chat-entry").filter({ hasText: "You smile." }).locator(".talker"),
  ).toHaveCount(0);
  await expect(chat.locator(".chat-entry").nth(4)).toHaveText(
    "[events] Lottery: Tickets are now on sale.",
  );
  await expect(chat.locator(".chat-entry").nth(5)).toHaveText(
    "[lunar] [LUNAR ANNOUNCE] A new Lunar Mage has arrived.",
  );
  await expect(chat.locator(".chat-entry").nth(0).locator(".channel-label span")).toHaveCSS(
    "color",
    "rgb(205, 0, 0)",
  );
  await expect(chat.locator(".chat-entry").nth(6).locator(".channel-label span")).toHaveCSS(
    "color",
    "rgb(255, 135, 0)",
  );
  await expect(chat.locator(".chat-entry").nth(7).locator(".channel-label span")).toHaveCSS(
    "color",
    "rgb(1, 2, 3)",
  );
  await expect(chat.locator(".chat-entry").nth(8).locator(".channel-label")).toHaveCSS(
    "color",
    "rgb(219, 112, 180)",
  );
  await expect(chat.locator(".chat-entry").nth(9).locator(".channel-label")).toHaveCSS(
    "color",
    "rgb(219, 112, 180)",
  );

  for (let index = 0; index < 40; index += 1) {
    endpoint.sendGmcp("Comm.Channel", {
      channel: "gossip",
      talker: "alice",
      text: `[gossip] Alice: Scrolling message ${index + 1}.`,
    });
  }
  const chatLog = chat.getByRole("log", { name: "Chat messages" });
  await expect(chat.locator(".chat-entry")).toHaveCount(51);
  await expect
    .poll(() =>
      chatLog.evaluate((element) => ({
        atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
        overflowY: getComputedStyle(element).overflowY,
        scrollable: element.scrollHeight > element.clientHeight,
      })),
    )
    .toEqual({ atBottom: true, overflowY: "auto", scrollable: true });

  endpoint.dropConnections();
  await expect(room).toContainText("No room data.");
  await expect(chat).toContainText("No messages.");
});

test("main panel close controls remove panels and allow reopening", async ({ page }) => {
  await connect(page);
  for (const [title, id] of [
    ["Map", "map"],
    ["Room Image", "roomImage"],
    ["Jukebox", "roomPlaylist"],
  ]) {
    await togglePanel(page, title!);
    const header = panelDragHandle(page, id!);
    await header.getByRole("button", { name: `Close ${title}`, exact: true }).click();
    await expect(header).toHaveCount(0);
    await togglePanel(page, title!);
    await expect(header).toBeVisible();
    await header.getByRole("button", { name: `Close ${title}`, exact: true }).click();
  }
  await expect(page.getByRole("textbox", { name: "Command input" })).toBeVisible();
});

test("map and room image reset across reconnect and remount after session disposal", async ({
  page,
}) => {
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  await togglePanel(page, "Room Image");
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0));
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/assets/brand/darkflow-icon-64.png",
    name: "Atrium",
  });

  const map = page.locator('.map-panel[data-panel-id="map"]');
  const roomImage = page.locator('.room-image-panel[data-panel-id="roomImage"]');
  await expect(map.getByRole("button", { name: "Speedwalk to Atrium" })).toBeVisible();
  await expect(roomImage.getByRole("img", { name: "Atrium" })).toBeVisible();
  const refreshesBeforeReconnect = endpoint.gmcpMessages.filter(
    (message) => message === "Darkwind.Client.RefreshMedia",
  ).length;
  await map.evaluate((element) =>
    element.closest("[data-workspace-root-id]")?.setAttribute("data-world-instance", "map-old"),
  );
  await roomImage.evaluate((element) =>
    element.closest("[data-workspace-root-id]")?.setAttribute("data-world-instance", "image-old"),
  );

  endpoint.dropConnections();
  await expect(roomImage.getByRole("img")).toHaveCount(0);
  await expect(page.locator('[data-world-instance="map-old"]')).toHaveCount(1);
  await expect(page.locator('[data-world-instance="image-old"]')).toHaveCount(1);

  await expect(page.locator("#connect-btn")).toHaveText(/Retrying in \d+s/);
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
  await expect
    .poll(() =>
      endpoint.gmcpMessages
        .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
        .at(-1),
    )
    .toContain('"map":true');
  expect(
    endpoint.gmcpMessages
      .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
      .at(-1),
  ).toContain('"roomImage":true');
  expect(
    endpoint.gmcpMessages
      .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
      .at(-1),
  ).toContain('"channelTerminalSuppression":false');
  await expect
    .poll(
      () =>
        endpoint.gmcpMessages.filter((message) => message === "Darkwind.Client.RefreshMedia")
          .length,
    )
    .toBeGreaterThan(refreshesBeforeReconnect);
  endpoint.sendGmcp("Darkwind.Session.Recovered", { mode: "linkdead" });
  await expect
    .poll(() =>
      endpoint.gmcpMessages
        .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
        .at(-1),
    )
    .toContain('"reason":"session-recovered"');
  expect(
    endpoint.gmcpMessages
      .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
      .at(-1),
  ).toContain('"map":true');
  expect(
    endpoint.gmcpMessages
      .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
      .at(-1),
  ).toContain('"roomImage":true');
  expect(
    endpoint.gmcpMessages
      .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
      .at(-1),
  ).toContain('"channelTerminalSuppression":false');
  expect(endpoint.gmcpMessages).toContain("Darkwind.Client.RefreshMedia");
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0));
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/assets/brand/darkflow-icon-64.png?reconnected=1",
    name: "Atrium",
  });
  await expect(roomImage.getByRole("img", { name: "Atrium" })).toBeVisible();
  await expect(page.locator('[data-world-instance="map-old"]')).toHaveCount(1);
  await expect(page.locator('[data-world-instance="image-old"]')).toHaveCount(1);

  await page.evaluate(() => {
    (
      window as unknown as { __darkflowPhase1Runtime: { session: { dispose(): void } } }
    ).__darkflowPhase1Runtime.session.dispose();
  });
  await expect(map).toHaveCount(0);
  await expect(roomImage).toHaveCount(0);

  await connect(page);
  if ((await map.count()) === 0) await togglePanel(page, "Map");
  if ((await roomImage.count()) === 0) await togglePanel(page, "Room Image");
  await expect(map).toBeVisible();
  await expect(roomImage).toBeVisible();
  await expect(page.locator("[data-world-instance]")).toHaveCount(0);
});

test.describe("room combat", () => {
  test.use({ deviceScaleFactor: 2 });
  test("isometric room renders one terrain scene with services, exits, and occupants", async ({
    page,
  }, testInfo) => {
    const endpoint = await connect(page);
    await togglePanel(page, "Isometric Room");
    const isoRoom = page.locator('.iso-room-panel[data-panel-id="isoMap"]');

    endpoint.sendGmcp("Room.Info", {
      num: 101,
      name: "Market Atrium",
      area: "Fixture Town",
      environment: "inside, city",
      details: ["shop", "bank", "pub"],
      scene: { time: "dusk", weather: "rain", lighting: "fire" },
      looks: [
        {
          id: "marble-fountain",
          name: "a marble fountain",
          nouns: ["fountain", "water"],
          sprite: "fountain",
          state: "active",
          verbs: ["drink"],
          position: { x: 22, y: 58 },
        },
        {
          id: "market-stall",
          name: "a canvas market stall",
          nouns: ["stall", "market"],
          sprite: "market-stall",
          verbs: ["browse"],
          position: { x: 73, y: 52 },
        },
        {
          id: "forge-anvil",
          name: "a scarred blacksmith anvil",
          nouns: ["anvil", "forge"],
          sprite: "anvil",
          category: "workplace",
          position: { x: 79, y: 68 },
        },
        {
          id: "old-grave",
          name: "an old memorial stone",
          nouns: ["memorial", "stone"],
          sprite: "gravestone",
          cue: "quest",
          verbs: ["read", "search"],
          position: { x: 14, y: 74 },
        },
        {
          id: "abandoned-loot",
          name: "a dropped leather satchel",
          nouns: ["satchel", "loot"],
          sprite: "loot",
          category: "item",
          cue: "loot",
          verbs: ["get", "search"],
          position: { x: 48, y: 76 },
        },
        {
          id: "watch-fire",
          name: "a watch fire",
          nouns: ["fire", "campfire"],
          sprite: "campfire",
          state: "lit",
          verbs: ["warm"],
          position: { x: 32, y: 72 },
        },
      ],
      exits: { east: 102, south: 103, north: 104, up: 105 },
      exit_states: { east: "closed" },
      exit_details: {
        east: { kind: "door" },
        south: { kind: "path", label: "Road" },
        north: { kind: "portal", label: "Rift" },
        up: { kind: "stairs" },
      },
    });
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      version: 1,
      room: 101,
      mode: "snapshot",
      revision: 1,
      dark: 0,
      more: 0,
      upsert: [
        {
          id: "self",
          name: "Nacho",
          kind: "self",
          race: "human",
          weapon: "long sword",
          shield: 1,
          armor: "plate",
          fighting: 1,
          engaged_with: "giant",
        },
        {
          id: "alice",
          name: "Alice",
          kind: "player",
          race: "elf",
          role: "scout",
          activity: "patrol",
          cue: "quest",
        },
        {
          id: "smith",
          name: "a soot-streaked smith",
          kind: "npc",
          race: "dwarf",
          role: "blacksmith",
          activity: "work",
          anchor_id: "forge-anvil",
          weapon: "hammer",
        },
        {
          id: "giant",
          name: "a frost giant",
          kind: "npc",
          hostile: 1,
          fighting: 1,
          engaged_with: "self",
          weapon: "long sword",
          size: "small",
          appearance: { size: "huge" },
          equipment: { main_hand: "great axe" },
          public_state: { condition: "badly wounded" },
          level: 182,
        },
      ],
      removed: [],
    });

    await expect(isoRoom).toBeVisible();
    await expect(isoRoom).toHaveAttribute("data-room-terrain", "city");
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "4");
    await expect(isoRoom).toHaveAttribute("data-room-buildings", "3");
    await expect(isoRoom).toHaveAttribute("data-room-targets", "6");
    await expect(isoRoom).toHaveAttribute("data-room-weather", "rain");
    await expect(isoRoom).toHaveAttribute("data-room-time", "dusk");
    await expect(isoRoom).toHaveAttribute("data-room-lighting", "fire");
    await expect(isoRoom).toHaveAttribute("data-room-combat", "true");
    await expect(isoRoom.getByRole("heading", { name: "Market Atrium" })).toBeVisible();
    await expect(isoRoom.locator('.room-floor[src$="/inside.webp"]')).toBeVisible();
    await expect(isoRoom.getByRole("img", { name: /Nacho/ })).toBeVisible();
    await expect(isoRoom.getByRole("img", { name: /Alice/ })).toBeVisible();
    await expect(
      isoRoom.getByRole("img", { name: /frost giant.*level 182.*hostile/i }),
    ).toBeVisible();
    await expect(isoRoom.getByRole("img", { name: /frost giant.*badly wounded/i })).toHaveClass(
      /size-huge/,
    );
    await expect(isoRoom.getByRole("button", { name: "Go east" })).toHaveClass(/blocked/);
    await expect(isoRoom.getByRole("button", { name: "Go south" })).toBeVisible();
    await expect(isoRoom.getByRole("button", { name: "Go north" })).toHaveClass(/exit-portal/);
    await expect(isoRoom.getByRole("button", { name: "Go up" })).toHaveClass(/exit-stairs/);
    await expect(isoRoom.getByRole("button", { name: "Look at a marble fountain" })).toBeVisible();
    await expect(isoRoom.locator('.room-target img[src$="/fountain.webp"]')).toBeVisible();
    await expect(isoRoom.locator('.room-target img[src$="/market-stall.webp"]')).toBeVisible();
    await expect(isoRoom.locator('.room-target img[src$="/loot.webp"]')).toBeVisible();
    await expect(isoRoom.locator(".weather-rain i")).toHaveCount(12);
    await expect(isoRoom.locator(".combat-clash")).toHaveCount(0);
    const clockStart = new Date();
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
    endpoint.sendGmcp("Darkwind.Combat.State", {
      epoch: "room-combat",
      encounter_id: "market-fight",
      seq: 0,
      visual_enabled: true,
      effective: true,
      active: true,
      current_actor_id: "self",
      current_target_id: "actor-giant",
      actors: [
        { id: "self", name: "Nacho", role: "self" },
        { id: "actor-giant", name: "a frost giant", role: "target" },
        { id: "alice", name: "Alice", role: "combatant" },
        { id: "unseen-actor", name: "Unseen combatant", role: "combatant" },
      ],
      outcome: "",
      summary: "The frost giant attacks.",
    });
    const attack = (seq: number, actor: string, target: string, result: string, damage?: number) =>
      endpoint.sendGmcp("Darkwind.Combat.Events", {
        epoch: "room-combat",
        encounter_id: "market-fight",
        first_seq: seq,
        last_seq: seq,
        events: [
          {
            seq,
            kind: "attack",
            perspective: actor === "actor-giant" ? "incoming" : "outgoing",
            actor_id: actor,
            target_id: target,
            result,
            ...(damage === undefined ? {} : { damage }),
            summary:
              result === "critical"
                ? "Nacho critically strikes the frost giant."
                : "The fighters exchange blows.",
          },
        ],
        overflow: { omitted: 0, hits: 0, damage: 0 },
      });
    attack(1, "self", "actor-giant", "critical", 42);
    await expect(isoRoom.locator('[data-occupant-id="self"]')).toHaveClass(/attacking/);
    await expect(isoRoom.locator('[data-occupant-id="giant"]')).toHaveClass(/reacting/);
    await expect(isoRoom.locator(".combat-impact")).toContainText("42");
    await expect(isoRoom.getByRole("status")).toContainText("critically");
    const restingLeft = await isoRoom.locator('[data-occupant-id="self"]').evaluate((node) => {
      const animation = node.getAnimations()[0]!;
      animation.pause();
      animation.currentTime = 0;
      return parseFloat(getComputedStyle(node).left);
    });
    const strikeLeft = await isoRoom.locator('[data-occupant-id="self"]').evaluate((node) => {
      node.getAnimations()[0]!.currentTime = 350;
      return parseFloat(getComputedStyle(node).left);
    });
    expect(strikeLeft).toBeGreaterThan(restingLeft + 20);
    await isoRoom.locator(".combat-impact").evaluate((node) => {
      node.getAnimations()[0]!.pause();
      node.getAnimations()[0]!.currentTime = 350;
    });
    await isoRoom.screenshot({
      path: testInfo.outputPath("room-combat.png"),
    });
    await page.clock.fastForward(1500);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    // Replayed events must not produce another attack.
    attack(1, "self", "actor-giant", "critical", 42);
    await page.clock.fastForward(200);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    await isoRoom.getByLabel("Combat focus").check();
    await expect(isoRoom.locator(".room-stage")).toHaveClass(/combat-focus/);
    attack(2, "actor-giant", "self", "block", 0);
    await expect(isoRoom.locator('[data-occupant-id="self"]')).toHaveAttribute(
      "data-result",
      "absorb",
    );
    await isoRoom.locator(".combat-impact").evaluate((node) => {
      node.getAnimations()[0]!.pause();
      node.getAnimations()[0]!.currentTime = 350;
    });
    await isoRoom.screenshot({ path: testInfo.outputPath("room-combat-focus.png") });
    await page.clock.fastForward(1500);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      version: 1,
      room: 101,
      mode: "delta",
      base_revision: 1,
      revision: 2,
      dark: 0,
      more: 0,
      upsert: [
        {
          id: "alice",
          name: "Alice",
          kind: "player",
          race: "elf",
          weapon: "long bow",
          fighting: 1,
          cue: "quest",
        },
      ],
      removed: [],
    });
    attack(3, "alice", "actor-giant", "hit", 17);
    await expect(isoRoom.locator(".combat-projectile")).toHaveCount(1);
    await expect(isoRoom.locator('[data-occupant-id="alice"]')).not.toHaveClass(/attacking/);
    await isoRoom.locator(".combat-projectile, .combat-impact").evaluateAll((nodes) => {
      for (const node of nodes) {
        node.getAnimations()[0]!.pause();
        node.getAnimations()[0]!.currentTime = 350;
      }
    });
    await isoRoom.screenshot({ path: testInfo.outputPath("room-combat-ranged.png") });
    await page.clock.fastForward(1500);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    attack(4, "unseen-actor", "self", "hit", 99);
    await page.clock.fastForward(1500);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    attack(5, "self", "actor-giant", "dodge");
    await expect(isoRoom.locator(".combat-impact")).toContainText("Dodge");
    await expect
      .poll(() =>
        isoRoom
          .locator('[data-occupant-id="self"]')
          .evaluate((node) => getComputedStyle(node).animationName),
      )
      .toBe("none");
    await isoRoom.screenshot({ path: testInfo.outputPath("room-combat-reduced.png") });
    await page.clock.fastForward(1500);
    await expect(isoRoom.locator(".combat-impact")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.clock.resume();
    await isoRoom.getByLabel("Combat focus").uncheck();
    await expect(
      isoRoom.locator('.occupant.activity-work[aria-label*="blacksmith"]'),
    ).toBeVisible();
    await expect(isoRoom.locator('.occupant img[src$="/great-axe.png"]')).toBeVisible();
    await expect(isoRoom.locator('.occupant img[src$="/shield.png"]')).toBeVisible();
    await expect(isoRoom.locator('[data-cue="quest"]')).toHaveCount(2);
    await expect(isoRoom.getByRole("list", { name: "Room occupants" })).toContainText(
      "a frost giant",
    );
    if (process.env.SCENE_SCREENSHOTS)
      await isoRoom.screenshot({
        path: `${process.env.SCENE_SCREENSHOTS}/scene-panel-isometric-${testInfo.project.name}.png`,
      });
    await isoRoom
      .getByRole("list", { name: "Things to look at" })
      .getByRole("button", { name: "a marble fountain (active)", exact: true })
      .click();
    await expect.poll(() => endpoint.commands).toContain("look fountain");
    await expect(isoRoom).toHaveAttribute("data-player-target", "marble-fountain");
    await expect(isoRoom.locator(".occupant.self")).toHaveClass(/walking/);
    await expect(
      isoRoom.getByRole("group", { name: "Actions for a marble fountain" }),
    ).toContainText("Drink");
    await isoRoom.getByRole("button", { name: "Get a dropped leather satchel" }).click();
    await expect.poll(() => endpoint.commands).toContain("get satchel");
    await expect(isoRoom).toHaveAttribute("data-player-target", "abandoned-loot");

    const clearedRoster = {
      version: 1,
      room: 101,
      mode: "snapshot",
      revision: 3,
      dark: 1,
      more: 0,
      upsert: [],
      removed: [],
    };
    endpoint.sendGmcp("Darkwind.Room.Occupants", clearedRoster);
    await expect(isoRoom).toContainText("too dark");
    await expect(
      isoRoom.locator(".occupant, .room-target, .room-building, .room-exit"),
    ).toHaveCount(0);
    if (process.env.SCENE_SCREENSHOTS)
      await isoRoom.screenshot({
        path: `${process.env.SCENE_SCREENSHOTS}/scene-panel-isometric-dark-${testInfo.project.name}.png`,
      });
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...clearedRoster,
      revision: 4,
      dark: 0,
      unavailable: 1,
    });
    await expect(isoRoom).toContainText("room view is unavailable");
    await expect(isoRoom.locator(".occupant, .room-target, .room-building")).toHaveCount(0);

    endpoint.sendGmcp("Room.Info", {
      num: 102,
      name: "Eastern Forest",
      area: "Fixture Town",
      environment: "forest",
      exits: { west: 101 },
    });
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      version: 1,
      room: 102,
      mode: "snapshot",
      revision: 1,
      dark: 0,
      more: 0,
      upsert: [
        { id: "self", name: "Nacho", kind: "self", race: "human" },
        { id: "alice", name: "Alice", kind: "player", race: "elf" },
      ],
      removed: [],
    });

    await expect(isoRoom).toHaveAttribute("data-room-terrain", "forest");
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "2");
    await expect(isoRoom).toHaveAttribute("data-room-combat", "false");
    await expect(isoRoom.getByRole("heading", { name: "Eastern Forest" })).toBeVisible();
    await expect(isoRoom.locator('.room-floor[src$="/forest.webp"]')).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        isoRoom
          .locator(".occupant")
          .first()
          .evaluate((node) => getComputedStyle(node).animationName),
      )
      .toBe("none");
  });
});

test.describe("isometric room server-contract follow-up", () => {
  test.use({ deviceScaleFactor: 2 });

  test("preserves scenery identities, discovery clearing, locks, overflow, and recovery", async ({
    page,
  }, testInfo) => {
    const endpoint = await connect(page);
    await togglePanel(page, "Isometric Room");
    const isoRoom = page.locator('.iso-room-panel[data-panel-id="isoMap"]');
    endpoint.sendGmcp("Room.Info", {
      num: 101,
      name: "Survey clearing",
      area: "Fixture Town",
      environment: "forest",
      details: [],
      looks: [
        {
          id: "survey.stake",
          name: "Survey stake",
          nouns: ["survey stake"],
          sprite: "sign",
          position: { x: 20, y: 60 },
        },
        {
          id: "survey-stake",
          name: "Red stake",
          nouns: ["red stake"],
          sprite: "sign",
          position: { x: 75, y: 50 },
        },
      ],
      exits: { east: "closed" },
      exit_states: { east: "locked" },
    });
    const roster = {
      version: 1,
      room: "101",
      mode: "snapshot",
      revision: 40,
      dark: 0,
      more: 0,
      upsert: [
        { id: "self", name: "Nacho", kind: "self", race: "human" },
        {
          id: "surveyor",
          name: "Surveyor",
          kind: "npc",
          race: "human",
          anchor_id: "survey.stake",
          level: 40,
          shield: 1,
          fighting: 1,
        },
        { id: "warden", name: "Warden", kind: "npc", race: "elf", anchor_id: "survey-stake" },
      ],
      removed: [],
    };
    endpoint.sendGmcp("Darkwind.Room.Occupants", roster);
    await expect(isoRoom).toHaveAttribute("data-room-targets", "2");
    await expect(isoRoom.locator('.room-exit img[src$="/door-locked.webp"]')).toBeVisible();
    await expect(isoRoom.getByRole("img", { name: "Warden", exact: true })).toHaveCSS("--x", "68%");
    await expect(isoRoom.getByRole("img", { name: /^Surveyor/ })).toHaveCSS("--x", "27%");
    if (process.env.SCENE_SCREENSHOTS)
      await isoRoom.screenshot({
        path: `${process.env.SCENE_SCREENSHOTS}/isometric-followup-${testInfo.project.name}.png`,
      });

    const catalogue = isoRoom.getByRole("list", { name: "Things to look at" });
    await catalogue.getByRole("button", { name: "Survey stake", exact: true }).click();
    await expect.poll(() => endpoint.commands).toContain("look survey stake");
    await expect(isoRoom).toHaveAttribute("data-player-target", "survey.stake");
    await catalogue.getByRole("button", { name: "Red stake", exact: true }).click();
    await expect.poll(() => endpoint.commands).toContain("look red stake");
    await expect(isoRoom).toHaveAttribute("data-player-target", "survey-stake");

    const surveyor = isoRoom.getByRole("img", { name: /^Surveyor/ });
    await expect(surveyor).toHaveAttribute("aria-label", /level 40/);
    await expect(surveyor.locator(".shield")).toHaveCount(1);
    await expect(surveyor).toHaveClass(/fighting/);
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      mode: "delta",
      base_revision: 40,
      revision: 41,
      upsert: [
        { id: "surveyor", name: "Surveyor", kind: "npc", race: "human", anchor_id: "survey.stake" },
        { id: "traveller", name: "Traveller", kind: "npc", race: "elf" },
      ],
      removed: ["warden"],
    });
    await expect(isoRoom.getByRole("img", { name: "Traveller", exact: true })).toBeVisible();
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "3");
    await expect(isoRoom.getByRole("img", { name: "Warden", exact: true })).toHaveCount(0);
    await expect(surveyor).not.toHaveAttribute("aria-label", /level 40/);
    await expect(surveyor.locator(".shield")).toHaveCount(0);
    await expect(surveyor).not.toHaveClass(/fighting/);
    if (process.env.SCENE_SCREENSHOTS)
      await isoRoom.screenshot({
        path: `${process.env.SCENE_SCREENSHOTS}/isometric-delta-${testInfo.project.name}.png`,
      });

    endpoint.sendGmcp("Room.Info", { num: 101, looks: [], details: ["shop"] });
    await expect(isoRoom).toHaveAttribute("data-room-targets", "0");
    await expect(isoRoom.locator(".room-target")).toHaveCount(0);
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      revision: 42,
      more: 5,
      upsert: Array.from({ length: 24 }, (_, index) => ({
        id: `actor-${index}`,
        name: index === 0 ? "Nacho" : `Actor ${index}`,
        kind: index === 0 ? "self" : "npc",
        race: "human",
      })),
    });
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "8");
    await expect(isoRoom).toContainText("+21 more");
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      mode: "delta",
      base_revision: 42,
      revision: 43,
      more: 0,
      upsert: [{ id: "promoted", name: "Actor promoted", kind: "npc", race: "human" }],
      removed: ["actor-1"],
    });
    await expect(isoRoom).toContainText("+16 more");
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "8");
    await expect(isoRoom.getByRole("img", { name: "Actor 1", exact: true })).toHaveCount(0);
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      upsert: [{ id: "stale", name: "Stale actor", kind: "npc" }],
    });
    // A later frame is a processing barrier: checking the old count alone
    // could pass before the stale packet reached the client.
    endpoint.sendGmcp("Room.Info", { num: 101, name: "Survey clearing after stale packet" });
    await expect(isoRoom).toContainText("Survey clearing after stale packet");
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "8");
    await expect(isoRoom).not.toContainText("Stale actor");
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      mode: "delta",
      base_revision: 39,
      revision: 44,
      upsert: [{ id: "bad-base", name: "Wrong base actor", kind: "npc" }],
    });
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "0");
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      revision: 45,
      upsert: [roster.upsert[0]],
    });
    await expect(isoRoom).toHaveAttribute("data-room-occupants", "1");
    endpoint.sendGmcp("Darkwind.Room.Occupants", {
      ...roster,
      revision: 46,
      dark: 1,
      upsert: [],
    });
    await expect(isoRoom).toContainText("too dark");
    await expect(
      isoRoom.locator(".occupant, .room-target, .room-building, .room-exit"),
    ).toHaveCount(0);
    if (process.env.SCENE_SCREENSHOTS)
      await isoRoom.screenshot({
        path: `${process.env.SCENE_SCREENSHOTS}/isometric-followup-dark-${testInfo.project.name}.png`,
      });
  });
});

test("the map marks you, previews a route on hover, draws service icons, and has a legend", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? Infinity) <= 700,
    "hovering to preview a route is a pointer interaction",
  );
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  endpoint.sendGmcp("Darkwind.MapData2.Current", {
    ...currentRoom(101, "Atrium", 0, { east: 102 }),
    details: ["shop"],
  });
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    currentRoom(102, "East Hall", 1, { west: 101, east: 103 }),
  );
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(103, "Far Hall", 2, { west: 102 }));
  const map = page.locator('.map-panel[data-panel-id="map"]');
  const mapBody = map.locator(".map-body");
  await expect(map.locator(".map-player-marker")).toHaveCount(1);
  await expect(map.locator(".map-detail-shop svg")).toBeVisible();

  await map.getByRole("button", { name: "Speedwalk to Atrium" }).hover();
  await expect(mapBody).toHaveAttribute("data-map-route", "preview");
  await expect(map.locator(".map-route-count")).toHaveText("2");
  await expect(map.locator(".map-route-dot")).toHaveCount(1);
  await page.mouse.move(1, 1);
  await expect(mapBody).not.toHaveAttribute("data-map-route");
  await expect(map.locator(".map-route-count")).toHaveCount(0);

  await map.getByRole("button", { name: "Map legend" }).click();
  const legend = map.getByRole("region", { name: "Map legend" });
  await expect(legend).toContainText("Shop");
  await expect(legend).toContainText("Edge of the explored map");
  await page.keyboard.press("Escape");
  await expect(legend).toHaveCount(0);
});

test("living terrain gives each kind of water and swamp its own motion, and holds still with reduced motion", async ({
  page,
}) => {
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  const terrainRoom = (
    id: number,
    name: string,
    x: number,
    terrain: string,
    exits: Record<string, number>,
  ) => ({
    ...currentRoom(id, name, x, exits),
    env: `outside, ${terrain}`,
  });
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    terrainRoom(105, "Open Sea", 4, "sea", { west: 104 }),
  );
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    terrainRoom(104, "Swift River", 3, "river", { west: 103, east: 105 }),
  );
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    terrainRoom(103, "Misty Swamp", 2, "swamp", { west: 102, east: 104 }),
  );
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    terrainRoom(102, "Lake Shallows", 1, "lake", { west: 101, east: 103 }),
  );
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0, { east: 102 }));
  const map = page.locator('.map-panel[data-panel-id="map"]');
  await expect(map.getByRole("button", { name: "Speedwalk to Open Sea" })).toBeVisible();
  for (const kind of ["sea", "lake", "river", "swamp"]) {
    const layer = map.locator(`.map-live-${kind}`);
    await expect(layer).toHaveCount(1);
    await expect
      .poll(() =>
        layer.evaluate((el) => !el.hidden && /blob:/.test((el as HTMLElement).style.maskImage)),
      )
      .toBe(true);
    await expect(layer.locator(".map-live-pattern")).toHaveCount(2);
    expect(
      await layer
        .locator(".map-live-pattern")
        .evaluateAll((patterns) =>
          patterns.map((pattern) => pattern.getAnimations()[0]?.playState),
        ),
    ).toEqual(["running", "running"]);
  }

  const riverMotion = await map.locator(".map-live-river .map-live-pattern-1").evaluate((el) => {
    const animation = el.getAnimations()[0];
    return {
      duration: animation.effect?.getTiming().duration,
      start: animation.currentTime,
    };
  });
  expect(riverMotion.duration).toBe(3400);
  await expect
    .poll(() =>
      map
        .locator(".map-live-river .map-live-pattern-1")
        .evaluate((el) => el.getAnimations()[0]?.currentTime),
    )
    .not.toBe(riverMotion.start);

  // The preference applies at once, without waiting for a move.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(map.locator(".map-live-layer, .map-live-torches")).toHaveCount(0);
});

test("the map keeps unchanged room tiles across renders, with their focus, and patches what changed", async ({
  page,
}) => {
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(103, "Far Hall", 2, { west: 102 }));
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    currentRoom(102, "East Hall", 1, { west: 101, east: 103 }),
  );
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0, { east: 102 }));
  const map = page.locator('.map-panel[data-panel-id="map"]');
  const farHall = map.getByRole("button", { name: "Speedwalk to Far Hall" });
  await expect(farHall).toBeVisible();

  // Tag the tile's element and give it keyboard focus, then make the map
  // render again without changing that room.
  await farHall.evaluate((el) => {
    (el as HTMLElement & { keptAcrossRenders?: boolean }).keptAcrossRenders = true;
    (el as HTMLElement).focus();
  });
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0, { east: 102 }));
  await expect(map.locator(".map-tile-player")).toHaveAttribute("data-room-id", "101");
  await expect
    .poll(() =>
      farHall.evaluate((el) => ({
        kept: !!(el as HTMLElement & { keptAcrossRenders?: boolean }).keptAcrossRenders,
        focused: document.activeElement === el,
      })),
    )
    .toEqual({ kept: true, focused: true });

  // A move changes the player's old and new tiles; the map shows it either way.
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    currentRoom(102, "East Hall", 1, { west: 101, east: 103 }),
  );
  await expect(map.locator(".map-tile-player")).toHaveAttribute("data-room-id", "102");
  await expect(map.locator(".map-tile-player")).toHaveCount(1);
  await expect(map.locator(".map-player-marker")).toHaveCount(1);
});

test("the map zooms at the pointer, shows other floors, keeps pins, and searches", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? Infinity) <= 700,
    "wheel zoom and right-click pins are pointer interactions",
  );
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(102, "East Hall", 1, { west: 101 }));
  endpoint.sendGmcp("Darkwind.MapData2.Current", {
    ...currentRoom(201, "Loft", 0, { down: 101 }),
    z: 1,
  });
  endpoint.sendGmcp(
    "Darkwind.MapData2.Current",
    currentRoom(101, "Atrium", 0, { east: 102, up: 201 }),
  );
  const map = page.locator('.map-panel[data-panel-id="map"]');
  const mapBody = map.locator(".map-body");
  const atrium = map.getByRole("button", { name: "Speedwalk to Atrium" });
  await expect(atrium).toBeVisible();
  await expect(
    map.locator(".map-title-card"),
    "no banner for the area the map opens in",
  ).toHaveCount(0);

  // Wheel zoom steps once, around the pointer.
  const box = await atrium.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -120);
  await expect(map.locator(".map-zoom-level")).toHaveText("110%");

  // The floor above, with the player ghosted below it.
  await map.getByRole("button", { name: "Show the level above" }).click();
  await expect(map.locator(".map-level-label")).toHaveText("+1 level");
  await expect(map.getByRole("button", { name: "Speedwalk to Loft" })).toBeVisible();
  await expect(atrium).toHaveCount(0);
  await expect(map.locator(".map-player-ghost")).toHaveCount(1);
  await map.getByRole("button", { name: "Re-center map" }).click();
  await expect(map.locator(".map-level-label")).toHaveText("Your level");
  await expect(atrium).toBeVisible();

  // A pin by right-click, kept per character.
  await map.getByRole("button", { name: "Speedwalk to East Hall" }).click({ button: "right" });
  const editor = map.getByRole("dialog", { name: "Pin East Hall" });
  await editor.getByRole("radio", { name: "Danger" }).click();
  await editor.getByLabel("Pin note").fill("Loose floorboards");
  await editor.getByLabel("Pin note").press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(map.locator(".map-pin-danger")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("darkflow-map-pins:"))
        .map((key) => JSON.parse(localStorage.getItem(key) ?? "{}").pins?.["102"]?.note),
    ),
  ).toEqual(["Loose floorboards"]);

  // Search by pin note, and by name onto another floor.
  await map.getByRole("button", { name: "Search the map" }).click();
  const search = map.getByRole("searchbox", { name: "Search the map" });
  await search.fill("floorboards");
  await expect(map.locator(".map-search-name")).toHaveText(["East Hall"]);
  await search.fill("loft");
  await expect(map.locator(".map-search-meta")).toHaveText(["1 level up"]);
  await search.press("Enter");
  await expect(map.locator(".map-level-label")).toHaveText("+1 level");
  await expect(map.locator(".map-tile-found")).toHaveCount(1);
  await expect(mapBody).toBeVisible();

  // Crossing into another area shows its name, then the banner fades away.
  endpoint.sendGmcp("Darkwind.MapData2.Current", {
    ...currentRoom(301, "Salt Road", 0),
    area: "The Saltmarsh",
  });
  const card = map.locator(".map-title-card");
  await expect(card).toContainText("Entering");
  await expect(card).toContainText("Saltmarsh");
  await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test("the map shows a room's card on hover, faces the way you step, labels landmarks, centres on a double-click, and draws rich tiles zoomed in", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? Infinity) <= 700,
    "hover cards and double-clicks are pointer interactions",
  );
  const endpoint = await connect(page);
  await togglePanel(page, "Map");
  endpoint.sendGmcp("Darkwind.MapData2.Current", {
    ...currentRoom(102, "East Hall", 1, { west: 101 }),
    details: ["shop"],
  });
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0, { east: 102 }));
  const map = page.locator('.map-panel[data-panel-id="map"]');
  const mapBody = map.locator(".map-body");
  const hall = map.getByRole("button", { name: "Speedwalk to East Hall" });
  await expect(hall).toBeVisible();

  // The card: what the room is, where its exits go, and how far it is.
  await hall.hover();
  const card = map.getByRole("tooltip");
  await expect(card).toContainText("East Hall");
  await expect(card).toContainText("Shop");
  await expect(card).toContainText("Atrium");
  await expect(card).toContainText("1 step away");
  await expect(map.locator(".map-tile[title]")).toHaveCount(0);
  await expect(hall).toHaveAccessibleDescription(/East Hall.*Shop/s);
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
  await expect(hall).not.toHaveAttribute("aria-describedby");

  // A step east: the marker faces east.
  endpoint.sendGmcp("Darkwind.MapData2.Current", {
    ...currentRoom(102, "East Hall", 1, { west: 101 }),
    details: ["shop"],
  });
  await expect(map.locator(".map-player-facing")).toHaveAttribute("style", "rotate:90deg");

  // Zoomed out past the badges, the shop is named.
  for (let step = 0; step < 6; step++) {
    await map.getByRole("button", { name: "Zoom map out" }).click();
  }
  await expect(map.locator(".map-zoom-level")).toHaveText("40%");
  await expect(map.locator(".map-label")).toHaveText(["East Hall"]);

  // A double-click on the ground centres the view there, without walking.
  const box = (await mapBody.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2 - 120, box.y + box.height / 2 - 80);
  await expect
    .poll(() =>
      mapBody.evaluate((body) =>
        // To a quarter cell: the middle of the map need not be on a whole pixel.
        [body.dataset.mapPanX, body.dataset.mapPanY].map((pan) => Math.round(Number(pan) * 4) / 4),
      ),
    )
    .toEqual([7.5, 5]);
  await expect(map.locator(".map-panel-status")).not.toHaveText("Speedwalking");

  // Starting a speedwalk brings the view back to the player.
  await map.getByRole("button", { name: "Speedwalk to Atrium" }).click();
  await expect(map.locator(".map-panel-status")).toHaveText("Speedwalking");
  await expect
    .poll(() =>
      mapBody.evaluate((body) => [body.dataset.mapPanX ?? null, body.dataset.mapPanY ?? null]),
    )
    .toEqual([null, null]);

  // Zoomed in to 200%, the tiles are rich: the room beside the player is
  // named on its tile (the player's own has the marker over it).
  await map.getByRole("button", { name: "Re-center map" }).click();
  for (let step = 0; step < 10; step++) {
    await map.getByRole("button", { name: "Zoom map in" }).click();
  }
  await expect(map.locator(".map-zoom-level")).toHaveText("200%");
  await expect(map.locator(".map-tile-name")).toHaveText(["Atrium"]);
  await expect(map.getByRole("button", { name: "Zoom map in" })).toBeEnabled();
});

test("map navigation and room imagery survive layout persistence without stale media", async ({
  page,
}, testInfo) => {
  test.skip(
    (page.viewportSize()?.width ?? Infinity) <= 700,
    "layout persistence is desktop-only; mobile suppresses geometry writes",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const endpoint = await connect(page);
  await togglePanel(page, "Status");
  await togglePanel(page, "Map");
  await togglePanel(page, "Room Image");

  await expect
    .poll(() =>
      endpoint.gmcpMessages
        .filter((message) => message.startsWith("Darkwind.Client.Subscriptions "))
        .at(-1),
    )
    .toContain('"status":true');
  expect(endpoint.gmcpMessages.at(-1)).toContain('"map":true');
  expect(endpoint.gmcpMessages.at(-1)).toContain('"roomImage":true');

  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(102, "East Hall", 1, { west: 101 }));
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(101, "Atrium", 0, { east: 102 }));
  const map = page.locator('.map-panel[data-panel-id="map"]');
  const eastHall = map.getByRole("button", { name: "Speedwalk to East Hall" });
  await expect(eastHall).toBeVisible();
  await eastHall.press("Enter");
  await expect.poll(() => endpoint.commands).toContain("east");
  endpoint.sendGmcp("Darkwind.MapData2.Current", currentRoom(303, "Wrong Turn", 2));
  await expect(map.getByRole("status")).toContainText("Speedwalk stopped: route changed");

  const mapBody = map.locator(".map-body");
  const mapBox = await mapBody.boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.move(mapBox!.x + 80, mapBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(mapBox!.x + 130, mapBox!.y + 110);
  await page.mouse.up();
  await expect(mapBody).not.toHaveAttribute("data-map-pan-x", "0");

  await map.getByRole("button", { name: "Resync" }).click();
  await expect
    .poll(() =>
      endpoint.gmcpMessages.filter((message) => message.startsWith("Darkwind.MapData2.Sync ")),
    )
    .toContainEqual(expect.stringContaining('"area":"Fixture Town"'));

  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: { east: 102 } });
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/assets/brand/darkflow-icon-64.png",
    name: "Atrium",
  });
  const roomImage = page.locator('.room-image-panel[data-panel-id="roomImage"]');
  await expect(roomImage.getByRole("img", { name: "Atrium" })).toBeVisible();

  let releaseSlowImage: (() => void) | undefined;
  const slowImageReleased = new Promise<void>((resolve) => {
    releaseSlowImage = resolve;
  });
  await page.route("**/slow-room.png", async (route) => {
    await slowImageReleased;
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
  });
  endpoint.sendGmcp("Darkwind.Room.Image", { url: "/slow-room.png", name: "Slow Atrium" });
  await expect(roomImage.getByRole("status")).toContainText("Loading");
  await expect(roomImage.getByRole("img", { name: "Atrium" })).toBeVisible();
  endpoint.sendGmcp("Room.Info", { num: 202, name: "Courtyard", exits: {} });
  await expect(roomImage.getByRole("img")).toHaveCount(0);
  releaseSlowImage?.();
  await page.waitForTimeout(100);
  await expect(roomImage.getByRole("img")).toHaveCount(0);
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/assets/brand/darkflow-icon-64.png?courtyard=1",
    name: "Courtyard",
  });
  await expect(roomImage.getByRole("img", { name: "Courtyard" })).toBeVisible();

  await dragPanelToRail(page, "roomImage", "right");
  const roomImageRailBody = page.locator(
    '[data-rail="right"] > [data-panel-id="roomImage"] .df-rail-card-body',
  );
  await expect(roomImageRailBody).toBeVisible();
  expect((await roomImageRailBody.boundingBox())?.height).toBeGreaterThanOrEqual(200);
  expect(
    await roomImageRailBody.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await dragPanelToRail(page, "map", "left");
  await page.screenshot({ path: testInfo.outputPath("map-room-image-rails-1440x900.png") });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: testInfo.outputPath("map-room-image-rails-1024x768.png") });
  await page.setViewportSize({ width: 1440, height: 900 });

  let releaseBrokenImage: (() => void) | undefined;
  const brokenImageReleased = new Promise<void>((resolve) => {
    releaseBrokenImage = resolve;
  });
  await page.route("**/broken-room.png", async (route) => {
    await brokenImageReleased;
    await route.abort().catch(() => {});
  });
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/broken-room.png",
    name: "Broken Courtyard",
  });
  await expect(roomImage.getByRole("status")).toContainText("Loading");
  await expect(roomImage.getByRole("img", { name: "Courtyard" })).toBeVisible();
  releaseBrokenImage?.();
  await expect(roomImage.getByRole("status")).toHaveCount(0);
  await expect(roomImage.getByRole("img", { name: "Courtyard" })).toBeVisible();

  const zoomTrigger = roomImage.getByRole("button", { name: "View larger image of Courtyard" });
  await zoomTrigger.click();
  const zoomDialog = page.getByRole("dialog", { name: "Courtyard" });
  await expect(zoomDialog.getByRole("button", { name: "Close room image" })).toBeFocused();
  await zoomDialog.evaluate((dialog) =>
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await expect(zoomDialog).not.toBeVisible();
  await expect(zoomTrigger).toBeFocused();

  let releaseDestroyImage: (() => void) | undefined;
  const destroyImageReleased = new Promise<void>((resolve) => {
    releaseDestroyImage = resolve;
  });
  await page.route("**/destroy-room.png", async (route) => {
    await destroyImageReleased;
    await route.abort().catch(() => {});
  });
  endpoint.sendGmcp("Darkwind.Room.Image", {
    url: "/destroy-room.png",
    name: "Destroy Courtyard",
  });
  await expect(roomImage.getByRole("status")).toContainText("Loading");
  await togglePanel(page, "Room Image");
  await expect(roomImage).toHaveCount(0);
  releaseDestroyImage?.();
  await page.waitForTimeout(100);
  await expect(roomImage).toHaveCount(0);

  const mapRailBody = page.locator('[data-rail="left"] > [data-panel-id="map"] .map-body');
  await expect(mapRailBody).toBeVisible();
  const mapRailBox = await mapRailBody.boundingBox();
  expect(mapRailBox?.width).toBeGreaterThanOrEqual(200);
  expect(mapRailBox?.height).toBeGreaterThanOrEqual(180);
  await map.getByRole("button", { name: "Zoom map out" }).click();
  await expect(map.locator(".map-zoom-level")).toHaveText("90%");
  await expect(page.getByTestId("workspace-status")).toHaveText("Workspace saved");
  await page.reload();
  await expect(page.locator('.map-panel[data-panel-id="map"] .map-zoom-level')).toHaveText("90%");
  await expect(page.locator('[data-rail="left"] > [data-panel-id="map"]')).toBeVisible();
  await page.evaluate(() => {
    const runtime = (
      window as unknown as { __darkflowPhase1Runtime: { characterProfileId: string } }
    ).__darkflowPhase1Runtime;
    const state = JSON.parse(localStorage.getItem("darkflow-session-core-v1") ?? "{}");
    state.characterProfiles[runtime.characterProfileId].workspace.payload.dockview.layout.mapZoom =
      "invalid";
    localStorage.setItem("darkflow-session-core-v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('[data-rail="left"] > [data-panel-id="map"]')).toBeVisible();
  await expect(page.locator('.map-panel[data-panel-id="map"] .map-zoom-level')).toHaveText("100%");
});

test("BrowseArea opens only a transient area map and continues pagination", async ({ page }) => {
  const endpoint = await connect(page);
  endpoint.sendGmcp("Darkwind.MapData2.BrowseArea", {
    catalog: "fixture-town",
    name: "Fixture Town",
    center: 501,
    replace: 1,
    rooms: [currentRoom(501, "Market", 0)],
    more: 1,
    offset: 25,
  });

  const areaMap = page.locator('.map-panel[data-panel-id="areaMap"]');
  await expect(areaMap).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Area Map", exact: true })).toBeVisible();
  await expect(areaMap.getByRole("button", { name: "Market" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain('Darkwind.MapData2.Browse {"catalog":"fixture-town","offset":25}');
  expect(
    await page.evaluate(() => localStorage.getItem("darkflow-session-core-v1") ?? ""),
  ).not.toContain("areaMap");

  endpoint.sendGmcp("Darkwind.MapData2.Reset", { scope: "all", mapEpoch: "fixture-reset" });
  await expect(areaMap).toHaveCount(0);
});

test("playlist State stays closed while Open owns focus and player lifecycle", async ({
  page,
}, testInfo) => {
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.addInitScript(() => {
    const calls: string[] = [];
    const players: Player[] = [];
    const eventHistory: NonNullable<typeof latestEvents>[] = [];
    let latestEvents:
      | {
          onReady(event: { target: unknown }): void;
          onStateChange(event: { data: number }): void;
          onError(event: { data: number }): void;
          onAutoplayBlocked(): void;
        }
      | undefined;
    class Player {
      time = 3;
      events;
      iframe = document.createElement("iframe");
      constructor(hostId: string, options: { events: NonNullable<typeof latestEvents> }) {
        this.events = options.events;
        this.iframe.title = "Fixture YouTube player";
        document.getElementById(hostId)?.replaceWith(this.iframe);
        latestEvents = options.events;
        eventHistory.push(options.events);
        players.push(this);
        queueMicrotask(() => this.events.onReady({ target: this }));
      }
      cueVideoById(): void {
        calls.push("cue");
      }
      destroy(): void {
        calls.push("destroy");
        this.iframe.remove();
      }
      getCurrentTime(): number {
        return this.time;
      }
      getDuration(): number {
        return 212;
      }
      getPlayerState(): number {
        return 1;
      }
      getVideoData(): { title: string } {
        return { title: "Resolved fixture title" };
      }
      pauseVideo(): void {
        calls.push("pause");
      }
      playVideo(): void {
        calls.push("play");
        this.events.onStateChange({ data: 1 });
      }
      seekTo(seconds: number): void {
        this.time = seconds;
        calls.push("seek");
      }
      setVolume(next: number): void {
        calls.push(`volume:${next}`);
      }
      stopVideo(): void {
        calls.push("stop");
      }
    }
    Object.assign(window, {
      YT: { Player, PlayerState: { PLAYING: 1, ENDED: 0 } },
      __darkflowPlaylistCalls: calls,
      __darkflowPlaylistEvents: () => latestEvents,
      __darkflowPlaylistEventHistory: eventHistory,
      __darkflowPlaylistPlayers: players,
    });
  });
  const endpoint = await connect(page);
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", playlistState);
  await expect(page.locator('.room-playlist-panel[data-panel-id="roomPlaylist"]')).toHaveCount(0);

  endpoint.sendGmcp("Darkwind.Room.Playlist.Open", playlistState);
  const jukebox = page.locator('.room-playlist-panel[data-panel-id="roomPlaylist"]');
  await expect(jukebox).toContainText("Fixture Jukebox");
  await jukebox.getByRole("button", { name: "Listen in sync" }).click();
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain(
      'Darkwind.Room.Playlist.Report {"room_id":101,"revision":7,"entry_id":9,"report":"ready","title":"Resolved fixture title","duration":212}',
    );

  if ((page.viewportSize()?.width ?? 0) > 700) {
    const playerCountBeforeRail = await page.evaluate(
      () =>
        (window as unknown as { __darkflowPlaylistPlayers: unknown[] }).__darkflowPlaylistPlayers
          .length,
    );
    const destroyCountBeforeRail = await page.evaluate(
      () =>
        (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls.filter(
          (call) => call === "destroy",
        ).length,
    );
    await dragPanelToRail(page, "roomPlaylist", "right");
    const railCard = page.locator('[data-rail="right"] > [data-panel-id="roomPlaylist"]');
    await expect(railCard).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __darkflowPlaylistPlayers: unknown[] })
              .__darkflowPlaylistPlayers.length,
        ),
      )
      .toBe(playerCountBeforeRail + 1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { __darkflowPlaylistCalls: string[] }
            ).__darkflowPlaylistCalls.filter((call) => call === "destroy").length,
        ),
      )
      .toBe(destroyCountBeforeRail + 1);
    const playerBox = await railCard
      .locator('iframe[title="Fixture YouTube player"]')
      .boundingBox();
    expect(playerBox?.width).toBeGreaterThanOrEqual(200);
    expect(playerBox?.height).toBeGreaterThanOrEqual(200);
    expect(await railCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("jukebox-rail-1440x900.png") });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: testInfo.outputPath("jukebox-rail-1024x768.png") });
    await page.setViewportSize({ width: 1440, height: 900 });

    await railCard.getByRole("button", { name: "Collapse Jukebox", exact: true }).click();
    endpoint.sendGmcp("Darkwind.Room.Playlist.Open", playlistState);
    await expect(
      railCard.getByRole("button", { name: "Collapse Jukebox", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-panel-id="roomPlaylist"]')).toHaveCount(3);

    await jukebox.getByRole("button", { name: "Stop listening" }).click();
    const playerCountAfterStop = await page.evaluate(
      () =>
        (window as unknown as { __darkflowPlaylistPlayers: unknown[] }).__darkflowPlaylistPlayers
          .length,
    );
    await panelDragHandle(page, "roomPlaylist").dragTo(panelDragHandle(page, "avatar"));
    const leftRailCard = page.locator('[data-rail="left"] > [data-panel-id="roomPlaylist"]');
    await expect(leftRailCard).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __darkflowPlaylistPlayers: unknown[] }).__darkflowPlaylistPlayers
            .length,
      ),
    ).toBe(playerCountAfterStop);
    await jukebox.getByRole("button", { name: "Listen in sync" }).click();
    await leftRailCard.getByRole("button", { name: "Float Jukebox", exact: true }).click();
    await expect(page.getByTestId("workspace-host").locator(".room-playlist-panel")).toBeVisible();
    await page.getByRole("button", { name: "Dock Jukebox", exact: true }).click();

    const destroyCountBeforeHide = await page.evaluate(
      () =>
        (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls.filter(
          (call) => call === "destroy",
        ).length,
    );
    await dockPanelAsTab(page, "roomPlaylist", "terminal");
    await panelDragHandle(page, "terminal").click();
    if (await jukebox.isVisible()) {
      await dockPanelAsTab(page, "roomPlaylist", "terminal");
      await panelDragHandle(page, "terminal").click();
    }
    await expect(jukebox).not.toBeVisible();
    await expect(jukebox).toHaveCount(1);
    endpoint.sendGmcp("Darkwind.Room.Playlist.State", {
      ...playlistState,
      playback: { ...playlistState.playback, status: "paused" },
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls,
        ),
      )
      .toContain("pause");
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { __darkflowPlaylistCalls: string[] }
          ).__darkflowPlaylistCalls.filter((call) => call === "destroy").length,
      ),
    ).toBe(destroyCountBeforeHide);
    await panelDragHandle(page, "roomPlaylist").locator(".dv-default-tab-content").click();
    await expect(jukebox.getByRole("button", { name: "Stop listening" })).toBeVisible();
    endpoint.sendGmcp("Darkwind.Room.Playlist.State", playlistState);
    await expect(jukebox.getByRole("button", { name: "Pause all" })).toBeVisible();
  }

  await jukebox.getByLabel("YouTube video URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await jukebox.getByRole("button", { name: "Add", exact: true }).click();
  await jukebox.getByRole("button", { name: /Vote to skip/ }).click();
  await jukebox.getByRole("button", { name: "Pause all" }).click();
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain(
      'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"add","url":"https://youtu.be/dQw4w9WgXcQ"}',
    );
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"vote_skip"}',
  );
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"pause"}',
  );
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", {
    ...playlistState,
    playback: { ...playlistState.playback, status: "paused" },
  });
  await jukebox.getByRole("button", { name: "Resume all" }).click();
  await jukebox.getByRole("button", { name: "Skip now" }).click();
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"resume"}',
  );
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"skip"}',
  );
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", playlistState);
  await jukebox.getByRole("button", { name: "Remove", exact: true }).first().click();
  await jukebox.getByRole("button", { name: "Move Second queued video up" }).click();
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"remove","number":1}',
  );
  expect(endpoint.gmcpMessages).toContain(
    'Darkwind.Room.Playlist.Action {"room_id":101,"revision":7,"action":"move","from":2,"to":1}',
  );

  endpoint.sendGmcp("Darkwind.Room.Playlist.State", {
    ...playlistState,
    playback: { ...playlistState.playback, status: "paused" },
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls,
      ),
    )
    .toContain("pause");

  const now = Math.floor(Date.now() / 1_000);
  const playCountBeforeFutureStart = await page.evaluate(
    () =>
      (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls.filter(
        (call) => call === "play",
      ).length,
  );
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", {
    ...playlistState,
    server_time: now,
    playback: { ...playlistState.playback, position: 0, start_at: now + 1 },
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as { __darkflowPlaylistCalls: string[] }
            ).__darkflowPlaylistCalls.filter((call) => call === "play").length,
        ),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(playCountBeforeFutureStart);

  const seekCountBeforeDrift = await page.evaluate(() => {
    const target = window as unknown as {
      __darkflowPlaylistCalls: string[];
      __darkflowPlaylistPlayers: Array<{ time: number }>;
    };
    target.__darkflowPlaylistPlayers.at(-1)!.time = -20;
    return target.__darkflowPlaylistCalls.filter((call) => call === "seek").length;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as { __darkflowPlaylistCalls: string[] }
            ).__darkflowPlaylistCalls.filter((call) => call === "seek").length,
        ),
      { timeout: 6_000 },
    )
    .toBeGreaterThan(seekCountBeforeDrift);

  await page.evaluate(() => {
    (
      window as unknown as {
        __darkflowPlaylistEvents(): { onError(event: { data: number }): void } | undefined;
      }
    )
      .__darkflowPlaylistEvents()
      ?.onError({ data: 150 });
  });
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain(
      'Darkwind.Room.Playlist.Report {"room_id":101,"revision":7,"entry_id":9,"report":"error","code":150}',
    );
  await page.evaluate(() => {
    (
      window as unknown as {
        __darkflowPlaylistEvents(): { onAutoplayBlocked(): void } | undefined;
      }
    )
      .__darkflowPlaylistEvents()
      ?.onAutoplayBlocked();
  });
  await expect(jukebox).toContainText("Your browser blocked autoplay");
  await jukebox.getByRole("button", { name: "Listen in sync" }).click();

  const readyReport =
    'Darkwind.Room.Playlist.Report {"room_id":101,"revision":7,"entry_id":9,"report":"ready","title":"Resolved fixture title","duration":212}';
  const readyReportsBeforeReconnect = endpoint.gmcpMessages.filter(
    (message) => message === readyReport,
  ).length;
  endpoint.dropConnections();
  await expect(jukebox).toContainText("Shared playback is unavailable while disconnected.");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls,
      ),
    )
    .toContain("destroy");
  const reportsBeforeLateCallback = endpoint.gmcpMessages.length;
  await page.evaluate(() => {
    (
      window as unknown as {
        __darkflowPlaylistEvents(): { onStateChange(event: { data: number }): void } | undefined;
      }
    )
      .__darkflowPlaylistEvents()
      ?.onStateChange({ data: 0 });
  });
  expect(endpoint.gmcpMessages).toHaveLength(reportsBeforeLateCallback);

  await expect(page.locator("#connect-btn")).toHaveText(/Retrying in \d+s/);
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
  await expect(jukebox.getByRole("button", { name: /Vote to skip/ })).toBeDisabled();
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  await expect(jukebox.getByRole("button", { name: /Vote to skip/ })).toBeDisabled();
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", playlistState);
  await expect(jukebox.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await expect
    .poll(() => endpoint.gmcpMessages.filter((message) => message === readyReport).length)
    .toBe(readyReportsBeforeReconnect + 1);

  const staleEntryEventIndex = await page.evaluate(
    () =>
      (window as unknown as { __darkflowPlaylistEventHistory: unknown[] })
        .__darkflowPlaylistEventHistory.length - 1,
  );
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", {
    ...playlistState,
    revision: 8,
    playback: {
      ...playlistState.playback,
      current: {
        ...playlistState.playback.current,
        id: 11,
        video_id: "M7lc1UVf-VE",
        title: "Replacement video",
      },
    },
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __darkflowPlaylistEventHistory: unknown[];
            }
          ).__darkflowPlaylistEventHistory.length,
      ),
    )
    .toBeGreaterThan(staleEntryEventIndex + 1);
  const reportsBeforeStaleEntryCallback = endpoint.gmcpMessages.length;
  await page.evaluate((staleIndex) => {
    const history = (
      window as unknown as {
        __darkflowPlaylistEventHistory: Array<{
          onStateChange(event: { data: number }): void;
        }>;
      }
    ).__darkflowPlaylistEventHistory;
    history[staleIndex]?.onStateChange({ data: 0 });
  }, staleEntryEventIndex);
  expect(endpoint.gmcpMessages).toHaveLength(reportsBeforeStaleEntryCallback);
  await page.evaluate(() => {
    const history = (
      window as unknown as {
        __darkflowPlaylistEventHistory: Array<{
          onStateChange(event: { data: number }): void;
        }>;
      }
    ).__darkflowPlaylistEventHistory;
    history.at(-1)?.onStateChange({ data: 0 });
  });
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain(
      'Darkwind.Room.Playlist.Report {"room_id":101,"revision":8,"entry_id":11,"report":"ended"}',
    );

  endpoint.sendGmcp("Room.Info", { num: 202, name: "Elsewhere", exits: {} });
  await expect(jukebox).toContainText("You left the jukebox room.");
  await expect(jukebox.getByRole("button", { name: /Vote to skip/ })).toBeDisabled();
  await togglePanel(page, "Jukebox");
  await expect(jukebox).toHaveCount(0);
  endpoint.sendGmcp("Darkwind.Room.Playlist.State", playlistState);
  await expect(jukebox).toHaveCount(0);
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  endpoint.sendGmcp("Darkwind.Room.Playlist.Open", playlistState);
  await expect(jukebox).toBeVisible();
  await expect(jukebox.getByRole("button", { name: "Stop listening" })).toBeVisible();

  const activeDestroyCount = await page.evaluate(
    () =>
      (window as unknown as { __darkflowPlaylistCalls: string[] }).__darkflowPlaylistCalls.filter(
        (call) => call === "destroy",
      ).length,
  );
  await page.getByRole("button", { name: "Close Jukebox", exact: true }).click();
  await expect(jukebox).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __darkflowPlaylistCalls: string[] }
          ).__darkflowPlaylistCalls.filter((call) => call === "destroy").length,
      ),
    )
    .toBe(activeDestroyCount + 1);
  const messagesBeforeClosedCallback = endpoint.gmcpMessages.length;
  await page.evaluate(() => {
    const history = (
      window as unknown as {
        __darkflowPlaylistEventHistory: Array<{
          onStateChange(event: { data: number }): void;
        }>;
      }
    ).__darkflowPlaylistEventHistory;
    history.at(-1)?.onStateChange({ data: 0 });
  });
  expect(endpoint.gmcpMessages).toHaveLength(messagesBeforeClosedCallback);

  const messagesBeforeDispose = endpoint.gmcpMessages.length;
  await page.evaluate(() => {
    (
      window as unknown as { __darkflowPhase1Runtime: { session: { dispose(): void } } }
    ).__darkflowPhase1Runtime.session.dispose();
  });
  await expect(jukebox).toHaveCount(0);
  await page.evaluate(() => {
    const history = (
      window as unknown as {
        __darkflowPlaylistEventHistory: Array<{
          onStateChange(event: { data: number }): void;
        }>;
      }
    ).__darkflowPlaylistEventHistory;
    history.at(-1)?.onStateChange({ data: 0 });
  });
  expect(endpoint.gmcpMessages).toHaveLength(messagesBeforeDispose);
});

test("playlist retries the YouTube loader after a failed attempt", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  const endpoint = await connect(page);
  endpoint.sendGmcp("Room.Info", { num: 101, name: "Atrium", exits: {} });
  endpoint.sendGmcp("Darkwind.Room.Playlist.Open", playlistState);
  const jukebox = page.locator('.room-playlist-panel[data-panel-id="roomPlaylist"]');
  await jukebox.getByRole("button", { name: "Listen in sync" }).click();
  await expect(jukebox).toContainText("Playback could not start");

  await page.unroute("https://www.youtube.com/iframe_api");
  await page.evaluate(() => {
    class Player {
      events;
      constructor(
        _hostId: string,
        options: {
          events: {
            onReady(event: { target: Player }): void;
            onStateChange(event: { data: number }): void;
          };
        },
      ) {
        this.events = options.events;
        queueMicrotask(() => this.events.onReady({ target: this }));
      }
      cueVideoById(): void {}
      destroy(): void {}
      getCurrentTime(): number {
        return 0;
      }
      getDuration(): number {
        return 212;
      }
      getPlayerState(): number {
        return 1;
      }
      getVideoData(): { title: string } {
        return { title: "Retry fixture" };
      }
      pauseVideo(): void {}
      playVideo(): void {
        this.events.onStateChange({ data: 1 });
      }
      seekTo(): void {}
      setVolume(): void {}
      stopVideo(): void {}
    }
    Object.assign(window, { YT: { Player, PlayerState: { PLAYING: 1, ENDED: 0 } } });
  });
  await jukebox.getByRole("button", { name: "Listen in sync" }).click();
  await expect(jukebox.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await expect
    .poll(() => endpoint.gmcpMessages)
    .toContain(
      'Darkwind.Room.Playlist.Report {"room_id":101,"revision":7,"entry_id":9,"report":"ready","title":"Retry fixture","duration":212}',
    );
});
