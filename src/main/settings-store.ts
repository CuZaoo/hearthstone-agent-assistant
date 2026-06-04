import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS } from "../shared/defaults.js";
import type { AppSettings } from "../shared/types.js";

export class SettingsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`,
      "utf8",
    );
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    timeoutMs: Math.min(60_000, Math.max(1_000, settings.timeoutMs)),
    maxCandidates: Math.min(5, Math.max(1, settings.maxCandidates)),
    baseUrl: settings.baseUrl.trim(),
    model: settings.model.trim(),
  };
}

