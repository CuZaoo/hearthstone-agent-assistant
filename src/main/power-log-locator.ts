import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface PowerLogLocation {
  path: string;
  source: "configured" | "local-app-data" | "hearthstone-deck-tracker";
}

export interface PowerLogInspection {
  location?: PowerLogLocation;
  expectedPath: string;
  latestSession?: {
    path: string;
    powerLogPath: string;
    source: PowerLogLocation["source"];
  };
}

export interface PowerLogLocatorOptions {
  automaticLocations?: boolean;
}

export async function locatePowerLog(
  configuredPath: string,
  options: PowerLogLocatorOptions = {},
): Promise<PowerLogLocation | undefined> {
  return (await inspectPowerLog(configuredPath, options)).location;
}

export async function inspectPowerLog(
  configuredPath: string,
  options: PowerLogLocatorOptions = {},
): Promise<PowerLogInspection> {
  const expandedConfiguredPath = expandEnvironmentVariables(configuredPath);
  if (await isFile(expandedConfiguredPath)) {
    return {
      location: { path: expandedConfiguredPath, source: "configured" },
      expectedPath: expandedConfiguredPath,
    };
  }

  const candidates: Array<{
    root: string;
    source: PowerLogLocation["source"];
  }> = [];
  const configuredRoots = await configuredLogRoots(expandedConfiguredPath);
  for (const root of configuredRoots) {
    candidates.push({ root, source: "configured" });
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
  const latestSessions: Array<
    NonNullable<PowerLogInspection["latestSession"]> & { modifiedMs: number }
  > = [];
  for (const candidate of dedupeRoots(candidates)) {
    const result = await inspectLogsRoot(candidate.root);
    if (result.powerLog) {
      found.push({ ...result.powerLog, source: candidate.source });
    }
    if (result.latestSession) {
      latestSessions.push({
        ...result.latestSession,
        source: candidate.source,
      });
    }
  }

  found.sort((left, right) => right.modifiedMs - left.modifiedMs);
  const latest = found[0];
  latestSessions.sort((left, right) => right.modifiedMs - left.modifiedMs);
  return {
    location: latest
      ? { path: latest.path, source: latest.source }
      : undefined,
    expectedPath: expectedPowerLogPath(expandedConfiguredPath),
    latestSession: latestSessions[0]
      ? {
          path: latestSessions[0].path,
          powerLogPath: latestSessions[0].powerLogPath,
          source: latestSessions[0].source,
        }
      : undefined,
  };
}

export function expandEnvironmentVariables(path: string): string {
  return path.replace(/%([^%]+)%/g, (_match, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`;
  });
}

async function inspectLogsRoot(
  logsRoot: string,
): Promise<{
  powerLog?: { path: string; modifiedMs: number };
  latestSession?: { path: string; powerLogPath: string; modifiedMs: number };
}> {
  if (!existsSync(logsRoot)) {
    return {};
  }
  const direct = join(logsRoot, "Power.log");
  const directStats = await safeStat(direct);
  if (directStats?.isFile()) {
    return { powerLog: { path: direct, modifiedMs: directStats.mtimeMs } };
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
    return {};
  }
  const path = join(latestSession.path, "Power.log");
  const fileStats = await safeStat(path);
  return {
    powerLog: fileStats?.isFile()
      ? { path, modifiedMs: fileStats.mtimeMs }
      : undefined,
    latestSession: {
      path: latestSession.path,
      powerLogPath: path,
      modifiedMs: latestSession.modifiedMs,
    },
  };
}

async function configuredLogRoots(path: string): Promise<string[]> {
  const stats = await safeStat(path);
  if (stats?.isDirectory()) {
    return basename(path).toLowerCase() === "logs"
      ? [path, join(dirname(path), "Logs")]
      : [join(path, "Logs"), path];
  }

  const configuredRoot = dirname(path);
  return existsSync(configuredRoot) ? [configuredRoot] : [];
}

function expectedPowerLogPath(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "power.log") {
    return path;
  }
  if (name === "logs") {
    return join(path, "Power.log");
  }
  return join(path, "Logs", "Power.log");
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

export async function findHearthstoneDirectory(): Promise<string | null> {
  const hdtDir = await readHearthstoneDeckTrackerInstallRoot();
  if (hdtDir) return hdtDir;

  const programFiles = process.env["ProgramFiles(x86)"] ?? process.env.ProgramFiles;
  if (programFiles) {
    const candidate = join(programFiles, "Hearthstone");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function enablePowerLoggingInOptionsFile(): Promise<{
  ok: boolean;
  message: string;
}> {
  const hsDir = await findHearthstoneDirectory();
  if (!hsDir) {
    return {
      ok: false,
      message: "未找到炉石安装目录，请确认炉石已安装。",
    };
  }

  const optionsPath = join(hsDir, "options.txt");
  let lines: string[];
  try {
    const content = await readFile(optionsPath, "utf8");
    lines = content.split(/\r?\n/);
  } catch {
    lines = [];
  }

  let found = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();
    if (/^displaypowerlog=/i.test(trimmed)) {
      found = true;
      if (trimmed !== "displaypowerlog=1") {
        lines[i] = "displaypowerlog=1";
        changed = true;
      }
      break;
    }
  }
  if (!found) {
    lines.push("displaypowerlog=1");
    changed = true;
  }

  if (!changed) {
    return {
      ok: true,
      message: `对局日志记录已启用 (${optionsPath})`,
    };
  }

  try {
    await writeFile(optionsPath, lines.join("\r\n"), "utf8");
    return {
      ok: true,
      message: `已成功写入 ${optionsPath}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `写入 options.txt 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
