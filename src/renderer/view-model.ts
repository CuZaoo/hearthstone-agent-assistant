import type {
  ActivePlayer,
  AgentProfile,
  AppSettings,
  CardReference,
} from "../shared/types";

export function getActiveAgent(settings: AppSettings): AgentProfile {
  return settings.agents.find(agent => agent.id === settings.activeAgentId) ??
    settings.agents[0] ?? {
      id: "default", name: "默认 Agent",
      baseUrl: settings.baseUrl, model: settings.model,
      transport: settings.transport, timeoutMs: settings.timeoutMs,
    };
}

export function updateAgent(settings: AppSettings, agentId: string, patch: Partial<AgentProfile>): AppSettings {
  const agents = settings.agents.map(agent => agent.id === agentId ? { ...agent, ...patch } : agent);
  const activeAgent = agents.find(agent => agent.id === agentId);
  return activeAgent ? syncLegacyAgentFields({ ...settings, agents }, activeAgent) : { ...settings, agents };
}

export function syncLegacyAgentFields(settings: AppSettings, agent?: AgentProfile): AppSettings {
  if (!agent) return settings;
  return {
    ...settings,
    activeAgentId: agent.id,
    baseUrl: agent.baseUrl,
    model: agent.model,
    transport: agent.transport,
    timeoutMs: agent.timeoutMs,
  };
}

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
