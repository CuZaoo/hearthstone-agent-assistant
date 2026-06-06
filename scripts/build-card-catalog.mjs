import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if ((!args["cards-zh"] && !args["cards-en"]) || !args.out) {
  fail(
    "用法: node scripts/build-card-catalog.mjs --cards-zh <cards-zh.json> [--cards-en <cards-en.json>] [--out <catalog.json>] [--features <features.json>] [--version <version>] [--game-build <build>]",
  );
}

const features = args.features
  ? normalizeFeatures(await readJson(args.features))
  : new Map();

const cardsZh = args["cards-zh"] ? normalizeCards(await readJson(args["cards-zh"])) : [];
const cardsEn = args["cards-en"] ? normalizeCards(await readJson(args["cards-en"])) : [];
const primaryCards = cardsZh.length > 0 ? cardsZh : cardsEn;
const secondaryCards = cardsZh.length > 0 ? cardsEn : [];

const entries = primaryCards.map((card) => {
  const enCard = secondaryCards.find((c) => c.id === card.id);
  return {
    cardId: card.id,
    name: card.name,
    text: card.text ?? "",
    nameZh: cardsZh.length > 0 ? card.name : undefined,
    nameEn: enCard?.name ?? (cardsEn.length > 0 ? card.name : undefined),
    textZh: cardsZh.length > 0 ? (card.text ?? "") : undefined,
    textEn: enCard?.text ?? (cardsEn.length > 0 ? (card.text ?? "") : undefined),
    cost: card.manaCost ?? card.cost ?? 0,
    attack: card.attack,
    health: card.health,
    cardType: normalizeCardType(card.cardType ?? card.type, card.cardTypeId),
    collectible: Boolean(card.collectible),
    imageHash: features.get(card.id),
  };
}).sort((a, b) => a.cardId.localeCompare(b.cardId));

const output = {
  version: args.version ?? new Date().toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
  locale: cardsZh.length > 0 ? "zhCN" : "enUS",
  gameBuild: args["game-build"] ? Number(args["game-build"]) : undefined,
  entries,
};

const missingFeatures = entries.filter((entry) => !entry.imageHash);
await writeFile(resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`已写入 ${entries.length} 张卡牌: ${resolve(args.out)}`);
console.log(`缺少视觉特征: ${missingFeatures.length}`);
if (entries.length === 0) {
  fail("未找到任何卡牌。");
}

function parseArgs(values) {
  const result = {};
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

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function normalizeCards(payload) {
  const cards = Array.isArray(payload) ? payload : payload.cards;
  if (!Array.isArray(cards)) {
    fail("卡牌 JSON 必须是数组，或包含 cards 数组。");
  }
  return cards.filter(
    (card) =>
      card &&
      typeof card.id === "string" &&
      typeof card.name === "string",
  );
}

function normalizeFeatures(payload) {
  const source = payload.features ?? payload;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("视觉特征 JSON 必须是 cardId 到十六进制 dHash 的对象。");
  }
  const entries = Object.entries(source).filter(
    ([cardId, hash]) =>
      typeof cardId === "string" &&
      typeof hash === "string" &&
      /^[0-9a-f]{16}$/i.test(hash),
  );
  return new Map(entries);
}

function normalizeCardType(cardType, cardTypeId) {
  if (typeof cardType === "string" && cardType) {
    return cardType.toUpperCase();
  }
  if (typeof cardType === "undefined" && typeof cardTypeId === "undefined") {
    return "UNKNOWN";
  }
  return (
    {
      3: "HERO",
      4: "MINION",
      5: "SPELL",
      7: "WEAPON",
      10: "HERO_POWER",
      39: "LOCATION",
    }[cardTypeId] ?? "UNKNOWN"
  );
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
