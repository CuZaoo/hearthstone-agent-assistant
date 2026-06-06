import type { GameStateSnapshot } from "../../shared/types";
import { cardCost, cardTitle } from "../view-model";

interface BattlefieldPanelProps {
  snapshot?: GameStateSnapshot;
  busy: boolean;
  onStopAnalysis: () => void;
}

export function BattlefieldPanel({ snapshot, busy, onStopAnalysis }: BattlefieldPanelProps) {
  if (!snapshot) {
    return (
      <div className="battlefield">
        <div className="empty-state">
          <p>等待 Power.log 产生对局事件</p>
          <small>启动炉石并进入对局后自动检测</small>
        </div>
      </div>
    );
  }

  return (
    <div className="battlefield">
      <div className="zone">
        <div className="zone-title">✋ 手牌 <span className="count">{snapshot.self.hand.length}</span></div>
        <div className="zone-cards">
          {snapshot.self.hand.map(card => (
            <div className="zone-card" key={card.entityId}>
              <span>{cardTitle(card)} <span className="cost-badge">{cardCost(card)}费</span></span>
              <span className="stats">#{card.entityId}</span>
            </div>
          ))}
          {snapshot.self.hand.length === 0 && (
            <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>
              空手牌
            </div>
          )}
        </div>
      </div>

      <div className="zone">
        <div className="zone-title">🛡 己方战场 <span className="count">{snapshot.self.board.length}</span></div>
        <div className="zone-cards">
          {snapshot.self.board.map(card => (
            <div className="zone-card" key={card.entityId}>
              <span>{cardTitle(card)} {card.attack !== undefined && <span className="stats">{card.attack}/{card.health}</span>}</span>
              <span className="stats">#{card.entityId}{card.taunt ? " [嘲讽]" : ""}{card.exhausted ? " [已行动]" : ""}</span>
            </div>
          ))}
          {snapshot.self.board.length === 0 && (
            <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>
              空场
            </div>
          )}
        </div>
      </div>

      <div className="zone">
        <div className="zone-title">👹 对手战场 <span className="count">{snapshot.opponent.board.length}</span></div>
        <div className="zone-cards">
          {snapshot.opponent.board.map(card => (
            <div className="zone-card" key={card.entityId}>
              <span>{cardTitle(card)} {card.attack !== undefined && <span className="stats">{card.attack}/{card.health}</span>}</span>
              <span className="stats">#{card.entityId}{card.taunt ? <span className="tag-taunt"> [嘲讽]</span> : ""}</span>
            </div>
          ))}
          {snapshot.opponent.board.length === 0 && (
            <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>
              空场
            </div>
          )}
        </div>
      </div>

      <div className="action-strip">
        {busy && (
          <button className="btn-secondary" onClick={onStopAnalysis}>停止</button>
        )}
        <span className="timer">⏱ 对手手牌 {snapshot.opponent.handCount} · 奥秘 {snapshot.opponent.secretCount}</span>
      </div>
    </div>
  );
}
