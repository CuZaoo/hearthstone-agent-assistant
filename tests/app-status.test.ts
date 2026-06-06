import { describe, expect, it } from "vitest";
import { buildAppStatus } from "../src/main/app-status.js";
import type { AppSettings, LogStatus } from "../src/shared/types.js";

describe("buildAppStatus", () => {
  it("projects runtime state into renderer-safe status", () => {
    const settings = {
      powerLogPath: "Power.log",
      agents: [],
      baseUrl: "http://127.0.0.1:8001",
      model: "test-model",
      transport: "chat-completions",
      timeoutMs: 8000,
      maxCandidates: 3,
      overlayVisible: true,
      liveRecommendationsEnabled: false,
      autoAnalyze: false,
      language: "zhCN",
      multiAgentCompareEnabled: false,
      winRateEstimationEnabled: false,
      hotkeys: {
        analyze: "CommandOrControl+Shift+A",
        toggleOverlay: "CommandOrControl+Shift+O",
      },
    } satisfies AppSettings;
    const logStatus = {
      available: true,
      path: "Power.log",
      message: "ok",
    } satisfies LogStatus;
    const catalog = {
      version: "catalog-v1",
      gameBuild: 123456,
      isReady: () => true,
      size: () => 42,
    };

    const status = buildAppStatus({
      settings,
      logStatus,
      catalog: catalog as never,
      busy: true,
      message: "working",
    });

    expect(status.settings).toBe(settings);
    expect(status.log).toBe(logStatus);
    expect(status.catalog).toEqual({
      ready: true,
      version: "catalog-v1",
      entryCount: 42,
      gameBuild: 123456,
    });
    expect(status.busy).toBe(true);
    expect(status.message).toBe("working");
  });
});
