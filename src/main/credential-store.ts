const SERVICE_NAME = "HearthstoneAgentAssistant";
const API_KEY_ACCOUNT = "agent-api-key";

export class CredentialStore {
  async getApiKey(): Promise<string | null> {
    const keytar = await import("keytar");
    return keytar.getPassword(SERVICE_NAME, API_KEY_ACCOUNT);
  }

  async setApiKey(apiKey: string): Promise<void> {
    const keytar = await import("keytar");
    if (apiKey.trim()) {
      await keytar.setPassword(SERVICE_NAME, API_KEY_ACCOUNT, apiKey.trim());
    } else {
      await keytar.deletePassword(SERVICE_NAME, API_KEY_ACCOUNT);
    }
  }
}

