import type {
  ActivePlayer,
  CardReference,
} from "../shared/types";
export {
  getActiveAgent,
  syncLegacyAgentFields,
  updateAgent,
} from "../shared/settings-model";

export function cardTitle(card: CardReference): string {
  return card.name ?? card.cardId ?? `#${card.entityId}`;
}

export function cardCost(card: CardReference): number {
  return card.cost ?? 0;
}

export function turnOwnerLabel(activePlayer?: ActivePlayer): string {
  if (activePlayer === "self") return "己方回合";
  if (activePlayer === "opponent") return "对手回合";
  return "回合未知";
}

export function turnOwnerClass(activePlayer?: ActivePlayer): string {
  if (activePlayer === "self") return "self-turn";
  if (activePlayer === "opponent") return "opponent-turn";
  return "unknown-turn";
}

export function extractAgentLabel(rationale: string): string {
  const match = rationale.match(/^\[(.+?)\]\s*/);
  if (match) return `[${match[1]}] ${rationale.slice(match[0].length).slice(0, 30)}`;
  return rationale.slice(0, 30);
}

export function extractAgentPrefix(rationale: string): string | undefined {
  const match = rationale.match(/^\[(.+?)\]\s*/);
  return match?.[1];
}

export function labelForRank(rank: number): string {
  const map = ["", "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ"];
  return map[rank] ?? `#${rank}`;
}
