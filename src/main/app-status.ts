import type { CardCatalog } from "../core/card-catalog.js";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  GameStateSnapshot,
  LogStatus,
  VisualValidationReport,
} from "../shared/types.js";

export interface AppStatusInput {
  settings: AppSettings;
  logStatus: LogStatus;
  catalog: CardCatalog;
  snapshot?: GameStateSnapshot;
  analysis?: AnalysisResult;
  visualValidation?: VisualValidationReport;
  busy: boolean;
  message?: string;
  powerLogConfig?: { ok: boolean; message: string };
}

export function buildAppStatus(input: AppStatusInput): AppStatus {
  return {
    settings: input.settings,
    log: input.logStatus,
    catalog: {
      ready: input.catalog.isReady(),
      version: input.catalog.version,
      entryCount: input.catalog.size(),
      gameBuild: input.catalog.gameBuild,
    },
    snapshot: input.snapshot,
    analysis: input.analysis,
    visualValidation: input.visualValidation,
    busy: input.busy,
    message: input.message,
    powerLogConfig: input.powerLogConfig,
  };
}
