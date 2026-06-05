import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPowerLog, locatePowerLog } from "../src/main/power-log-locator";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("locatePowerLog", () => {
  it("uses an explicitly configured Power.log file", async () => {
    const root = await createTemporaryRoot();
    const path = join(root, "Power.log");
    await writeFile(path, "", "utf8");

    await expect(locatePowerLog(path)).resolves.toEqual({
      path,
      source: "configured",
    });
  });

  it("does not fall back to stale sessions when the latest session has no Power.log", async () => {
    const root = await createTemporaryRoot();
    const logs = join(root, "Logs");
    const oldSession = join(logs, "Hearthstone_2025_01_01_00_00_00");
    const newSession = join(logs, "Hearthstone_2025_01_02_00_00_00");
    await mkdir(oldSession, { recursive: true });
    await writeFile(join(oldSession, "Power.log"), "", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await mkdir(newSession, { recursive: true });

    await expect(
      locatePowerLog(join(logs, "Power.log"), { automaticLocations: false }),
    ).resolves.toBeUndefined();
  });

  it("reports the latest session path when Power.log has not been created yet", async () => {
    const root = await createTemporaryRoot();
    const logs = join(root, "Logs");
    const session = join(logs, "Hearthstone_2025_01_02_00_00_00");
    await mkdir(session, { recursive: true });

    await expect(
      inspectPowerLog(join(logs, "Power.log"), { automaticLocations: false }),
    ).resolves.toMatchObject({
      location: undefined,
      latestSession: {
        path: session,
        powerLogPath: join(session, "Power.log"),
        source: "configured",
      },
    });
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lscs-power-log-"));
  temporaryRoots.push(root);
  return root;
}
