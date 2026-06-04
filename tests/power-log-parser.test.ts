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
});

