import type { AnalysisResult, CandidateLine, GameStateSnapshot, PlayerAction, RecommendedAction } from "../shared/types.js";
import type { HistoryDatabase } from "./history-database.js";

export function detectPlayerActions(
  before: GameStateSnapshot,
  after: GameStateSnapshot,
): PlayerAction[] {
  const actions: PlayerAction[] = [];

  if (after.activePlayer !== "self" && before.activePlayer === "self") {
    actions.push({ type: "end-turn", description: "结束回合" });
  }

  for (const beforeCard of before.self.hand) {
    const stillPresent = after.self.hand.some(
      (ac) => ac.entityId === beforeCard.entityId,
    );
    if (!stillPresent) {
      actions.push({
        type: "play-card",
        cardId: beforeCard.cardId,
        entityId: beforeCard.entityId,
        description: beforeCard.name ?? beforeCard.cardId ?? "未知卡牌",
      });
    }
  }

  if (
    after.self.mana < before.self.mana &&
    after.self.handCount >= before.self.handCount
  ) {
    const heroPowerPlayed = !actions.some((a) => a.type === "play-card");
    if (heroPowerPlayed) {
      actions.push({ type: "hero-power", description: "使用英雄技能" });
    }
  }

  for (const beforeMinion of before.self.board) {
    const stillPresent = after.self.board.some(
      (am) => am.entityId === beforeMinion.entityId,
    );
    if (!stillPresent) {
      actions.push({
        type: "attack",
        entityId: beforeMinion.entityId,
        description: `${beforeMinion.name ?? "随从"} 攻击`,
      });
    }
  }

  if (after.self.board.length > before.self.board.length) {
    const newMinions = after.self.board.filter(
      (am) => !before.self.board.some((bm) => bm.entityId === am.entityId),
    );
    for (const minion of newMinions) {
      actions.push({
        type: "play-card",
        cardId: minion.cardId,
        entityId: minion.entityId,
        description: minion.name ?? minion.cardId ?? "召唤随从",
      });
    }
  }

  return actions;
}

export function matchActions(
  playerActions: PlayerAction[],
  candidates: CandidateLine[],
): { matched: number; totalRecommended: number } {
  const allRecommended = candidates.flatMap((c) => c.actions);
  const totalRecommended = allRecommended.length;
  let matched = 0;

  for (const pa of playerActions) {
    const found = allRecommended.some((ra: RecommendedAction) => {
      if (ra.type === pa.type) {
        if (pa.type === "play-card" && ra.sourceCardId && pa.cardId) {
          return ra.sourceCardId === pa.cardId;
        }
        if (pa.type === "end-turn") {
          return ra.type === "end-turn";
        }
        return true;
      }
      return false;
    });
    if (found) matched += 1;
  }

  return { matched, totalRecommended };
}

export function recordAdoption(
  db: HistoryDatabase,
  analysisResult: AnalysisResult,
  analysisDbId: number,
  agentId: string,
  agentName: string,
  snapshotTurn: number,
  beforeSnapshot: GameStateSnapshot,
  afterSnapshot: GameStateSnapshot,
): void {
  const playerActions = detectPlayerActions(beforeSnapshot, afterSnapshot);
  const { matched, totalRecommended } = matchActions(
    playerActions,
    analysisResult.candidates,
  );

  if (totalRecommended === 0) return;

  db.saveAdoption({
    analysisId: analysisDbId,
    agentId,
    agentName,
    summary: analysisResult.summary,
    snapshotTurn,
    adopted: matched > 0,
    matchedActions: matched,
    totalRecommended,
    createdAt: new Date().toISOString(),
  });
}
