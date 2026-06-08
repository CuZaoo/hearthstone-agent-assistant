import { useEffect, useState } from "react";

interface PromptData {
  failedAgentName: string;
  fallbackAgentName: string;
  reason: string;
}

export function FallbackPrompt() {
  const [prompt, setPrompt] = useState<PromptData | null>(null);

  useEffect(() => {
    const unsub = window.hearthstoneAgent.onFallbackPrompt((data) => {
      setPrompt(data);
    });
    return unsub;
  }, []);

  if (!prompt) return null;

  return (
    <div className="fallback-overlay">
      <div className="fallback-panel">
        <div className="confirm-sigil"><span>!</span></div>
        <div className="confirm-copy">
          <h2>Agent 分析失败</h2>
          <p>{prompt.failedAgentName} 分析失败。是否切换到备用 Agent？</p>
          <textarea
            className="fallback-reason"
            readOnly
            value={prompt.reason}
            rows={3}
          />
        </div>
        <div className="confirm-actions">
          <button
            className="btn-confirm-danger"
            onClick={() => respond(true)}
          >
            使用 {prompt.fallbackAgentName}
          </button>
          <button
            className="btn-confirm-cancel"
            onClick={() => respond(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );

  function respond(useFallback: boolean) {
    setPrompt(null);
    window.hearthstoneAgent.fallbackPromptRespond(useFallback);
  }
}
