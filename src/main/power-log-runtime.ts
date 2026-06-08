import type { CardCatalog } from "../core/card-catalog.js";
import { PowerLogParser } from "../core/power-log-parser.js";
import { PowerLogWatcher } from "../core/power-log-watcher.js";
import { enrichSnapshotWithCatalog } from "../core/snapshot-enricher.js";
import type {
  AppSettings,
  GameStateSnapshot,
  LogStatus,
} from "../shared/types.js";
import type { HistoryDatabase } from "./history-database.js";
import { inspectPowerLog } from "./power-log-locator.js";

interface PowerLogRuntimeDependencies {
  getSettings(): AppSettings;
  getCatalog(): CardCatalog;
  historyDatabase: HistoryDatabase;
  onLogSourceChanged(): void;
  onSnapshotChanged(snapshot: GameStateSnapshot): void;
  broadcastStatus(): void;
  writeDiagnostic(event: string, data?: Record<string, unknown>): void;
}

export class PowerLogRuntime {
  private readonly parser = new PowerLogParser();

  private watcher: PowerLogWatcher | undefined;
  private discoveryTimer: NodeJS.Timeout | undefined;
  private currentSnapshot: GameStateSnapshot | undefined;
  private logStatus: LogStatus = {
    available: false,
    path: "",
    message: "尚未开始监听对局日志。",
  };

  constructor(private readonly deps: PowerLogRuntimeDependencies) {
    this.parser.onCurrentPlayer = (info) => {
      this.deps.writeDiagnostic("parser.current_player", info);
    };
  }

  status(): LogStatus {
    return this.logStatus;
  }

  snapshot(): GameStateSnapshot | undefined {
    return this.currentSnapshot;
  }

  async start(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    await this.refreshWatcher();
    this.discoveryTimer = setInterval(() => void this.refreshWatcher(), 2_000);
  }

  async refreshCurrentLog(): Promise<void> {
    if (!this.watcher) {
      return;
    }
    try {
      await this.watcher.pollNow();
    } catch (error) {
      this.deps.writeDiagnostic("power_log.refresh_failed", {
        error: error instanceof Error ? error.message : "刷新对局日志失败。",
      });
    }
  }

  dispose(): void {
    this.watcher?.stop();
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
  }

  private async refreshWatcher(): Promise<void> {
    const settings = this.deps.getSettings();
    const inspection = await inspectPowerLog(settings.powerLogPath);
    const location = inspection.location;
    const path = location?.path ?? inspection.expectedPath;
    if (this.watcher?.path === path) {
      return;
    }

    this.watcher?.stop();
    this.parser.reset();
    this.currentSnapshot = undefined;
    this.deps.onLogSourceChanged();
    this.logStatus = {
      available: Boolean(location),
      path,
      message: powerLogStatusMessage(inspection),
    };
    this.watcher = new PowerLogWatcher(path, this.parser);
    this.watcher.on("status", (nextStatus) => {
      this.logStatus = nextStatus;
      this.deps.broadcastStatus();
    });
    this.watcher.on("change", () => {
      try {
        const catalog = this.deps.getCatalog();
        const next = enrichSnapshotWithCatalog(
          this.parser.snapshot(catalog.version),
          catalog,
        );
        this.currentSnapshot = next;
        this.deps.onSnapshotChanged(next);
        this.deps.historyDatabase.saveSnapshot(next);
        this.deps.broadcastStatus();
      } catch (error) {
        this.deps.writeDiagnostic("power_log.change_handler_error", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    });
    this.watcher.on("error", (error) => {
      this.logStatus = {
        available: false,
        path,
        message: `日志监听失败：${error.message}`,
      };
      this.deps.broadcastStatus();
    });
    this.watcher.start();
    this.deps.broadcastStatus();
  }
}

function powerLogStatusMessage(
  inspection: Awaited<ReturnType<typeof inspectPowerLog>>,
): string {
  if (inspection.location) {
    return `已发现对局日志：${inspection.location.source}`;
  }
  if (inspection.latestSession) {
    return `已发现最新炉石日志目录，但其中没有对局日志文件：${inspection.latestSession.powerLogPath}。请确认已手动启用对局日志；未进入对局时也可能暂未生成。`;
  }
  return "未找到对局日志，请启动炉石并确认已手动启用日志。";
}
