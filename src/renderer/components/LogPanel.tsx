import { useEffect, useRef, useState } from "react";
import type { DiagnosticLogEntry } from "../../shared/types";

interface LogPanelProps {
  onClose: () => void;
}

export function LogPanel({ onClose }: LogPanelProps) {
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [wrapMode, setWrapMode] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const loadLogs = async () => {
    if (paused) return;
    try {
      const entries = await window.hearthstoneAgent.getDiagnosticLogs(200);
      setLogs(entries);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadLogs();
    const timer = setInterval(loadLogs, 3000);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const filtered = filter
    ? logs.filter((e) =>
        `${e.event} ${JSON.stringify(e)}`.toLowerCase().includes(filter.toLowerCase()),
      )
    : logs;

  const handleCopy = async (entry: DiagnosticLogEntry, index: number) => {
    const { at, event, ...rest } = entry;
    const time = at.slice(11, 23);
    const parts = [time, event, ...Object.entries(rest).map(([k, v]) => {
      if (typeof v === "string") return `${k}=${v}`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${JSON.stringify(v)}`;
    })];
    try {
      await navigator.clipboard.writeText(parts.join(" "));
    } catch {
      await navigator.clipboard.writeText(parts.join(" "));
    }
    setCopiedIdx(index);
    setTimeout(() => setCopiedIdx(null), 1200);
  };

  return (
    <div className="guide-overlay" onClick={onClose} style={{ zIndex: 99 }}>
      <div className="log-panel" onClick={(e) => e.stopPropagation()}>
        <div className="log-header">
          <h2>📋 诊断日志</h2>
          <div className="log-toolbar">
            <input
              className="log-filter"
              placeholder="筛选事件…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="btn-log-action"
              onClick={() => setWrapMode((v) => !v)}
            >
              {wrapMode ? "单行" : "换行"}
            </button>
            <button
              className="btn-log-action"
              onClick={() => { setLogs([]); setPaused(true); }}
            >
              清空显示
            </button>
            {paused && (
              <button
                className="btn-log-action"
                onClick={() => { setPaused(false); }}
              >
                ▶ 恢复自动刷新
              </button>
            )}
            <button
              className="btn-log-action"
              onClick={() => void window.hearthstoneAgent.openDiagnosticLog()}
            >
              打开日志文件
            </button>
            <button
              className="close-btn"
              style={{
                background: "transparent",
                border: "1px solid rgba(201,160,74,0.12)",
                color: "var(--text-muted)",
                width: 28,
                height: 28,
                borderRadius: "50%",
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <div ref={listRef} className={`log-list${wrapMode ? " log-list--wrap" : " log-list--single"}`}>
          {filtered.length === 0 ? (
            <div className="log-empty">暂无日志</div>
          ) : (
            filtered.map((entry, i) => (
              <div
                key={i}
                className={`log-entry${copiedIdx === i ? " log-entry--copied" : ""}`}
                onClick={() => handleCopy(entry, i)}
              >
                <span className="log-time">
                  {entry.at.slice(11, 23)}
                </span>
                <span className={`log-event log-event-${entry.event.replace(/\./g, "-")}`}>
                  {entry.event}
                </span>
                <span className="log-data">
                  {formatLogData(entry)}
                </span>
                {copiedIdx === i && <span className="log-copied-hint">已复制</span>}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function formatLogData(entry: DiagnosticLogEntry): string {
  const { at: _at, event: _event, ...rest } = entry;
  const keys = Object.keys(rest);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = rest[k];
      if (typeof v === "string") return `${k}=${v}`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${JSON.stringify(v)}`;
    })
    .join("  ");
}
