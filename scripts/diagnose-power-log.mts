import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, resolve } from "node:path";
import { PowerLogParser } from "../src/core/power-log-parser.ts";
import type { GameStateSnapshot } from "../src/shared/types.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.log) {
  fail(
    "用法: npm run log:diagnose -- --log <Power.log> [--catalog-version <version>] [--max-games <count>]",
  );
}

const logPath = resolve(args.log);
const fileStats = await stat(logPath);
const parser = new PowerLogParser();
const games: GameStateSnapshot[] = [];
let lineCount = 0;
let lastCreateGameTimestamp: string | undefined;
const stream = createReadStream(logPath, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of lines) {
  lineCount += 1;
  if (line.includes("CREATE_GAME")) {
    const timestamp = line.match(/^D\s+(?<time>\d{2}:\d{2}:\d{2}\.\d+)/)?.groups
      ?.time;
    if (!timestamp || timestamp !== lastCreateGameTimestamp) {
      if (lastCreateGameTimestamp !== undefined) {
        games.push(parser.snapshot(args["catalog-version"] ?? "diagnostic"));
      }
      lastCreateGameTimestamp = timestamp;
    }
  }
  parser.consumeLine(line);
}
games.push(parser.snapshot(args["catalog-version"] ?? "diagnostic"));

const maxGames = Math.max(1, Number(args["max-games"] ?? 20));
const recentGames = games.slice(-maxGames);
const summary = recentGames.map(summarizeSnapshot);

console.log(
  JSON.stringify(
    {
      logFileName: basename(logPath),
      bytes: fileStats.size,
      lines: lineCount,
      gamesFound: games.length,
      gamesShown: summary.length,
      games: summary,
    },
    null,
    2,
  ),
);

function summarizeSnapshot(snapshot: GameStateSnapshot) {
  return {
    revision: snapshot.revision,
    gameBuild: snapshot.gameBuild,
    gameType: snapshot.gameType,
    gameMode: snapshot.gameMode,
    turn: snapshot.turn,
    activePlayer: snapshot.activePlayer,
    animationPending: snapshot.animationPending,
    self: {
      hero: snapshot.self.hero.cardId,
      health: snapshot.self.hero.health,
      mana: `${snapshot.self.mana}/${snapshot.self.maxMana}`,
      handCount: snapshot.self.handCount,
      hand: snapshot.self.hand.map((card) => card.cardId ?? `entity:${card.entityId}`),
      board: snapshot.self.board.map((card) => card.cardId ?? `entity:${card.entityId}`),
    },
    opponent: {
      hero: snapshot.opponent.hero.cardId,
      health: snapshot.opponent.hero.health,
      handCount: snapshot.opponent.handCount,
      board: snapshot.opponent.board.map(
        (card) => card.cardId ?? `entity:${card.entityId}`,
      ),
    },
    uncertainties: snapshot.uncertainties,
  };
}

function parseArgs(values: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`无效参数: ${key ?? ""}`);
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function fail(message: string): never {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
