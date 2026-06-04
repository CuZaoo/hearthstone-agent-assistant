import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PowerLogLocation {
  path: string;
  source: "configured" | "local-app-data" | "hearthstone-deck-tracker";
}

export interface PowerLogLocatorOptions {
  automaticLocations?: boolean;
}

export async function locatePowerLog(
  configuredPath: string,
  options: PowerLogLocatorOptions = {},
): Promise<PowerLogLocation | undefined> {
  const expandedConfiguredPath = expandEnvironmentVariables(configuredPath);
  if (await isFile(expandedConfiguredPath)) {
    return { path: expandedConfiguredPath, source: "configured" };
  }

  const candidates: Array<{
    root: string;
    source: PowerLogLocation["source"];
  }> = [];
  const configuredRoot = dirname(expandedConfiguredPath);
  if (existsSync(configuredRoot)) {
    candidates.push({ root: configuredRoot, source: "configured" });
  }

  if (options.automaticLocations !== false) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push({
        root: join(localAppData, "Blizzard", "Hearthstone", "Logs"),
        source: "local-app-data",
      });
    }

    const hdtRoot = await readHearthstoneDeckTrackerInstallRoot();
    if (hdtRoot) {
      candidates.push({
        root: join(hdtRoot, "Logs"),
        source: "hearthstone-deck-tracker",
      });
    }
  }

  const found: Array<PowerLogLocation & { modifiedMs: number }> = [];
  for (const candidate of dedupeRoots(candidates)) {
    const result = await findLatestPowerLog(candidate.root);
    if (result) {
      found.push({ ...result, source: candidate.source });
    }
  }

  found.sort((left, right) => right.modifiedMs - left.modifiedMs);
  const latest = found[0];
  return latest
    ? { path: latest.path, source: latest.source }
    : undefined;
}

export function expandEnvironmentVariables(path: string): string {
  return path.replace(/%([^%]+)%/g, (_match, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`;
  });
}

async function findLatestPowerLog(
  logsRoot: string,
): Promise<{ path: string; modifiedMs: number } | undefined> {
  if (!existsSync(logsRoot)) {
    return undefined;
  }
  const direct = join(logsRoot, "Power.log");
  const directStats = await safeStat(direct);
  if (directStats?.isFile()) {
    return { path: direct, modifiedMs: directStats.mtimeMs };
  }

  const sessionDirectories: Array<{
    path: string;
    modifiedMs: number;
    name: string;
  }> = [];
  for (const entry of await readdir(logsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(logsRoot, entry.name);
    const directoryStats = await safeStat(path);
    if (directoryStats?.isDirectory()) {
      sessionDirectories.push({
        path,
        modifiedMs: directoryStats.mtimeMs,
        name: entry.name,
      });
    }
  }

  sessionDirectories.sort(
    (left, right) =>
      right.name.localeCompare(left.name) || right.modifiedMs - left.modifiedMs,
  );
  const latestSession = sessionDirectories[0];
  if (!latestSession) {
    return undefined;
  }
  const path = join(latestSession.path, "Power.log");
  const fileStats = await safeStat(path);
  return fileStats?.isFile()
    ? { path, modifiedMs: fileStats.mtimeMs }
    : undefined;
}

async function readHearthstoneDeckTrackerInstallRoot(): Promise<string | undefined> {
  const appData = process.env.APPDATA;
  if (!appData) {
    return undefined;
  }
  const configPath = join(appData, "HearthstoneDeckTracker", "config.xml");
  try {
    const xml = await readFile(configPath, "utf8");
    const value = xml.match(
      /<HearthstoneDirectory>(?<path>[^<]+)<\/HearthstoneDirectory>/,
    )?.groups?.path;
    return value ? decodeXml(value.trim()) : undefined;
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  return Boolean((await safeStat(path))?.isFile());
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function dedupeRoots(
  candidates: Array<{
    root: string;
    source: PowerLogLocation["source"];
  }>,
) {
  const roots = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.root.toLowerCase();
    if (roots.has(key)) {
      return false;
    }
    roots.add(key);
    return true;
  });
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
