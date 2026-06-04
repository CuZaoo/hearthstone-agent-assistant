import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.xml || !args.sets || !args.out) {
  fail(
    "用法: node scripts/import-hdt-carddefs.mjs --xml <CardDefs.base.xml> --sets <standard-set-ids.json> --out <catalog.json> [--features <features.json>] [--version <version>]",
  );
}

const xml = await readFile(resolve(args.xml), "utf8");
const standardSetIds = new Set(normalizeSetIds(await readJson(args.sets)));
const features = args.features
  ? normalizeFeatures(await readJson(args.features))
  : new Map();
const build = xml.match(/<CardDefs build="(?<build>[^"]+)"/)?.groups?.build;
const entries = [];

for (const match of xml.matchAll(
  /<Entity CardID="(?<cardId>[^"]+)"[^>]*>(?<body>[\s\S]*?)<\/Entity>/g,
)) {
  const cardId = decodeXml(match.groups?.cardId ?? "");
  const body = match.groups?.body ?? "";
  const cardSetId = readIntTag(body, "CARD_SET");
  const name = readLocalizedTag(body, "CARDNAME", "zhCN");
  if (!cardId || !name || !standardSetIds.has(cardSetId)) {
    continue;
  }

  entries.push({
    cardId,
    name,
    text: readLocalizedTag(body, "CARDTEXT", "zhCN") ?? "",
    cost: readIntTag(body, "COST") ?? 0,
    attack: readIntTag(body, "ATK"),
    health: readIntTag(body, "HEALTH"),
    cardType: normalizeCardType(readIntTag(body, "CARDTYPE")),
    collectible: readIntTag(body, "COLLECTIBLE") === 1,
    standard: true,
    imageHash: features.get(cardId),
  });
}

entries.sort((left, right) => left.cardId.localeCompare(right.cardId));
const output = {
  version: args.version ?? `hdt-${build ?? "unknown"}`,
  generatedAt: new Date().toISOString(),
  locale: "zhCN",
  gameBuild: build ? Number(build) : undefined,
  entries,
};
await writeFile(resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");

const missingFeatures = entries.filter((entry) => !entry.imageHash).length;
console.log(`已从 CardDefs 写入 ${entries.length} 张标准卡牌: ${resolve(args.out)}`);
console.log(`缺少视觉特征: ${missingFeatures}`);
if (entries.length === 0) {
  fail("没有找到属于指定标准卡池的卡牌，请检查 XML 与 set ID 清单。");
}

function readIntTag(body, name) {
  const escaped = escapeRegExp(name);
  const value = body.match(
    new RegExp(`<Tag[^>]*name="${escaped}"[^>]*value="(?<value>-?\\d+)"[^>]*/>`),
  )?.groups?.value;
  return value === undefined ? undefined : Number(value);
}

function readLocalizedTag(body, name, locale) {
  const escapedName = escapeRegExp(name);
  const escapedLocale = escapeRegExp(locale);
  const tagBody = body.match(
    new RegExp(
      `<Tag[^>]*name="${escapedName}"[^>]*>(?<body>[\\s\\S]*?)<\\/Tag>`,
    ),
  )?.groups?.body;
  const value = tagBody?.match(
    new RegExp(`<${escapedLocale}>(?<value>[\\s\\S]*?)<\\/${escapedLocale}>`),
  )?.groups?.value;
  return value === undefined ? undefined : decodeXml(value.trim());
}

function normalizeCardType(cardTypeId) {
  return (
    {
      2: "PLAYER",
      3: "HERO",
      4: "MINION",
      5: "SPELL",
      6: "ENCHANTMENT",
      7: "WEAPON",
      10: "HERO_POWER",
      39: "LOCATION",
    }[cardTypeId] ?? "UNKNOWN"
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
  return new Map(
    Object.entries(source).filter(
      ([cardId, hash]) =>
        typeof cardId === "string" &&
        typeof hash === "string" &&
        /^[0-9a-f]{16}$/i.test(hash),
    ),
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
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

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
