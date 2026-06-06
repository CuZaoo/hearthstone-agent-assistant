import type { AgentProfile, AppStatus } from "../../shared/types";
import { turnOwnerClass, turnOwnerLabel } from "../view-model";

interface DossierBarProps {
  status: AppStatus;
  activeAgent: AgentProfile;
  busyElapsed: number;
}

export function DossierBar({ status, activeAgent, busyElapsed }: DossierBarProps) {
  const snapshot = status.snapshot;
  const turnLabel = turnOwnerLabel(snapshot?.activePlayer);
  const turnClass = turnOwnerClass(snapshot?.activePlayer);

  return (
    <div className="dossier">
      <span className="item">
        <span className={`dot ${status.log.available ? "green" : "red"}`} />{" "}
        <span className="val">局面采集</span> {status.log.available ? "已连接" : "未连接"}
      </span>
      <span className="item">📜 卡牌 <span className="val">{status.catalog.entryCount ?? "—"}</span></span>
      {snapshot && <span className="item">⚔️ 回合 <span className="val">{snapshot.turn}</span></span>}
      <span className={`item turn-item ${turnClass}`}>当前 <span className="val">{turnLabel}</span></span>
      {snapshot && <span className="item">⚡ <span className="val">{snapshot.self.mana}</span>/{snapshot.self.maxMana}</span>}
      <span className="item agent-item">Agent <span className="val">{activeAgent.name}</span></span>
      {status.visualValidation && (
        <span className="item">
          <span className={`dot ${status.visualValidation.ok ? "green" : status.visualValidation.errors.length > 0 ? "red" : "amber"}`} />
          视觉校验 <span className="val">{status.visualValidation.matchedEntityIds.length}/{status.visualValidation.matchedEntityIds.length}</span>
        </span>
      )}
      <span className="dossier-right">
        {status.busy && <span>⏱ {busyElapsed}s</span>}
      </span>
    </div>
  );
}
