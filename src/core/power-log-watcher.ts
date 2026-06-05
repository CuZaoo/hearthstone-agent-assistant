import { EventEmitter } from "node:events";
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { LogStatus } from "../shared/types.js";
import { PowerLogParser } from "./power-log-parser.js";

const READ_CHUNK_SIZE = 1024 * 1024;
const INITIAL_FAST_FORWARD_THRESHOLD = 8 * 1024 * 1024;
const INITIAL_SCAN_CHUNK_SIZE = 4 * 1024 * 1024;
const GAME_START_MARKER = Buffer.from(
  "GameState.DebugPrintPower() - CREATE_GAME",
);

export interface PowerLogWatcherEvents {
  status: [LogStatus];
  change: [];
  error: [Error];
}

export class PowerLogWatcher extends EventEmitter<PowerLogWatcherEvents> {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private offset = 0;
  private lastSize = 0;
  private lastModifiedMs = 0;
  private lastBirthtimeMs = 0;
  private lastInode = 0;
  private carry = "";
  private decoder = new StringDecoder("utf8");

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
    if (this.polling) {
      return;
    }
    this.polling = true;
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
    } finally {
      this.polling = false;
    }
  }

  private async handleStats(fileStats: Stats): Promise<void> {
    const replaced =
      (this.lastBirthtimeMs > 0 && fileStats.birthtimeMs !== this.lastBirthtimeMs) ||
      (this.lastInode > 0 && fileStats.ino > 0 && fileStats.ino !== this.lastInode);
    const rotated =
      replaced ||
      fileStats.size < this.offset ||
      (this.lastModifiedMs > 0 && fileStats.mtimeMs < this.lastModifiedMs);
    if (rotated) {
      this.offset = 0;
      this.carry = "";
      this.decoder = new StringDecoder("utf8");
      this.parser.reset();
    }

    if (fileStats.size > this.offset) {
      const file = await open(this.path, "r");
      try {
        let position = this.offset;
        if (
          position === 0 &&
          fileStats.size > INITIAL_FAST_FORWARD_THRESHOLD
        ) {
          position = await findLatestGameStart(file, fileStats.size);
          this.offset = position;
        }
        while (position < fileStats.size) {
          const length = Math.min(
            READ_CHUNK_SIZE,
            fileStats.size - position,
          );
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await file.read(buffer, 0, length, position);
          if (bytesRead === 0) {
            break;
          }
          position += bytesRead;
          const content =
            this.carry + this.decoder.write(buffer.subarray(0, bytesRead));
          const lines = content.split(/\r?\n/);
          this.carry = lines.pop() ?? "";
          this.parser.consume(lines.join("\n"));
        }
        this.offset = position;
      } finally {
        await file.close();
      }
      this.emit("change");
    }

    this.lastSize = fileStats.size;
    this.lastModifiedMs = fileStats.mtimeMs;
    this.lastBirthtimeMs = fileStats.birthtimeMs;
    this.lastInode = fileStats.ino;
    this.emit("status", {
      available: true,
      path: this.path,
      message: this.lastSize > 0 ? "Power.log 正在监听。" : "Power.log 为空。",
      lastEventAt: new Date(fileStats.mtimeMs).toISOString(),
    });
  }

}

export async function findLatestGameStart(
  file: FileHandle,
  fileSize: number,
): Promise<number> {
  const marker = GAME_START_MARKER;
  let searchEnd = fileSize;
  let suffix = Buffer.alloc(0);

  while (searchEnd > 0) {
    const length = Math.min(
      INITIAL_SCAN_CHUNK_SIZE,
      searchEnd,
    );
    const start = searchEnd - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, start);
    const window = Buffer.concat([
      buffer.subarray(0, bytesRead),
      suffix,
    ]);
    const markerIndex = window.lastIndexOf(marker);
    if (markerIndex !== -1) {
      return start + lineStartOffset(window, markerIndex);
    }
    suffix = window.subarray(0, Math.min(marker.length - 1, window.length));
    searchEnd = start;
  }

  return 0;
}

function lineStartOffset(buffer: Buffer, offset: number): number {
  const newline = buffer.lastIndexOf(0x0a, offset);
  return newline === -1 ? 0 : newline + 1;
}
