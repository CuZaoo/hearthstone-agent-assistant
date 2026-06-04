import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.cards || !args.sets || !args.out) {
  fail(
    "用法: node scripts/build-card-catalog.mjs --cards <cards.json> --sets <standard-set-ids.json> --out <catalog.json> [--features <features.json>] [--version <version>]",
  );
}

const cardsPayload = await readJson(args.cards);
const standardSetIds = new Set(normalizeSetIds(await readJson(args.sets)));
const features = args.features
  ? normalizeFeatures(await readJson(args.features))
  : new Map();
const cards = normalizeCards(cardsPayload);
const entries = cards
  .filter((card) => standardSetIds.has(card.cardSetId))
  .map((card) => ({
    cardId: card.id,
    name: card.name,
    text: card.text ?? "",
    cost: card.manaCost ?? 0,
    attack: card.attack,
    health: card.health,
    cardType: normalizeCardType(card.cardType, card.cardTypeId),
    collectible: Boolean(card.collectible),
    standard: true,
    imageHash: features.get(card.id),
  }))
  .sort((left, right) => left.cardId.localeCompare(right.cardId));

const output = {
  version: args.version ?? new Date().toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
  locale: "zhCN",
  entries,
};

const missingFeatures = entries.filter((entry) => !entry.imageHash);
await writeFile(resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`已写入 ${entries.length} 张标准卡牌: ${resolve(args.out)}`);
console.log(`缺少视觉特征: ${missingFeatures.length}`);
if (entries.length === 0) {
  fail("没有找到属于指定标准卡池的卡牌，请检查卡牌 JSON 与 set ID 清单。");
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
      typeof card.name === "string" &&
      Number.isInteger(card.cardSetId),
  );
}

function normalizeSetIds(payload) {
  const values = Array.isArray(payload) ? payload : payload.standardSetIds;
  if (!Array.isArray(values)) {
    fail("标准卡池 JSON 必须是 set ID 数组，或包含 standardSetIds 数组。");
  }
  return values.map(Number).filter(Number.isInteger);
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

