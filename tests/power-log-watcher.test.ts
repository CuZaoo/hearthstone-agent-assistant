import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PowerLogParser } from "../src/core/power-log-parser";
import { PowerLogWatcher } from "../src/core/power-log-watcher";

const temporaryRoots: string[] = [];
const watchers: PowerLogWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) {
    watcher.stop();
  }
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("PowerLogWatcher", () => {
  it("does not overlap polls while a previous poll is running", async () => {
    const path = await createLog(turnLine(1));
    const watcher = new PowerLogWatcher(path, new PowerLogParser());
    const internal = watcher as unknown as {
      poll(): Promise<void>;
      handleStats(): Promise<void>;
    };
    const original = internal.handleStats.bind(watcher);
    const handleStats = vi
      .spyOn(internal, "handleStats")
      .mockImplementation(async (...args: never[]) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await original(...args);
      });

    await Promise.all([internal.poll(), internal.poll()]);

    expect(handleStats).toHaveBeenCalledTimes(1);
  });

  it("resets the parser when Power.log is replaced by a larger file", async () => {
    const path = await createLog(`${turnLine(1)}\n${"x".repeat(100)}`);
    const parser = new PowerLogParser();
    const watcher = new PowerLogWatcher(path, parser, 10);
    watchers.push(watcher);
    watcher.start();
    await waitFor(() => parser.snapshot("test").turn === 1);

    await rm(path);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path, `${turnLine(7)}\n${"y".repeat(500)}`, "utf8");
    await waitFor(() => parser.snapshot("test").turn === 7);

    expect(parser.snapshot("test").turn).toBe(7);
  });

  it("starts large existing logs from the latest game", async () => {
    const path = await createLog(
      `${[
        createGameLine(),
        turnLine(1),
        "x".repeat(9 * 1024 * 1024),
        createGameLine("12:30:00.001"),
        turnLine(7, "12:30:00.002"),
      ].join("\n")}\n`,
    );
    const parser = new PowerLogParser();
    const watcher = new PowerLogWatcher(path, parser, 10);
    const internal = watcher as unknown as { poll(): Promise<void> };

    await internal.poll();

    expect(parser.snapshot("test").turn).toBe(7);
  });
});

async function createLog(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lscs-power-log-watcher-"));
  temporaryRoots.push(root);
  const path = join(root, "Power.log");
  await writeFile(path, content, "utf8");
  return path;
}

function createGameLine(timestamp = "12:00:00.000"): string {
  return `D ${timestamp} GameState.DebugPrintPower() - CREATE_GAME`;
}

function turnLine(turn: number, timestamp = "12:00:00.001"): string {
  return `D ${timestamp} GameState.DebugPrintPower() - TAG_CHANGE Entity=1 tag=TURN value=${turn}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
