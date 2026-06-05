import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
} from "../shared/types";

declare global {
  interface Window {
    hearthstoneAgent: {
      getStatus(): Promise<AppStatus>;
      saveSettings(settings: AppSettings): Promise<AppStatus>;
      setApiKey(apiKey: string): Promise<boolean>;
      hasApiKey(): Promise<boolean>;
      analyze(): Promise<AppStatus>;
      testAgentConnection(): Promise<AppStatus>;
      toggleOverlay(): Promise<AppStatus>;
      listHistory(): Promise<AnalysisResult[]>;
      onStatusChanged(callback: (status: AppStatus) => void): () => void;
    };
  }
}

export {};
