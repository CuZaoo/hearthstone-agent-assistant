import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PowerLogParser } from "../src/core/power-log-parser";

describe("PowerLogParser", () => {
  it("builds a visible standard snapshot and infers the local player from hand cards", () => {
    const parser = new PowerLogParser();
    const fixture = readFileSync(
      join(import.meta.dirname, "fixtures", "power-log-standard.txt"),
      "utf8",
    );

    parser.consume(fixture);
    const snapshot = parser.snapshot("test-catalog");

    expect(snapshot.gameMode).toBe("standard");
    expect(snapshot.activePlayer).toBe("self");
    expect(snapshot.turn).toBe(5);
    expect(snapshot.self.mana).toBe(3);
    expect(snapshot.self.hand.map((card) => card.cardId)).toEqual([
      "TEST_CARD_001",
    ]);
    expect(snapshot.self.board[0]?.cardId).toBe("TEST_MINION_001");
    expect(snapshot.opponent.board[0]?.cardId).toBe("TEST_MINION_002");
  });

  it("deduplicates repeated log lines", () => {
    const parser = new PowerLogParser();
    const line =
      "D 12:00:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=1 tag=TURN value=1";

    parser.consumeLine(line);
    const firstRevision = parser.snapshot("test-catalog").revision;
    parser.consumeLine(line);

    expect(parser.snapshot("test-catalog").revision).toBe(firstRevision);
  });

  it("does not deduplicate identical block boundaries", () => {
    const parser = new PowerLogParser();

    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=GameEntity",
    );
    parser.consumeLine(
      "D 12:00:00.002 GameState.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=GameEntity",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() - BLOCK_END",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() - BLOCK_END",
    );

    expect(parser.snapshot("test-catalog").animationPending).toBe(false);
  });

  it("ignores Power.log tags that cannot affect the visible snapshot", () => {
    const parser = new PowerLogParser();

    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=1 tag=INTERNAL_TEST_TAG value=1",
    );

    expect(parser.snapshot("test-catalog").revision).toBe("0");
  });

  it("parses attached entity tags and maps player entity IDs to controller IDs", () => {
    const parser = new PowerLogParser();
    const fixture = readFileSync(
      join(import.meta.dirname, "fixtures", "power-log-attached-tags.txt"),
      "utf8",
    );

    parser.consume(fixture);
    const snapshot = parser.snapshot("test-catalog");

    expect(snapshot.gameMode).toBe("standard");
    expect(snapshot.gameType).toBe("GT_RANKED");
    expect(snapshot.gameBuild).toBe(123456);
    expect(snapshot.activePlayer).toBe("self");
    expect(snapshot.turn).toBe(7);
    expect(snapshot.self.mana).toBe(6);
    expect(snapshot.self.handCount).toBe(1);
    expect(snapshot.self.hero.cardId).toBe("TEST_HERO_001");
    expect(snapshot.opponent.hero.cardId).toBe("TEST_HERO_002");
    expect(snapshot.self.hand[0]?.cardId).toBe("TEST_CARD_001");
    expect(snapshot.self.board.map((card) => card.cardId)).toEqual([
      "TEST_MINION_001",
    ]);
  });

  it("resets the game state when a new game starts", () => {
    const parser = new PowerLogParser();
    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=1 tag=TURN value=9",
    );
    parser.consumeLine("D 12:01:00.001 GameState.DebugPrintPower() - CREATE_GAME");

    expect(parser.snapshot("test-catalog").turn).toBe(0);
  });

  it("does not reset the same game when CREATE_GAME is duplicated at one timestamp", () => {
    const parser = new PowerLogParser();
    parser.consumeLine("D 12:00:00.001 GameState.DebugPrintPower() - CREATE_GAME");
    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintGame() - FormatType=FT_STANDARD",
    );
    parser.consumeLine(
      "D 12:00:00.001 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
    );

    expect(parser.snapshot("test-catalog").gameMode).toBe("standard");
  });

  it("rejects non-constructed game types even when the format is standard", () => {
    const parser = new PowerLogParser();
    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintGame() - GameType=GT_ARENA",
    );
    parser.consumeLine(
      "D 12:00:00.002 GameState.DebugPrintGame() - FormatType=FT_STANDARD",
    );

    expect(parser.snapshot("test-catalog").gameMode).toBe("unsupported");
  });

  it("preserves lowercase suffixes in visible card ids", () => {
    const parser = new PowerLogParser();

    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - Player EntityID=1 PlayerID=1 GameAccountId=[hi=1 lo=2]",
    );
    parser.consumeLine(
      "D 12:00:00.002 GameState.DebugPrintPower() - Player EntityID=2 PlayerID=2 GameAccountId=[hi=0 lo=0]",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=10 CardID=CATA_130e",
    );
    parser.consumeLine(
      "D 12:00:00.004 GameState.DebugPrintPower() - TAG_CHANGE Entity=10 tag=CONTROLLER value=1",
    );
    parser.consumeLine(
      "D 12:00:00.005 GameState.DebugPrintPower() - TAG_CHANGE Entity=10 tag=ZONE value=HAND",
    );
    parser.consumeLine(
      "D 12:00:00.006 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=11 CardID=EDR_001t",
    );
    parser.consumeLine(
      "D 12:00:00.007 GameState.DebugPrintPower() - TAG_CHANGE Entity=11 tag=CONTROLLER value=1",
    );
    parser.consumeLine(
      "D 12:00:00.008 GameState.DebugPrintPower() - TAG_CHANGE Entity=11 tag=ZONE value=PLAY",
    );
    parser.consumeLine(
      "D 12:00:00.009 GameState.DebugPrintPower() - TAG_CHANGE Entity=11 tag=CARDTYPE value=MINION",
    );

    const snapshot = parser.snapshot("test-catalog");

    expect(snapshot.self.hand[0]?.cardId).toBe("CATA_130e");
    expect(snapshot.self.board[0]?.cardId).toBe("EDR_001t");
  });

  it("preserves lowercase suffixes from attached entity descriptions", () => {
    const parser = new PowerLogParser();

    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - Player EntityID=1 PlayerID=1 GameAccountId=[hi=1 lo=2]",
    );
    parser.consumeLine(
      "D 12:00:00.002 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=测试 id=20 zone=HAND zonePos=1 cardId=CATA_139te player=1] tag=ZONE value=HAND",
    );

    expect(parser.snapshot("test-catalog").self.hand[0]?.cardId).toBe(
      "CATA_139te",
    );
  });

  it("parses full entity updates with attached hero descriptions", () => {
    const parser = new PowerLogParser();

    parser.consumeLine(
      "D 12:00:00.001 GameState.DebugPrintPower() - Player EntityID=1 PlayerID=1 GameAccountId=[hi=1 lo=2]",
    );
    parser.consumeLine(
      "D 12:00:00.002 GameState.DebugPrintPower() - Player EntityID=2 PlayerID=2 GameAccountId=[hi=0 lo=0]",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=泰兰德·语风 id=74 zone=PLAY zonePos=0 cardId=HERO_09a player=1] CardID=HERO_09a",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() -         tag=CARDTYPE value=HERO",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() -         tag=HEALTH value=30",
    );
    parser.consumeLine(
      "D 12:00:00.003 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=古尔丹 id=76 zone=PLAY zonePos=0 cardId=HERO_07 player=2] CardID=HERO_07",
    );
    parser.consumeLine(
      "D 12:00:00.004 GameState.DebugPrintPower() -         tag=CARDTYPE value=HERO",
    );
    parser.consumeLine(
      "D 12:00:00.005 GameState.DebugPrintPower() -         tag=HEALTH value=30",
    );

    const snapshot = parser.snapshot("test-catalog");

    expect(snapshot.opponent.hero.cardId).toBe("HERO_07");
    expect(snapshot.opponent.hero.name).toBe("古尔丹");
    expect(snapshot.opponent.hero.health).toBe(30);
  });
});
