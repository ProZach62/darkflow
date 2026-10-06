export const DARKWIND_COMBAT_ACTOR_LIMIT = 16;
export const DARKWIND_COMBAT_EVENT_LIMIT = 12;

export type DarkwindCombatWireBoolean = boolean | 0 | 1;

export type DarkwindCombatSize = "tiny" | "small" | "medium" | "large" | "huge";
export type DarkwindCombatWeaponType =
  "focus" | "missile" | "polearm" | "cleaving" | "crushing" | "piercing" | "slashing";
export type DarkwindCombatWeaponStyle = "slash" | "thrust" | "smash";

export interface DarkwindCombatAppearance {
  race?: string;
  family?: string;
  gender?: string;
  size?: DarkwindCombatSize;
  form?: string;
}

export interface DarkwindCombatEquipment {
  main_hand?: string;
  off_hand?: string;
  shield?: string;
  helmet?: string;
  armor?: string;
  weapon_type?: DarkwindCombatWeaponType;
  off_hand_type?: DarkwindCombatWeaponType;
  weapon_style?: DarkwindCombatWeaponStyle;
  off_hand_style?: DarkwindCombatWeaponStyle;
  two_handed?: boolean;
}

export interface DarkwindCombatPublicState {
  condition?: string;
  elite?: DarkwindCombatWireBoolean;
  boss?: DarkwindCombatWireBoolean;
  effects?: string[];
}

export interface DarkwindCombatMovement {
  action?: string;
  target?: string;
  progress?: number;
  required?: number;
}

export interface DarkwindCombatActor {
  id: string;
  name: string;
  role: string;
  appearance?: DarkwindCombatAppearance;
  equipment?: DarkwindCombatEquipment;
  public_state?: DarkwindCombatPublicState;
  occupant_id?: string;
}

export interface DarkwindCombatState {
  version?: 2;
  resync?: boolean;
  epoch: string;
  encounter_id: string;
  seq: number;
  visual_enabled: boolean;
  effective: boolean;
  active: boolean;
  current_actor_id: string;
  current_target_id: string;
  actors: DarkwindCombatActor[];
  outcome: string;
  summary: string;
  position?: "melee" | "ranged";
  preferred_position?: "melee" | "ranged";
  movement?: DarkwindCombatMovement;
}

export type DarkwindCombatAttackResult = "absorb" | "block" | "critical" | "dodge" | "hit" | "miss";
export type DarkwindCombatAbilityResult = "critical" | "hit" | "no-effect";
export type DarkwindCombatResult =
  DarkwindCombatAttackResult | DarkwindCombatAbilityResult | "healed";
export type DarkwindCombatPerspective = "incoming" | "observed" | "outgoing" | "self";

export interface DarkwindCombatEvent {
  seq: number;
  kind: "attack" | "skill" | "spell" | "heal";
  perspective: DarkwindCombatPerspective;
  actor_id: string;
  target_id: string;
  result: DarkwindCombatResult;
  damage?: number;
  pre_mitigation_damage?: number;
  absorbed?: number;
  healing?: number;
  ability_id?: string;
  ability_name?: string;
  summary: string;
}

export interface DarkwindCombatOverflowV1 {
  omitted: number;
  hits: number;
  damage: number;
}

export interface DarkwindCombatOverflowV2 {
  omitted: number;
  omitted_by_kind: { attack: number; skill: number; spell: number; heal: number };
  damage?: number;
  healing?: number;
}
export type DarkwindCombatOverflow = DarkwindCombatOverflowV1 | DarkwindCombatOverflowV2;

export interface DarkwindCombatEvents {
  version?: 2;
  epoch: string;
  encounter_id: string;
  first_seq: number;
  last_seq: number;
  events: DarkwindCombatEvent[];
  overflow: DarkwindCombatOverflow;
}

/** Compatibility shape for the retained singular Darkwind.Combat.Event package. */
export interface DarkwindCombatEventMessage extends DarkwindCombatEvent {
  version?: 2;
  epoch: string;
  encounter_id: string;
}

/** Darkwind.Combat.Resync is deliberately sent without a payload. */
export type DarkwindCombatResync = undefined;
export const DARKWIND_COMBAT_RESYNC: DarkwindCombatResync = undefined;

type NamedFields = Record<string, unknown>;

function record(input: unknown): NamedFields | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as NamedFields)
    : null;
}

function text(input: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof input !== "string") return null;
  // Match the retained core's terminal-safe text cleanup.
  // eslint-disable-next-line no-control-regex
  const value = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/g, "").trim();
  return value.length <= maximum && (allowEmpty || value.length > 0) ? value : null;
}

function integer(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : null;
}

function protocolBoolean(input: unknown): boolean | null {
  if (input === true || input === 1) return true;
  if (input === false || input === 0) return false;
  return null;
}

function own(value: NamedFields, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Selects only State fields and caps actors before any actor is traversed. */
export function extractDarkwindCombatStateFields(input: unknown): NamedFields | null {
  const value = record(input);
  if (!value) return null;
  if (value.actors !== undefined && !Array.isArray(value.actors)) return null;
  return {
    epoch: value.epoch,
    encounter_id: value.encounter_id,
    seq: value.seq,
    visual_enabled: value.visual_enabled,
    effective: value.effective,
    active: value.active,
    current_actor_id: value.current_actor_id,
    current_target_id: value.current_target_id,
    actors: Array.isArray(value.actors) ? value.actors.slice(0, DARKWIND_COMBAT_ACTOR_LIMIT) : [],
    outcome: value.outcome,
    summary: value.summary,
    position: value.position,
    preferred_position: value.preferred_position,
    movement: value.movement,
    version: value.version,
    resync: value.resync,
  };
}

function normalizeActor(input: unknown): DarkwindCombatActor | null {
  const value = record(input);
  if (!value) return null;
  const id = text(value.id, 96);
  const name = text(value.name, 120);
  const role = text(value.role ?? "participant", 32);
  if (!id || !name || !role) return null;
  const actor: DarkwindCombatActor = { id, name, role: role.toLowerCase() };
  if (own(value, "appearance")) {
    actor.appearance = normalizeAppearance(value.appearance) ?? {};
  }
  if (own(value, "equipment")) {
    actor.equipment = normalizeEquipment(value.equipment) ?? {};
  }
  if (own(value, "public_state")) actor.public_state = normalizePublicState(value.public_state);
  const occupantId = text(value.occupant_id, 96);
  if (occupantId) actor.occupant_id = occupantId;
  return actor;
}

function normalizePublicState(input: unknown): DarkwindCombatPublicState {
  const value = record(input);
  if (!value) return {};
  const result: DarkwindCombatPublicState = {};
  const condition = text(value.condition, 80, true);
  if (condition !== null) result.condition = condition;
  for (const field of ["elite", "boss"] as const) {
    const flag = protocolBoolean(value[field]);
    if (flag !== null) result[field] = flag;
  }
  if (Array.isArray(value.effects))
    result.effects = value.effects
      .slice(0, 14)
      .map((effect) => text(effect, 32))
      .filter((effect): effect is string => effect !== null);
  return result;
}

function normalizeMovement(input: unknown): DarkwindCombatMovement {
  const value = record(input);
  if (!value) return {};
  const result: DarkwindCombatMovement = {};
  for (const field of ["action", "target"] as const) {
    const label = text(value[field], 80, true);
    if (label !== null) result[field] = label;
  }
  for (const field of ["progress", "required"] as const) {
    const count = integer(value[field]);
    if (count !== null) result[field] = count;
  }
  return result;
}

function normalizeAppearance(input: unknown): DarkwindCombatAppearance | null {
  const value = record(input);
  if (!value) return null;
  const result: DarkwindCombatAppearance = {};
  for (const field of ["race", "family", "gender", "form"] as const) {
    if (!own(value, field)) continue;
    const normalized = text(value[field], 80, true);
    if (normalized === null) continue;
    result[field] = normalized;
  }
  if (own(value, "size")) {
    const size = text(value.size, 80, true)?.toLowerCase();
    if (size && ["tiny", "small", "medium", "large", "huge"].includes(size))
      result.size = size as DarkwindCombatSize;
  }
  return result;
}

function normalizeEquipment(input: unknown): DarkwindCombatEquipment | null {
  const value = record(input);
  if (!value) return null;
  const result: DarkwindCombatEquipment = {};
  for (const field of ["main_hand", "off_hand", "shield", "helmet", "armor"] as const) {
    if (!own(value, field)) continue;
    const normalized = text(value[field], 80, true);
    if (normalized === null) continue;
    result[field] = normalized;
  }
  const enums = {
    weapon_type: ["focus", "missile", "polearm", "cleaving", "crushing", "piercing", "slashing"],
    off_hand_type: ["focus", "missile", "polearm", "cleaving", "crushing", "piercing", "slashing"],
    weapon_style: ["slash", "thrust", "smash"],
    off_hand_style: ["slash", "thrust", "smash"],
  } as const;
  for (const field of Object.keys(enums) as (keyof typeof enums)[]) {
    if (!own(value, field)) continue;
    const normalized = text(value[field], 24)?.toLowerCase();
    if (!normalized || !(enums[field] as readonly string[]).includes(normalized)) continue;
    result[field] = normalized as never;
  }
  if (own(value, "two_handed")) {
    const normalized = protocolBoolean(value.two_handed);
    if (normalized !== null) result.two_handed = normalized;
  }
  return result;
}

/** Returns a clean, bounded Combat State or null for malformed retained fields. */
export function normalizeDarkwindCombatState(input: unknown): DarkwindCombatState | null {
  const value = extractDarkwindCombatStateFields(input);
  if (!value) return null;
  const epoch = text(value.epoch, 128);
  const encounterId = text(value.encounter_id, 128, true);
  const seq = integer(value.seq);
  const visualEnabled = protocolBoolean(value.visual_enabled);
  const effective = protocolBoolean(value.effective);
  const active = protocolBoolean(value.active);
  const currentActorId = text(value.current_actor_id ?? "", 96, true);
  const currentTargetId = text(value.current_target_id ?? "", 96, true);
  const outcome = text(value.outcome ?? "", 48, true);
  const summary = text(value.summary ?? "", 320, true);
  const version = value.version === undefined ? undefined : integer(value.version);
  const resync = value.resync === undefined ? undefined : protocolBoolean(value.resync);
  if (
    !epoch ||
    encounterId === null ||
    seq === null ||
    visualEnabled === null ||
    effective === null ||
    active === null ||
    currentActorId === null ||
    currentTargetId === null ||
    outcome === null ||
    summary === null ||
    (active && !encounterId) ||
    (version !== undefined && version !== 1 && version !== 2) ||
    resync === null
  )
    return null;

  const actors: DarkwindCombatActor[] = [];
  for (const raw of value.actors as unknown[]) {
    const actor = normalizeActor(raw);
    if (!actor) return null;
    actors.push(actor);
  }
  return {
    epoch,
    encounter_id: encounterId,
    seq,
    visual_enabled: visualEnabled,
    effective,
    active,
    current_actor_id: currentActorId,
    current_target_id: currentTargetId,
    actors,
    outcome: outcome.toLowerCase(),
    summary,
    ...(version === 2 ? { version: 2 as const } : {}),
    ...(resync === undefined ? {} : { resync }),
    ...(["melee", "ranged"].includes(String(value.position))
      ? { position: value.position as "melee" | "ranged" }
      : {}),
    ...(["melee", "ranged"].includes(String(value.preferred_position))
      ? { preferred_position: value.preferred_position as "melee" | "ranged" }
      : {}),
    ...(value.movement !== undefined ? { movement: normalizeMovement(value.movement) } : {}),
  };
}

function normalizeEventRow(input: unknown, version = 1): DarkwindCombatEvent | null {
  const value = record(input);
  if (!value) return null;
  const seq = integer(value.seq);
  const kind = text(value.kind, 32)?.toLowerCase();
  const perspective = text(value.perspective, 24)?.toLowerCase();
  const actorId = text(value.actor_id, 96);
  const targetId = text(value.target_id, 96);
  const result = text(value.result, 24)?.toLowerCase();
  const summary = text(value.summary ?? "", 320, true);
  if (
    seq === null ||
    seq < 1 ||
    !(version === 2 ? ["attack", "skill", "spell", "heal"] : ["attack"]).includes(kind ?? "") ||
    !["incoming", "observed", "outgoing", ...(version === 2 ? ["self"] : [])].includes(
      perspective ?? "",
    ) ||
    !actorId ||
    !targetId ||
    (perspective === "self" && (kind !== "heal" || actorId !== targetId)) ||
    !(
      (kind === "attack" &&
        ["absorb", "block", "critical", "dodge", "hit", "miss"].includes(result ?? "")) ||
      ((kind === "skill" || kind === "spell") &&
        ["hit", "critical", "no-effect"].includes(result ?? "")) ||
      (kind === "heal" && ["healed", "no-effect"].includes(result ?? ""))
    ) ||
    summary === null
  )
    return null;

  const event: DarkwindCombatEvent = {
    seq,
    kind,
    perspective: perspective as DarkwindCombatPerspective,
    actor_id: actorId,
    target_id: targetId,
    result: result as DarkwindCombatResult,
    summary,
  };
  if (kind !== "attack") {
    const abilityId = text(value.ability_id, 96);
    const abilityName = text(value.ability_name, 96);
    if (!abilityId || !abilityName || /[\\/]/.test(abilityId)) return null;
    event.ability_id = abilityId;
    event.ability_name = abilityName;
  }
  for (const field of ["damage", "pre_mitigation_damage", "absorbed"] as const) {
    if (!own(value, field)) continue;
    const amount = integer(value[field]);
    if (amount === null) return null;
    event[field] = amount;
  }
  if (kind === "heal" && own(value, "healing")) {
    const amount = integer(value.healing);
    if (amount === null) return null;
    event.healing = amount;
  } else if (kind !== "heal" && own(value, "healing")) return null;
  if (
    kind === "heal" &&
    (own(value, "damage") || own(value, "pre_mitigation_damage") || own(value, "absorbed"))
  )
    return null;
  return event;
}

function normalizeOverflow(input: unknown, version: number): DarkwindCombatOverflow | null {
  if (version === 2) {
    if (input === undefined)
      return { omitted: 0, omitted_by_kind: { attack: 0, skill: 0, spell: 0, heal: 0 } };
    const value = record(input);
    const byKind = value && record(value.omitted_by_kind);
    const omitted = value && integer(value.omitted);
    if (!value || !byKind || omitted === null) return null;
    const counts = {
      attack: integer(byKind.attack),
      skill: integer(byKind.skill),
      spell: integer(byKind.spell),
      heal: integer(byKind.heal),
    };
    if (Object.values(counts).some((count) => count === null)) return null;
    const result: DarkwindCombatOverflowV2 = {
      omitted,
      omitted_by_kind: counts as DarkwindCombatOverflowV2["omitted_by_kind"],
    };
    for (const field of ["damage", "healing"] as const) {
      if (!own(value, field)) continue;
      const amount = integer(value[field]);
      if (amount === null) return null;
      result[field] = amount;
    }
    return result;
  }
  if (input === undefined) return { omitted: 0, hits: 0, damage: 0 };
  const value = record(input);
  if (!value) return null;
  const omitted = integer(value.omitted);
  const hits = integer(value.hits);
  const damage = integer(value.damage);
  return omitted === null || hits === null || damage === null ? null : { omitted, hits, damage };
}

/** Selects only Events fields and caps events before any event is traversed. */
export function extractDarkwindCombatEventsFields(input: unknown): NamedFields | null {
  const value = record(input);
  if (!value || !Array.isArray(value.events)) return null;
  return {
    epoch: value.epoch,
    encounter_id: value.encounter_id,
    first_seq: value.first_seq,
    last_seq: value.last_seq,
    events: value.events.slice(0, DARKWIND_COMBAT_EVENT_LIMIT),
    overflow: value.overflow,
    version: value.version,
  };
}

/** Returns a clean, bounded Combat Events batch or null for malformed retained fields. */
export function normalizeDarkwindCombatEvents(input: unknown): DarkwindCombatEvents | null {
  const value = extractDarkwindCombatEventsFields(input);
  if (!value) return null;
  const epoch = text(value.epoch, 128);
  const encounterId = text(value.encounter_id, 128);
  const firstSeq = integer(value.first_seq);
  const lastSeq = integer(value.last_seq);
  const version = value.version === undefined ? 1 : integer(value.version);
  if (version !== 1 && version !== 2) return null;
  const overflow = normalizeOverflow(value.overflow, version);
  if (
    !epoch ||
    !encounterId ||
    firstSeq === null ||
    firstSeq < 1 ||
    lastSeq === null ||
    lastSeq < firstSeq ||
    !overflow
  )
    return null;

  const events: DarkwindCombatEvent[] = [];
  for (const raw of value.events as unknown[]) {
    const event = normalizeEventRow(raw, version);
    if (!event || event.seq < firstSeq || event.seq > lastSeq) return null;
    events.push(event);
  }
  const omitted = overflow.omitted;
  const omittedKindTotal =
    version === 2
      ? Object.values((overflow as DarkwindCombatOverflowV2).omitted_by_kind).reduce(
          (sum, count) => sum + count,
          0,
        )
      : omitted;
  if (
    version === 2 &&
    (omittedKindTotal !== omitted ||
      lastSeq - firstSeq + 1 !== omitted + events.length ||
      events.some((event, index) => event.seq !== firstSeq + omitted + index))
  )
    return null;
  return {
    epoch,
    encounter_id: encounterId,
    first_seq: firstSeq,
    last_seq: lastSeq,
    events,
    overflow,
    ...(version === 2 ? { version: 2 as const } : {}),
  };
}

/** Selects only singular Event fields before compatibility validation. */
export function extractDarkwindCombatEventFields(input: unknown): NamedFields | null {
  const value = record(input);
  if (!value) return null;
  return {
    epoch: value.epoch,
    encounter_id: value.encounter_id,
    seq: value.seq,
    kind: value.kind,
    perspective: value.perspective,
    actor_id: value.actor_id,
    target_id: value.target_id,
    result: value.result,
    ...(own(value, "damage") ? { damage: value.damage } : {}),
    ...(own(value, "pre_mitigation_damage")
      ? { pre_mitigation_damage: value.pre_mitigation_damage }
      : {}),
    ...(own(value, "absorbed") ? { absorbed: value.absorbed } : {}),
    summary: value.summary,
    version: value.version,
    ability_id: value.ability_id,
    ability_name: value.ability_name,
    ...(own(value, "healing") ? { healing: value.healing } : {}),
  };
}

/** Returns a clean retained singular Event compatibility payload. */
export function normalizeDarkwindCombatEvent(input: unknown): DarkwindCombatEventMessage | null {
  const value = extractDarkwindCombatEventFields(input);
  if (!value) return null;
  const epoch = text(value.epoch, 128);
  const encounterId = text(value.encounter_id, 128);
  const version = value.version === undefined ? 1 : integer(value.version);
  if (version !== 1 && version !== 2) return null;
  const event = normalizeEventRow(value, version);
  return epoch && encounterId && event
    ? {
        epoch,
        encounter_id: encounterId,
        ...(version === 2 ? { version: 2 as const } : {}),
        ...event,
      }
    : null;
}
