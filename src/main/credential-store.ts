import { safeStorage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class CredentialStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "credentials.enc");
  }

  async getApiKey(agentId = "default"): Promise<string | null> {
    const all = await this.loadAll();
    return all[agentId] ?? null;
  }

  async setApiKey(apiKey: string, agentId = "default"): Promise<void> {
    const all = await this.loadAll();
    if (apiKey.trim()) {
      all[agentId] = apiKey.trim();
    } else {
      delete all[agentId];
    }
    await this.saveAll(all);
  }

  private async loadAll(): Promise<Record<string, string>> {
    try {
      const encrypted = await readFile(this.filePath);
      if (!safeStorage.isEncryptionAvailable()) return {};
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async saveAll(data: Record<string, string>): Promise<void> {
    const toSave = Object.fromEntries(Object.entries(data).filter(([, v]) => v));
    if (Object.keys(toSave).length === 0) {
      try { await writeFile(this.filePath, ""); } catch { /* ignore */ }
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(JSON.stringify(toSave));
    await writeFile(this.filePath, encrypted);
  }
}
