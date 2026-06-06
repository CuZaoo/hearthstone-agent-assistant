import type { CardReference } from "../shared/types.js";
import type { EntityState } from "./power-log-model.js";

export const TAG_LINE =
  /TAG_CHANGE Entity=(?:\[(?<entity>.*)\]|(?<simple>\d+)|(?<named>[^\s]+)) tag=(?<tag>[A-Z0-9_]+) value=(?<value>[^\s]+)/;
export const SHOW_LINE =
  /SHOW_ENTITY - Updating Entity=(?:\[(?<entity>.*)\]|(?<simple>\d+)) CardID=(?<cardId>[A-Za-z0-9_]+)/;
export const FULL_LINE =
  /FULL_ENTITY - (?:Creating ID=(?<id>\d+)|Updating \[(?<entity>.*)\]) CardID=(?<cardId>[A-Za-z0-9_]*)/;
export const PLAYER_LINE =
  /Player EntityID=(?<entityId>\d+) PlayerID=(?<playerId>\d+) GameAccountId=\[hi=(?<hi>\d+) lo=(?<lo>\d+)\]/;
export const GAME_ENTITY_LINE = /GameEntity EntityID=(?<entityId>\d+)/;
export const DEBUG_GAME_TYPE = /DebugPrintGame\(\) - GameType=(?<gameType>[A-Z0-9_]+)/;
export const DEBUG_BUILD_NUMBER = /DebugPrintGame\(\) - BuildNumber=(?<build>\d+)/;
export const DEBUG_FORMAT_TYPE =
  /DebugPrintGame\(\) - FormatType=(?<formatType>[A-Z0-9_]+)/;
export const DEBUG_PLAYER =
  /DebugPrintGame\(\) - PlayerID=(?<playerId>\d+), PlayerName=(?<name>.+)$/;
export const UNKNOWN_PLAYER_NAME = /^UNKNOWN\b/;
export const ENTITY_TAG_LINE =
  /(?:GameState|PowerTaskList)\.DebugPrintPower\(\) -\s+tag=(?<tag>[A-Z0-9_]+) value=(?<value>[^\s]+)/;
export const BLOCK_START = /BLOCK_START BlockType=(?<type>[A-Z_]+)/;
export const BLOCK_END = /BLOCK_END/;
export const CREATE_GAME = /CREATE_GAME/;
export const TIMESTAMP = /^D\s+(?<time>\d{2}:\d{2}:\d{2}\.\d+)\s+/;
export const ENTITY_DESCRIPTION =
  /entityName=(?<name>.+?) id=(?<id>\d+) zone=(?<zone>[A-Z]+) zonePos=(?<zonePosition>\d+) cardId=(?<cardId>[A-Za-z0-9_]*) player=(?<controller>\d+)/g;
export const UNKNOWN_ENTITY_NAME = /^UNKNOWN ENTITY\b/;

const RELEVANT_TAGS = new Set([
  "ARMOR",
  "ATK",
  "CARDTYPE",
  "CONTROLLER",
  "COST",
  "CURRENT_PLAYER",
  "DAMAGE",
  "DECK_COUNT",
  "DIVINE_SHIELD",
  "DORMANT",
  "DURABILITY",
  "EXHAUSTED",
  "FATIGUE",
  "FORMAT_TYPE",
  "HEALTH",
  "LIFESTEAL",
  "OVERLOAD_LOCKED",
  "PLAYER_ID",
  "PLAYSTATE",
  "POISONOUS",
  "RESOURCES",
  "RESOURCES_USED",
  "SECRET",
  "TAUNT",
  "TEMP_RESOURCES",
  "TRADEABLE",
  "TURN",
  "ZONE",
  "ZONE_POSITION",
]);

export function parseTagValue(value: string): number | string | boolean {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  return value;
}

export function isVisibleEventTag(tag: string): boolean {
  return [
    "ZONE",
    "DAMAGE",
    "ATK",
    "HEALTH",
    "ARMOR",
    "EXHAUSTED",
    "RESOURCES",
    "OVERLOAD_LOCKED",
  ].includes(tag);
}

export function isRelevantPowerLine(line: string): boolean {
  if (
    !line.includes("DebugPrintPower()") &&
    !line.includes("DebugPrintGame()")
  ) {
    return false;
  }
  const tagStart = line.indexOf(" tag=");
  if (tagStart === -1) {
    return true;
  }
  const valueStart = tagStart + 5;
  const valueEnd = line.indexOf(" ", valueStart);
  const tag = line.slice(valueStart, valueEnd === -1 ? undefined : valueEnd);
  return RELEVANT_TAGS.has(tag);
}

export function shouldReadEntityDescriptionMetadata(line: string): boolean {
  return (
    line.includes("TAG_CHANGE Entity=[") ||
    line.includes("SHOW_ENTITY - Updating Entity=[") ||
    line.includes("FULL_ENTITY - Updating [") ||
    (line.includes("DebugPrintOptions()") &&
      line.includes("mainEntity=[") &&
      line.includes(" zone=HAND "))
  );
}

export function shouldInferSelfFromOptions(line: string): boolean {
  return (
    line.includes("DebugPrintOptions()") &&
    line.includes("mainEntity=[") &&
    line.includes(" zone=HAND ") &&
    /cardId=[A-Za-z0-9_]+/.test(line)
  );
}

export function byZonePosition(a: CardReference, b: CardReference): number {
  return (a.zonePosition ?? 0) - (b.zonePosition ?? 0);
}

export function isCardType(entity: EntityState, name: string, numericValue: number): boolean {
  return (
    String(entity.tags.CARDTYPE) === name ||
    Number(entity.tags.CARDTYPE) === numericValue
  );
}

export function shouldReplaceName(current: string | undefined, next: string): boolean {
  return !current || (UNKNOWN_ENTITY_NAME.test(current) && !UNKNOWN_ENTITY_NAME.test(next));
}

export function visibleEntityName(name: string | undefined): string | undefined {
  return name && !UNKNOWN_ENTITY_NAME.test(name) ? name : undefined;
}
