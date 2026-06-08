import { useCallback, useEffect, useMemo, useState } from "react";

interface DebugPanelProps {
  onClose: () => void;
}

type Tab = "prompt" | "response";

interface ParsedPrompt {
  systemPrompt: string;
  userInstructions: string;
  localHints: string;
  snapshotJson: string;
  customUserPrompt: string;
}

function parseRequestBody(body: unknown): ParsedPrompt {
  const empty: ParsedPrompt = {
    systemPrompt: "",
    userInstructions: "",
    localHints: "",
    snapshotJson: "",
    customUserPrompt: "",
  };
  if (!body || typeof body !== "object") return empty;
  const b = body as Record<string, unknown>;
  let systemPrompt = "";
  let userContent = "";
  if (b.messages && Array.isArray(b.messages)) {
    for (const msg of b.messages) {
      const m = msg as Record<string, unknown>;
      if (m.role === "system") systemPrompt = String(m.content ?? "");
      if (m.role === "user") userContent = String(m.content ?? "");
    }
  } else if (typeof b.instructions === "string") {
    systemPrompt = b.instructions;
    userContent = String(b.input ?? "");
  }
  if (!userContent) return { ...empty, systemPrompt, userInstructions: userContent };
  const snapshotMatch = userContent.match(/\n(\{[\s\S]*\})\s*$/);
  const snapshotJson = snapshotMatch?.[1] ?? "";
  const beforeSnapshot = snapshotMatch
    ? userContent.slice(0, snapshotMatch.index!)
    : userContent;
  const customPromptMatch = beforeSnapshot.match(/\n(.*)$/);
  const customUserPrompt = customPromptMatch?.[1] && !customPromptMatch[1].includes("硬性规则")
    ? customPromptMatch[1]
    : "";
  const instructionsPart = customUserPrompt
    ? beforeSnapshot.slice(0, beforeSnapshot.lastIndexOf("\n" + customUserPrompt))
    : beforeSnapshot;
  const localHintsMatch = instructionsPart.match(/本地合法动作提示：\n[\s\S]*$/);
  const localHints = localHintsMatch?.[0] ?? "";
  const userInstructions = localHints
    ? instructionsPart.slice(0, instructionsPart.indexOf("本地合法动作提示："))
    : instructionsPart;
  return { systemPrompt, userInstructions, localHints, snapshotJson, customUserPrompt };
}

function tryFormatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function CollapsibleSection({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(open ?? false);
  return (
    <div className="dbg-section">
      <button className="dbg-section-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className={`dbg-arrow${expanded ? " dbg-arrow--open" : ""}`}>▶</span>
        {title}
      </button>
      {expanded && <div className="dbg-section-body">{children}</div>}
    </div>
  );
}

export function DebugPanel({ onClose }: DebugPanelProps) {
  const [tab, setTab] = useState<Tab>("prompt");
  const [requestBody, setRequestBody] = useState<unknown>(null);
  const [responseText, setResponseText] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const req = await window.hearthstoneAgent.getLastAgentRequest();
      setRequestBody(req);
    } catch {
      // request body not available yet
    }
    try {
      const res = await window.hearthstoneAgent.getLastAgentResponse();
      setResponseText(res);
    } catch {
      // response text not available yet
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const unsub = window.hearthstoneAgent.onStatusChanged((status) => {
      if (status.analysis && !loading) {
        void fetchData();
      }
    });
    return unsub;
  }, [fetchData, loading]);

  const parsed = useMemo(() => parseRequestBody(requestBody), [requestBody]);

  if (loading) {
    return (
      <div className="guide-overlay" onClick={onClose} style={{ zIndex: 99 }}>
        <div className="dbg-panel" onClick={(e) => e.stopPropagation()}>
          <div className="dbg-loading">加载中…</div>
        </div>
      </div>
    );
  }

  const noData = !requestBody && !responseText;

  return (
    <div className="guide-overlay" onClick={onClose} style={{ zIndex: 99 }}>
      <div className="dbg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dbg-header">
          <h2>🔍 Prompt Debug</h2>
          <div className="dbg-tabs">
            <button
              className={`dbg-tab${tab === "prompt" ? " dbg-tab--active" : ""}`}
              onClick={() => setTab("prompt")}
            >
              提示词
            </button>
            <button
              className={`dbg-tab${tab === "response" ? " dbg-tab--active" : ""}`}
              onClick={() => setTab("response")}
            >
              响应
            </button>
          </div>
          <button className="btn-header-sm" onClick={fetchData} title="刷新">🔄</button>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="dbg-body">
          {noData ? (
            <div className="dbg-empty">
              <p>暂无可用的请求记录——请先执行一次分析。</p>
              <button className="btn-guide btn-guide-sm" onClick={fetchData} style={{marginTop:8}}>
                🔄 重试
              </button>
            </div>
          ) : tab === "prompt" ? (
            <div className="dbg-content">
              <CollapsibleSection title="系统提示词 (System Prompt)" open>
                <pre className="dbg-code">{parsed.systemPrompt || "(无)"}</pre>
              </CollapsibleSection>

              <CollapsibleSection title="用户指令" open>
                <pre className="dbg-code">{parsed.userInstructions || "(无)"}</pre>
              </CollapsibleSection>

              <CollapsibleSection title="本地动作提示">
                <pre className="dbg-code">{parsed.localHints || "(无)"}</pre>
              </CollapsibleSection>

              {parsed.snapshotJson && (
                <CollapsibleSection title="局面快照 JSON">
                  <pre className="dbg-code">{tryFormatJson(parsed.snapshotJson)}</pre>
                </CollapsibleSection>
              )}

              {parsed.customUserPrompt && (
                <CollapsibleSection title="自定义用户提示词">
                  <pre className="dbg-code">{parsed.customUserPrompt}</pre>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="完整请求体">
                <pre className="dbg-code">{JSON.stringify(requestBody, null, 2)}</pre>
              </CollapsibleSection>
            </div>
          ) : (
            <div className="dbg-response">
              <CollapsibleSection title="原始响应文本" open>
                <pre className="dbg-code">{responseText || "(无)"}</pre>
              </CollapsibleSection>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
