import { describe, expect, it } from "vitest";
import { CardCatalog } from "../src/core/card-catalog";

describe("CardCatalog", () => {
  it("includes built-in visible tokens even when the catalog file omits them", () => {
    const catalog = new CardCatalog({
      version: "test",
      generatedAt: "2026-01-01T00:00:00.000Z",
      locale: "zhCN",
      gameBuild: 123456,
      entries: [],
    });

    expect(catalog.has("AT_037t")).toBe(true);
    expect(catalog.get("AT_037t")).toMatchObject({
      name: "树苗",
      cost: 1,
      attack: 1,
      health: 1,
      cardType: "MINION",
    });
  });
});
