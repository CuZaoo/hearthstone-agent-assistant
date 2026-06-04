import { app, nativeImage } from "electron";
import { readdir, writeFile } from "node:fs/promises";
import { extname, join, parse, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.images || !args.out) {
  fail(
    "用法: electron scripts/build-image-features.mjs --images <image-directory> --out <features.json>",
  );
}

await app.whenReady();
try {
  const directory = resolve(args.images);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        [".png", ".jpg", ".jpeg", ".webp"].includes(
          extname(entry.name).toLowerCase(),
        ),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const features = {};
  for (const file of files) {
    const cardId = parse(file.name).name;
    const image = nativeImage.createFromPath(join(directory, file.name));
    if (image.isEmpty()) {
      console.warn(`跳过无法读取的图片: ${file.name}`);
      continue;
    }
    features[cardId] = differenceHash(image);
  }

  await writeFile(
    resolve(args.out),
    `${JSON.stringify({ features }, null, 2)}\n`,
    "utf8",
  );
  console.log(`已生成 ${Object.keys(features).length} 条视觉特征: ${resolve(args.out)}`);
} finally {
  app.quit();
}

function differenceHash(image) {
  const bitmap = image.resize({ width: 9, height: 8 }).toBitmap();
  const bits = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = pixelLuma(bitmap, 9, x, y);
      const right = pixelLuma(bitmap, 9, x + 1, y);
      bits.push(left > right ? 1 : 0);
    }
  }
  let hash = "";
  for (let index = 0; index < bits.length; index += 4) {
    const nibble = bits
      .slice(index, index + 4)
      .reduce((value, bit) => value * 2 + bit, 0);
    hash += nibble.toString(16);
  }
  return hash;
}

function pixelLuma(bitmap, rowWidth, x, y) {
  const offset = (y * rowWidth + x) * 4;
  const blue = bitmap[offset] ?? 0;
  const green = bitmap[offset + 1] ?? 0;
  const red = bitmap[offset + 2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
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

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

