import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("SettingsStore", () => {
  it("migrates legacy single-agent settings into the default agent profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "lscs-settings-store-"));
    temporaryRoots.push(root);
    const path = join(root, "settings.json");
    await writeFile(
      path,
      JSON.stringify({
        baseUrl: "http://127.0.0.1:8001",
        model: "qwen3.6-35b",
        transport: "chat-completions",
        timeoutMs: 60_000,
      }),
      "utf8",
    );

    const settings = await new SettingsStore(path).load();

    expect(settings.activeAgentId).toBe("default");
    expect(settings.agents[0]).toMatchObject({
      id: "default",
      baseUrl: "http://127.0.0.1:8001",
      model: "qwen3.6-35b",
      transport: "chat-completions",
      timeoutMs: 60_000,
    });
    expect(settings.baseUrl).toBe("http://127.0.0.1:8001");
    expect(settings.model).toBe("qwen3.6-35b");
  });
});
