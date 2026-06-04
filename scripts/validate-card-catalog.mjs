import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = process.argv[2];
if (!path) {
  fail("用法: node scripts/validate-card-catalog.mjs <catalog.json>");
}

const catalog = JSON.parse(await readFile(resolve(path), "utf8"));
const errors = [];
const warnings = [];

if (catalog.locale !== "zhCN") {
  errors.push("locale 必须为 zhCN。");
}
if (!catalog.version || catalog.version === "unconfigured") {
  errors.push("version 尚未配置。");
}
if (!Number.isInteger(catalog.gameBuild) || catalog.gameBuild <= 0) {
  errors.push("gameBuild 未配置，无法检测卡牌快照是否过期。");
}
if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
  errors.push("entries 不能为空。");
}

const ids = new Set();
for (const [index, entry] of (catalog.entries ?? []).entries()) {
  const label = `entries[${index}]`;
  if (!entry.cardId || !entry.name || typeof entry.text !== "string") {
    errors.push(`${label} 缺少 cardId、name 或 text。`);
  }
  if (ids.has(entry.cardId)) {
    errors.push(`${label} 的 cardId 重复: ${entry.cardId}`);
  }
  ids.add(entry.cardId);
  if (!Number.isFinite(entry.cost)) {
    errors.push(`${label} 的 cost 无效。`);
  }
  if (entry.standard !== true) {
    errors.push(`${label} 不是标准模式卡牌。`);
  }
  if (!entry.imageHash) {
    warnings.push(`${entry.cardId} 缺少视觉特征。`);
  } else if (!/^[0-9a-f]{16}$/i.test(entry.imageHash)) {
    errors.push(`${entry.cardId} 的 imageHash 必须是 16 位十六进制 dHash。`);
  }
}

for (const warning of warnings.slice(0, 20)) {
  console.warn(`警告: ${warning}`);
}
if (warnings.length > 20) {
  console.warn(`警告: 另有 ${warnings.length - 20} 条未显示。`);
}
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`错误: ${error}`);
  }
  fail(`卡牌快照校验失败，共 ${errors.length} 个错误。`);
}

console.log(
  `卡牌快照校验通过: ${catalog.entries.length} 张卡牌，${warnings.length} 张缺少视觉特征。`,
);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
