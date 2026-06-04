import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith(".") &&
    specifier.endsWith(".js") &&
    context.parentURL?.endsWith(".ts")
  ) {
    const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    try {
      await access(fileURLToPath(tsUrl));
      return { url: tsUrl.href, shortCircuit: true };
    } catch {
      // Let Node resolve the original specifier.
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") || url.endsWith(".mts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return {
      format: "module",
      source: stripTypeScriptTypes(source, {
        mode: "transform",
        sourceMap: false,
      }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
