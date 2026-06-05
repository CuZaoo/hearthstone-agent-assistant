import { useEffect, useState } from "react";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  ActivePlayer,
  CardReference,
  CandidateLine,
} from "../shared/types";

export function App() {
  const overlay = new URLSearchParams(window.location.search).get("view") === "overlay";
  const [status, setStatus] = useState<AppStatus>();
  const [bootError, setBootError] = useState<string>();

  useEffect(() => {
    void window.hearthstoneAgent
      .getStatus()
      .then(setStatus)
      .catch((error: unknown) =>
        setBootError(error instanceof Error ? error.message : "启动失败"),
      );
    return window.hearthstoneAgent.onStatusChanged(setStatus);
  }, []);

  if (bootError) {
    return (
      <div className={overlay ? "overlay-shell" : "app-shell"}>
        启动失败：{bootError}
      </div>
    );
  }
  if (!status) {
    return <div className={overlay ? "overlay-shell" : "app-shell"}>正在启动…</div>;
  }
  return overlay ? <Overlay status={status} /> : <Dashboard status={status} />;
}

function Dashboard({ status }: { status: AppStatus }) {
  const [settings, setSettings] = useState(status.settings);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [history, setHistory] = useState<AnalysisResult[]>([]);

  useEffect(() => setSettings(status.settings), [status.settings]);
  useEffect(() => {
    void window.hearthstoneAgent.hasApiKey().then(setHasApiKey);
    void window.hearthstoneAgent.listHistory().then(setHistory);
  }, [status.analysis]);

  const save = async () => {
    const acceptedAt =
      settings.liveRecommendationsEnabled &&
      !settings.liveRecommendationsRiskAcceptedAt
        ? new Date().toISOString()
        : settings.liveRecommendationsRiskAcceptedAt;
    await window.hearthstoneAgent.saveSettings({
      ...settings,
      liveRecommendationsRiskAcceptedAt: acceptedAt,
    });
    if (apiKey.trim()) {
      setHasApiKey(await window.hearthstoneAgent.setApiKey(apiKey));
      setApiKey("");
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">READ-ONLY ANALYSIS ASSISTANT</p>
          <h1>炉石对局 Agent 助手</h1>
          <p>读取可见局面，校验后生成候选路线。不会操作游戏客户端。</p>
        </div>
        <div className="hero-actions">
          <span className={status.busy ? "status-pill busy" : "status-pill"}>
            {status.busy ? "处理中" : "待命"}
          </span>
          <button className="primary" onClick={() => void window.hearthstoneAgent.analyze()}>
            {status.busy ? "分析中…" : "分析当前局面"}
          </button>
        </div>
      </header>

      <section className="status-grid">
        <StatusCard
          title="Power.log"
          ok={status.log.available}
          detail={`${status.log.message} ${status.log.path}`}
        />
        <StatusCard
          title="卡牌快照"
          ok={status.catalog.ready}
          detail={`${status.catalog.version} · build ${status.catalog.gameBuild ?? "未知"} · ${status.catalog.entryCount} 张`}
        />
        <StatusCard
          title="当前局面"
          ok={Boolean(status.snapshot)}
          detail={
            status.snapshot
              ? `回合 ${status.snapshot.turn} · 手牌 ${status.snapshot.self.handCount} · 场面 ${status.snapshot.self.board.length}/${status.snapshot.opponent.board.length}`
              : "等待日志事件"
          }
        />
        <StatusCard
          title="视觉校验"
          ok={status.visualValidation?.ok === true}
          detail={
            status.visualValidation?.errors[0] ??
            (status.visualValidation
              ? `已匹配 ${status.visualValidation.matchedEntityIds.length} 个实体`
              : "尚未执行")
          }
        />
      </section>

      {status.message && <div className="message">{status.message}</div>}

      <SnapshotPreview status={status} />

      <section className="panel">
        <h2>设置</h2>
        <div className="form-grid">
          <Field label="Power.log 路径或炉石安装目录">
            <input
              value={settings.powerLogPath}
              onChange={(event) =>
                setSettings({ ...settings, powerLogPath: event.target.value })
              }
            />
          </Field>
          <Field label="接口地址">
            <input
              value={settings.baseUrl}
              onChange={(event) =>
                setSettings({ ...settings, baseUrl: event.target.value })
              }
            />
          </Field>
          <Field label="模型名称">
            <input
              value={settings.model}
              placeholder="由接口供应商提供"
              onChange={(event) =>
                setSettings({ ...settings, model: event.target.value })
              }
            />
          </Field>
          <Field label={`API Key ${hasApiKey ? "（已保存）" : "（未保存）"}`}>
            <input
              type="password"
              value={apiKey}
              placeholder="仅保存到 Windows 凭据管理器"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field>
          <Field label="传输协议">
            <select
              value={settings.transport}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  transport: event.target.value as AppSettings["transport"],
                })
              }
            >
              <option value="responses">Responses API</option>
              <option value="chat-completions">Chat Completions API</option>
            </select>
          </Field>
          <Field label="超时（毫秒）">
            <input
              type="number"
              value={settings.timeoutMs}
              onChange={(event) =>
                setSettings({ ...settings, timeoutMs: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="候选路线数量（1-5）">
            <input
              type="number"
              min={1}
              max={5}
              value={settings.maxCandidates}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maxCandidates: Number(event.target.value),
                })
              }
            />
          </Field>
        </div>

        <label className="risk-check">
          <input
            type="checkbox"
            checked={settings.liveRecommendationsEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                liveRecommendationsEnabled: event.target.checked,
                liveRecommendationsRiskAcceptedAt: event.target.checked
                  ? settings.liveRecommendationsRiskAcceptedAt
                  : undefined,
              })
            }
          />
          <span>
            我确认已获得使用正式对局实时建议的授权，并理解账号与合规风险。
          </span>
        </label>

        <div className="button-row">
          <button className="primary" onClick={() => void save()}>
            保存设置
          </button>
          <button onClick={() => void window.hearthstoneAgent.testAgentConnection()}>
            测试 Agent 连接
          </button>
          <button onClick={() => void window.hearthstoneAgent.toggleOverlay()}>
            显示或隐藏悬浮窗
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>最近分析</h2>
        {history.length === 0 ? (
          <p className="muted">暂无历史记录。</p>
        ) : (
          history.slice(0, 8).map((item) => (
            <div className="history-item" key={`${item.snapshotRevision}-${item.createdAt}`}>
              <strong>{item.summary}</strong>
              <span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</span>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

function SnapshotPreview({ status }: { status: AppStatus }) {
  const snapshot = status.snapshot;
  if (!snapshot) {
    return (
      <section className="panel">
        <h2>当前可见局面</h2>
        <p className="muted">等待 Power.log 产生对局事件。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>当前可见局面</h2>
      <div className="snapshot-meta">
        <span>回合 {snapshot.turn}</span>
        <span>行动方：{activePlayerLabel(snapshot.activePlayer)}</span>
        <span>
          法力：{snapshot.self.mana}/{snapshot.self.maxMana}
        </span>
        <span>对手手牌：{snapshot.opponent.handCount}</span>
        <span>对手奥秘：{snapshot.opponent.secretCount}</span>
        {snapshot.animationPending && <span className="stale">动画未结束</span>}
      </div>
      <div className="snapshot-grid">
        <SnapshotColumn
          title="己方手牌"
          empty="未识别到己方手牌"
          cards={snapshot.self.hand}
        />
        <SnapshotColumn
          title="己方场面"
          empty="己方场面为空"
          cards={snapshot.self.board}
        />
        <SnapshotColumn
          title="对手场面"
          empty="对手场面为空"
          cards={snapshot.opponent.board}
        />
      </div>
      {snapshot.uncertainties.length > 0 && (
        <p className="snapshot-warning">
          不确定项：{snapshot.uncertainties.join("；")}
        </p>
      )}
    </section>
  );
}

function SnapshotColumn({
  title,
  empty,
  cards,
}: {
  title: string;
  empty: string;
  cards: CardReference[];
}) {
  return (
    <div className="snapshot-column">
      <h3>
        {title} <span>{cards.length}</span>
      </h3>
      {cards.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="card-list">
          {cards.map((card) => (
            <div className="card-chip" key={card.entityId}>
              <strong>{card.name ?? card.cardId ?? `实体 ${card.entityId}`}</strong>
              <small>{cardDetails(card)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Overlay({ status }: { status: AppStatus }) {
  const analysis = status.analysis;
  return (
    <aside className="overlay-shell">
      <div className="overlay-header">
        <span>Agent 建议</span>
        <span className={analysis?.stale ? "stale" : "live"}>
          {analysis?.stale ? "已过期" : status.busy ? "分析中" : "当前"}
        </span>
      </div>
      {!analysis ? (
        <div className="overlay-empty">
          <p>{status.message ?? "按 Ctrl+Shift+A 分析当前局面"}</p>
          <small>Ctrl+Shift+O 显示或隐藏悬浮窗</small>
        </div>
      ) : (
        <>
          <p className="overlay-summary">{analysis.summary}</p>
          {analysis.candidates.map((candidate) => (
            <Candidate key={candidate.rank} candidate={candidate} />
          ))}
          {analysis.warnings.length > 0 && (
            <div className="warnings">{analysis.warnings.join(" · ")}</div>
          )}
        </>
      )}
    </aside>
  );
}

function Candidate({ candidate }: { candidate: CandidateLine }) {
  return (
    <article className="candidate">
      <div className="candidate-title">
        <strong>路线 {candidate.rank}</strong>
        <span>{Math.round(candidate.confidence * 100)}%</span>
      </div>
      <ol>
        {candidate.actions.map((action, index) => (
          <li key={`${action.type}-${index}`}>{action.description}</li>
        ))}
      </ol>
      <p>{candidate.rationale}</p>
      {candidate.risks.length > 0 && <small>风险：{candidate.risks.join("；")}</small>}
    </article>
  );
}

function activePlayerLabel(activePlayer: ActivePlayer) {
  if (activePlayer === "self") {
    return "己方";
  }
  if (activePlayer === "opponent") {
    return "对手";
  }
  return "未知";
}

function cardDetails(card: CardReference): string {
  const parts = [`#${card.entityId}`];
  if (card.cardId) {
    parts.push(card.cardId);
  }
  if (card.cost !== undefined) {
    parts.push(`${card.cost}费`);
  }
  if (card.attack !== undefined || card.health !== undefined) {
    parts.push(`${card.attack ?? "?"}/${card.health ?? "?"}`);
  }
  if (card.damage) {
    parts.push(`受伤${card.damage}`);
  }
  const flags = [
    card.taunt ? "嘲讽" : undefined,
    card.divineShield ? "圣盾" : undefined,
    card.poisonous ? "剧毒" : undefined,
    card.lifesteal ? "吸血" : undefined,
    card.dormant ? "休眠" : undefined,
    card.exhausted ? "已行动" : undefined,
  ].filter(Boolean);
  return [...parts, ...flags].join(" · ");
}

function StatusCard({
  title,
  ok,
  detail,
}: {
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="status-card">
      <div className="status-title">
        <span className={ok ? "dot ok" : "dot"} />
        <strong>{title}</strong>
      </div>
      <p>{detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
