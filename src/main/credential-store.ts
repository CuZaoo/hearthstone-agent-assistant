const SERVICE_NAME = "HearthstoneAgentAssistant";
const API_KEY_ACCOUNT = "agent-api-key";

export class CredentialStore {
  async getApiKey(agentId = "default"): Promise<string | null> {
    const keytar = await import("keytar");
    const key = await keytar.getPassword(SERVICE_NAME, accountForAgent(agentId));
    if (!key && agentId === "default") {
      return keytar.getPassword(SERVICE_NAME, API_KEY_ACCOUNT);
    }
    return key;
  }

  async setApiKey(apiKey: string, agentId = "default"): Promise<void> {
    const keytar = await import("keytar");
    const account = accountForAgent(agentId);
    if (apiKey.trim()) {
      await keytar.setPassword(SERVICE_NAME, account, apiKey.trim());
    } else {
      await keytar.deletePassword(SERVICE_NAME, account);
    }
  }
}

function accountForAgent(agentId: string): string {
  return `${API_KEY_ACCOUNT}:${agentId}`;
}
