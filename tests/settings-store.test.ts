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

  it("normalizes malformed persisted settings instead of throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "lscs-settings-store-"));
    temporaryRoots.push(root);
    const path = join(root, "settings.json");
    await writeFile(
      path,
      JSON.stringify({
        powerLogPath: 42,
        agents: [
          {
            id: "  ",
            name: "",
            baseUrl: null,
            model: 7,
            transport: "bad",
            timeoutMs: "slow",
          },
        ],
        activeAgentId: "missing",
        maxCandidates: 99,
        overlayVisible: "yes",
        language: "frFR",
        hotkeys: {
          analyze: "",
          toggleOverlay: 123,
        },
      }),
      "utf8",
    );

    const settings = await new SettingsStore(path).load();

    expect(settings.powerLogPath).toContain("Power.log");
    expect(settings.activeAgentId).toBe("agent-1");
    expect(settings.agents[0]).toMatchObject({
      id: "agent-1",
      name: "Agent 1",
      baseUrl: "https://api.openai.com",
      model: "",
      transport: "responses",
      timeoutMs: 8000,
    });
    expect(settings.maxCandidates).toBe(5);
    expect(settings.overlayVisible).toBe(true);
    expect(settings.language).toBe("zhCN");
    expect(settings.hotkeys.analyze).toBe("CommandOrControl+Shift+A");
  });
});
