import type { RoomInfo } from "../../client/gmcp/contracts/room.ts";
import type { DarkwindRoomOccupants } from "../../client/gmcp/contracts/world.ts";

// Representative authoring data, not a production room or invented live nouns.
export const tavernRoom: RoomInfo = {
  num: 501,
  name: "The Copper Lantern",
  area: "Tavern authoring preview",
  environment: "inside",
  details: [],
  exits: { south: 502 },
  exit_details: { south: { kind: "door", label: "Street entrance" } },
  scene: { time: "dusk", lighting: "fire", layout: { floor: "timber", walls: "timber" } },
  looks: [
    { id: "bar", name: "the oak bar", nouns: ["bar"], sprite: "bar", position: { x: 64, y: 49 } },
    {
      id: "hearth",
      name: "the stone hearth",
      nouns: ["hearth"],
      sprite: "hearth",
      state: "lit",
      position: { x: 26, y: 50 },
    },
    {
      id: "casks",
      name: "the ale casks",
      nouns: ["casks"],
      sprite: "barrels",
      position: { x: 79, y: 61 },
    },
    { id: "rug", name: "the woven rug", nouns: ["rug"], sprite: "rug", position: { x: 48, y: 76 } },
    {
      id: "table-west",
      name: "the west table",
      nouns: ["west table"],
      sprite: "table",
      position: { x: 34, y: 67 },
    },
    {
      id: "table-east",
      name: "the east table",
      nouns: ["east table"],
      sprite: "table",
      position: { x: 63, y: 72 },
    },
    {
      id: "chair-west",
      name: "the west chair",
      nouns: ["west chair"],
      sprite: "chair",
      position: { x: 25, y: 71 },
    },
    {
      id: "chair-front",
      name: "the front chair",
      nouns: ["front chair"],
      sprite: "chair",
      position: { x: 34, y: 77 },
    },
    {
      id: "chair-east",
      name: "the east chair",
      nouns: ["east chair"],
      sprite: "chair",
      position: { x: 58, y: 79 },
    },
  ],
};

export const tavernOccupants: DarkwindRoomOccupants = {
  version: 1,
  room: 501,
  mode: "snapshot",
  revision: 1,
  dark: 0,
  more: 0,
  upsert: [
    { id: "self", name: "Acer", kind: "self", appearance: { race: "human", gender: "male" } },
    {
      id: "bartender",
      name: "Mara",
      kind: "npc",
      role: "bartender",
      activity: "serving",
      anchor_id: "bar",
      appearance: { race: "human", gender: "female" },
    },
    {
      id: "patron",
      name: "Borin",
      kind: "npc",
      role: "patron",
      anchor_id: "table-west",
      appearance: { race: "dwarf", gender: "male" },
    },
  ],
  removed: [],
};
