import type { AgentProfile, AppSettings } from "./types.js";

export function getActiveAgent(settings: AppSettings): AgentProfile {
  return settings.agents.find((agent) => agent.id === settings.activeAgentId) ??
    settings.agents[0] ?? {
      id: "default",
      name: "默认 Agent",
      baseUrl: settings.baseUrl,
      model: settings.model,
      transport: settings.transport,
      timeoutMs: settings.timeoutMs,
    };
}

export function updateAgent(
  settings: AppSettings,
  agentId: string,
  patch: Partial<AgentProfile>,
): AppSettings {
  const agents = settings.agents.map((agent) =>
    agent.id === agentId ? { ...agent, ...patch } : agent,
  );
  const activeAgent = agents.find((agent) => agent.id === agentId);
  return activeAgent
    ? syncLegacyAgentFields({ ...settings, agents }, activeAgent)
    : { ...settings, agents };
}

export function syncLegacyAgentFields(
  settings: AppSettings,
  agent?: AgentProfile,
): AppSettings {
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
