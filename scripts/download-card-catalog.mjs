import { createWriteStream, existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { get } from "node:https";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BANNER = `
  ╔══════════════════════════════════════════════════╗
  ║            🔥  卡牌图鉴下载器   🔥               ║
  ║         Hearthstone Card Catalog Downloader       ║
  ╚══════════════════════════════════════════════════╝
`;

const GOLD = "\x1b[38;5;214m";
const DARK_GOLD = "\x1b[38;5;172m";
const LIGHT_GOLD = "\x1b[38;5;228m";
const RED = "\x1b[38;5;196m";
const GREEN = "\x1b[38;5;82m";
const CYAN = "\x1b[38;5;87m";
const GREY = "\x1b[38;5;243m";
const WHITE = "\x1b[38;5;255m";
const BG_DARK = "\x1b[48;5;235m";
const BG_GOLD = "\x1b[48;5;214m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CLEAR_LINE = "\x1b[2K\r";

const DEFAULT_URL =
  "https://github.com/CuZaoo/hearthstone-agent-assistant/releases/latest/download/card-catalog.zhCN.json";
const TARGET_PATH = resolve(__dirname, "..", "assets", "card-catalog.zhCN.json");

function printBanner() {
  console.log(`${GOLD}${BANNER}${RESET}`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function drawProgressBar(percent, width = 30) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar =
    `${BG_GOLD}${" ".repeat(filled)}${RESET}` +
    `${BG_DARK}${GREY}${" ".repeat(empty)}${RESET}`;
  return `${GOLD}[${bar}${GOLD}] ${WHITE}${percent.toFixed(1)}%${RESET}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { url: DEFAULT_URL, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      result.url = args[i + 1];
      i++;
    } else if (args[i] === "--force") {
      result.force = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      result.help = true;
    }
  }
  return result;
}

function printHelp() {
  console.log(`${GOLD}用法:${RESET} node scripts/download-card-catalog.mjs [选项]

  ${CYAN}--url <URL>${RESET}    自定义下载地址（默认: GitHub Releases）
  ${CYAN}--force${RESET}       强制重新下载，即使文件已存在
  ${CYAN}--help${RESET}        显示此帮助信息

  ${GREY}示例:${RESET}
    node scripts/download-card-catalog.mjs
    node scripts/download-card-catalog.mjs --url https://example.com/catalog.json --force
`);
}

function validateCatalog(catalog) {
  const errors = [];
  if (!catalog.version) errors.push("缺少 version");
  if (!Number.isInteger(catalog.gameBuild) || catalog.gameBuild <= 0)
    errors.push("gameBuild 无效或未配置");
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0)
    errors.push("entries 为空");
  return errors;
}

function printSummary(catalog) {
  const lines = [
    ``,
    `${GOLD}╔══════════════════════════════════════════╗${RESET}`,
    `${GOLD}║${RESET}  ${GREEN}${BOLD}✓ 下载完成！${RESET}`,
    `${GOLD}╠══════════════════════════════════════════╣${RESET}`,
    `${GOLD}║${RESET}  ${GREY}版本:${RESET}     ${WHITE}${catalog.version}${RESET}`,
    `${GOLD}║${RESET}  ${GREY}卡牌数量:${RESET}  ${LIGHT_GOLD}${catalog.entries.length}${RESET}`,
    `${GOLD}║${RESET}  ${GREY}Game Build:${RESET} ${CYAN}#${catalog.gameBuild ?? "未知"}${RESET}`,
    `${GOLD}║${RESET}  ${GREY}语言:${RESET}     ${WHITE}${catalog.locale}${RESET}`,
    `${GOLD}║${RESET}  ${GREY}位置:${RESET}     ${GREY}${TARGET_PATH}${RESET}`,
    `${GOLD}╚══════════════════════════════════════════╝${RESET}`,
    ``,
  ];
  console.log(lines.join("\n"));
}

async function main() {
  const opts = parseArgs();
  if (opts.help) {
    printBanner();
    printHelp();
    process.exit(0);
  }

  printBanner();

  if (!opts.force && existsSync(TARGET_PATH)) {
    const existing = JSON.parse(await readFile(TARGET_PATH, "utf8"));
    if (existing.gameBuild) {
      console.log(
        `${GOLD}♦${RESET} 卡牌图鉴已存在 (v${existing.version}, ` +
          `${existing.entries.length} 张卡牌, build #${existing.gameBuild})`,
      );
      console.log(`${GREY}  使用 --force 可强制重新下载${RESET}`);
      process.exit(0);
    }
  }

  console.log(`${GOLD}♦${RESET} 正在连接服务器...${RESET}\n`);

  await new Promise((resolvePromise, reject) => {
    const file = createWriteStream(TARGET_PATH);
    let receivedBytes = 0;
    let totalBytes = 0;
    let lastPercent = -1;

    get(opts.url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        console.log(`${GOLD}◈${RESET} 重定向到 ${GREY}${redirectUrl}${RESET}\n`);
        get(redirectUrl, (res) => {
          handleResponse(res, file, resolvePromise, reject);
        }).on("error", reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(
          new Error(`服务器返回状态码 ${response.statusCode}`),
        );
        return;
      }

      totalBytes = parseInt(response.headers["content-length"] ?? "0", 10);
      handleResponse(response, file, resolvePromise, reject);
    }).on("error", reject);

    function handleResponse(response, file, resolvePromise, reject) {
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        file.write(chunk);

        if (totalBytes > 0) {
          const percent = (receivedBytes / totalBytes) * 100;
          if (Math.abs(percent - lastPercent) >= 0.5 || percent >= 100) {
            lastPercent = percent;
            const bar = drawProgressBar(percent);
            const size = `${GREEN}${formatBytes(receivedBytes)}${RESET}`;
            process.stdout.write(
              `${CLEAR_LINE}${GOLD}◆${RESET} ${bar} ${size}` +
              `${totalBytes ? ` / ${formatBytes(totalBytes)}` : ""}`,
            );
          }
        } else {
          process.stdout.write(
            `${CLEAR_LINE}${GOLD}◆${RESET} ${GREEN}${formatBytes(receivedBytes)}${RESET} ${GREY}已下载...${RESET}`,
          );
        }
      });

      response.on("end", async () => {
        file.end();
        process.stdout.write("\n\n");

        try {
          const catalog = JSON.parse(
            await readFile(TARGET_PATH, "utf8"),
          );
          const errors = validateCatalog(catalog);
          if (errors.length > 0) {
            await unlink(TARGET_PATH);
            reject(
              new Error(
                `卡牌图鉴文件校验失败:\n${errors.map((e) => `  ${RED}×${RESET} ${e}`).join("\n")}`,
              ),
            );
            return;
          }
          printSummary(catalog);
          resolvePromise();
        } catch (err) {
          await unlink(TARGET_PATH).catch(() => {});
          reject(new Error(`无法解析卡牌图鉴: ${err.message}`));
        }
      });

      response.on("error", (err) => {
        file.close();
        reject(err);
      });
    }
  });
}

main().catch((err) => {
  console.error(`\n${RED}${BOLD}✗ 错误:${RESET} ${err.message}`);
  process.exitCode = 1;
});
