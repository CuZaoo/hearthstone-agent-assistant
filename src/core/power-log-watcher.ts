import { EventEmitter } from "node:events";
import { open, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { LogStatus } from "../shared/types.js";
import { PowerLogParser } from "./power-log-parser.js";

export interface PowerLogWatcherEvents {
  status: [LogStatus];
  change: [];
  error: [Error];
}

export class PowerLogWatcher extends EventEmitter<PowerLogWatcherEvents> {
  private timer?: NodeJS.Timeout;
  private offset = 0;
  private lastSize = 0;
  private lastModifiedMs = 0;

  constructor(
    readonly path: string,
    readonly parser: PowerLogParser,
    private readonly intervalMs = 500,
  ) {
    super();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    try {
      const fileStats = await stat(this.path);
      await this.handleStats(fileStats);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        this.emit("status", {
          available: false,
          path: this.path,
          message: "未找到 Power.log，请按文档手动启用炉石日志。",
        });
        return;
      }
      this.emit("error", error as Error);
    }
  }

  private async handleStats(fileStats: Stats): Promise<void> {
    const rotated =
      fileStats.size < this.offset ||
      (this.lastModifiedMs > 0 && fileStats.mtimeMs < this.lastModifiedMs);
    if (rotated) {
      this.offset = 0;
      this.parser.reset();
    }

    if (fileStats.size > this.offset) {
      const length = fileStats.size - this.offset;
      const buffer = Buffer.alloc(length);
      const file = await open(this.path, "r");
      try {
        await file.read(buffer, 0, length, this.offset);
      } finally {
        await file.close();
      }
      this.offset = fileStats.size;
      this.parser.consume(buffer.toString("utf8"));
      this.emit("change");
    }

    this.lastSize = fileStats.size;
    this.lastModifiedMs = fileStats.mtimeMs;
    this.emit("status", {
      available: true,
      path: this.path,
      message: this.lastSize > 0 ? "Power.log 正在监听。" : "Power.log 为空。",
      lastEventAt: new Date(fileStats.mtimeMs).toISOString(),
    });
  }
}

