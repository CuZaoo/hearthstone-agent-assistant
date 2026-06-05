import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const viteUrl = "http://localhost:5173";
const mainEntry = join(root, "dist", "main", "main", "index.js");
const mainOutDir = join(root, "dist", "main");
const children = new Set();
const expectedElectronExits = new Set();
let electronProcess;
let restartTimer;

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const vite = start(npx, ["vite"], "vite");
const tsc = start(npx, ["tsc", "-p", "tsconfig.main.json", "--watch"], "tsc");

await waitFor(() => existsSync(mainEntry), "main build output");
await waitForHttp(viteUrl);
startElectron();

watch(mainOutDir, { recursive: true }, (_event, filename) => {
  if (filename && !String(filename).endsWith(".js")) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log("[electron] restarting after main build change");
    startElectron();
  }, 300);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  for (const child of children) {
    killTree(child);
  }
});

function start(command, args, name, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: true,
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (child === electronProcess || expectedElectronExits.delete(child)) {
      if (child === electronProcess) {
        electronProcess = undefined;
      }
      console.log(`[${name}] exited (${signal ?? code ?? 0})`);
      return;
    }
    console.log(`[${name}] exited (${signal ?? code ?? 0}), shutting down`);
    shutdown();
  });
  return child;
}

function startElectron() {
  if (electronProcess) {
    expectedElectronExits.add(electronProcess);
    killTree(electronProcess);
    children.delete(electronProcess);
  }
  electronProcess = start(
    npx,
    ["electron", "."],
    "electron",
    { VITE_DEV_SERVER_URL: viteUrl },
  );
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killTree(child) {
  if (!child.pid || child.killed) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown() {
  for (const child of [...children]) {
    killTree(child);
  }
  process.exit(0);
}
