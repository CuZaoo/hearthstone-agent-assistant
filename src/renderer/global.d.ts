import type {
  AdoptionStats,
  AnalysisResult,
  AppSettings,
  AppStatus,
  DiagnosticLogEntry,
  GameInfo,
} from "../shared/types";

declare global {
  interface Window {
    hearthstoneAgent: {
      getStatus(): Promise<AppStatus>;
      saveSettings(settings: AppSettings): Promise<AppStatus>;
      setApiKey(apiKey: string, agentId?: string): Promise<boolean>;
      hasApiKey(agentId?: string): Promise<boolean>;
      analyze(): Promise<AppStatus>;
      testAgentConnection(): Promise<AppStatus>;
      toggleOverlay(): Promise<AppStatus>;
      showMainWindow(): Promise<void>;
    listHistory(): Promise<AnalysisResult[]>;
    listGames(): Promise<GameInfo[]>;
    listAnalysesByGame(gameId: string): Promise<AnalysisResult[]>;
    getAdoptionStats(agentId?: string): Promise<AdoptionStats>;
    getLastAgentRequest(): Promise<any>;
    getLastAgentResponse(): Promise<string | undefined>;
    stopAnalysis(): Promise<AppStatus>;
    onStatusChanged(callback: (status: AppStatus) => void): () => void;
    minimizeWindow(): Promise<void>;
    maximizeWindow(): Promise<void>;
    closeWindow(): Promise<void>;
    getDiagnosticLogs(count?: number): Promise<DiagnosticLogEntry[]>;
    openDiagnosticLog(): Promise<void>;
    openPowerLog(): Promise<void>;
    enablePowerLogging(): Promise<{ ok: boolean; message: string }>;
    onFallbackPrompt(callback: (data: { failedAgentName: string; fallbackAgentName: string; reason: string }) => void): () => void;
    fallbackPromptRespond(useFallback: boolean): Promise<boolean>;
    };
  }
}

export {};
