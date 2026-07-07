// Click-to-walk speedwalk over the MapData2 room graph (GAP 7 of the
// mapping gap analysis; Mudlet's marquee mapper feature, minus the weights).
//
// The client already holds the full area graph (room ids + exits), so a
// plain BFS finds the shortest known route. Steps are sent one at a time
// and VERIFIED: each Darkwind.MapData2.Current must land on the room the
// step predicted, otherwise the walk aborts immediately -- a diverted,
// blocked, or teleported player never has commands fired blindly into the
// void. Any manually typed command also cancels the walk (see input.js).
import * as mapData from './map-data-v2.js';
import { gmcp } from './gmcp.js';

const DEFAULT_STEP_TIMEOUT_MS = 5000;

let config = null; // { send, rerender, stepTimeoutMs } from initSpeedwalk
let walk = null;   // { steps, index, targetName } while active
let stepTimer = null;

export function initSpeedwalk(options) {
  const first = !config;
  config = Object.assign({
    send: () => false,
    rerender: () => {},
    stepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
  }, options);
  if (first) {
    gmcp.on('Darkwind.MapData2.Current', (data) => {
      if (data && data.id !== undefined && data.id !== null) {
        notifyRoomChange(String(data.id));
      }
    });
  }
}

// Shortest known route from -> to as [{dir, destId}], or null. Same-area
// only: cross-zone coordinates live in another space and boundary rooms
// are usually where the known graph ends anyway. Exits behind closed or
// locked doors (state >= 2) are not routable -- the movement command would
// bounce off the door and abort the walk.
export function findPath(fromId, toId, source = mapData) {
  const start = source.getRoom(fromId);
  const goal = source.getRoom(toId);
  if (!start || !goal || start.area !== goal.area) return null;
  if (fromId === toId) return [];

  const cameFrom = new Map();
  const queue = [fromId];
  let head = 0;

  cameFrom.set(fromId, null);
  while (head < queue.length) {
    const id = queue[head++];
    const room = source.getRoom(id);
    if (!room || !room.exits) continue;

    for (const [dir, destId] of Object.entries(room.exits)) {
      if (!destId || cameFrom.has(destId)) continue;
      if (room.exitDoors && room.exitDoors[dir] >= 2) continue;
      const dest = source.getRoom(destId);
      if (!dest || dest.area !== start.area) continue;

      cameFrom.set(destId, { from: id, dir });
      if (destId === toId) {
        const steps = [];
        let cursor = destId;
        while (cursor !== fromId) {
          const link = cameFrom.get(cursor);
          steps.unshift({ dir: link.dir, destId: cursor });
          cursor = link.from;
        }
        return steps;
      }
      queue.push(destId);
    }
  }
  return null;
}

export function isSpeedwalking() {
  return !!walk;
}

export function startSpeedwalk(targetId, source = mapData) {
  if (!config) return false;
  const currentId = source.getCurrentRoomId();
  if (!currentId || targetId === currentId) return false;

  cancelSpeedwalk();

  const target = source.getRoom(targetId);
  const steps = findPath(currentId, targetId, source);
  if (!steps || !steps.length) {
    setStatus('No known path to ' + ((target && target.name) || 'there') + '.');
    config.rerender();
    return false;
  }

  walk = { steps, index: 0, targetName: (target && target.name) || 'there' };
  sendStep();
  return true;
}

export function cancelSpeedwalk(reason) {
  if (!walk) return;
  walk = null;
  clearStepTimer();
  if (reason) {
    setStatus('Speedwalk stopped: ' + reason);
    config.rerender();
  }
}

// Wired to Darkwind.MapData2.Current by initSpeedwalk: verify the step
// landed where the map said it would; anything else aborts the walk.
export function notifyRoomChange(roomId) {
  if (!walk) return;
  clearStepTimer();
  const expected = walk.steps[walk.index].destId;
  if (roomId !== expected) {
    cancelSpeedwalk('route changed');
    return;
  }
  walk.index++;
  if (walk.index >= walk.steps.length) {
    const name = walk.targetName;
    walk = null;
    setStatus('Arrived: ' + name);
    return;
  }
  sendStep();
}

function sendStep() {
  const step = walk.steps[walk.index];
  const remaining = walk.steps.length - walk.index;
  setStatus('Walking to ' + walk.targetName + ' (' + remaining
    + (remaining === 1 ? ' step)' : ' steps)'));
  config.send(step.dir);
  clearStepTimer();
  stepTimer = setTimeout(() => {
    stepTimer = null;
    cancelSpeedwalk('no progress');
  }, config.stepTimeoutMs);
}

function clearStepTimer() {
  if (stepTimer) {
    clearTimeout(stepTimer);
    stepTimer = null;
  }
}

function setStatus(msg) {
  if (mapData.setMapStatus) mapData.setMapStatus(msg);
}
