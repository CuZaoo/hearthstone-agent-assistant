import Database from "better-sqlite3";
import type {
  AdoptionRecord,
  AdoptionStats,
  AnalysisResult,
  GameInfo,
  GameStateSnapshot,
} from "../shared/types.js";

export class HistoryDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        hero_class TEXT,
        opponent_class TEXT,
        game_mode TEXT,
        first_turn INTEGER DEFAULT 0,
        last_turn INTEGER DEFAULT 0,
        analysis_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        revision TEXT PRIMARY KEY,
        game_id TEXT,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT,
        snapshot_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adoptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        snapshot_turn INTEGER NOT NULL,
        adopted INTEGER NOT NULL DEFAULT 0,
        matched_actions INTEGER NOT NULL DEFAULT 0,
        total_recommended INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.migrate();
  }

  private migrate(): void {
    const tables = this.db.pragma("table_info(analyses)") as Array<{ name: string }>;
    if (!tables.some((c) => c.name === "game_id")) {
      this.db.exec("ALTER TABLE analyses ADD COLUMN game_id TEXT");
    }
    const snapCols = this.db.pragma("table_info(snapshots)") as Array<{ name: string }>;
    if (!snapCols.some((c) => c.name === "game_id")) {
      this.db.exec("ALTER TABLE snapshots ADD COLUMN game_id TEXT");
    }
    const gameCols = this.db.pragma("table_info(games)") as Array<{ name: string }>;
    if (!gameCols.some((c) => c.name === "analysis_count")) {
      this.db.exec("ALTER TABLE games ADD COLUMN analysis_count INTEGER DEFAULT 0");
    }
    this.cleanupDuplicateGames();
  }

  private cleanupDuplicateGames(): void {
    const games = this.db
      .prepare(
        `SELECT game_id, started_at, hero_class, opponent_class, analysis_count FROM games ORDER BY started_at ASC`,
      )
      .all() as Array<{
      game_id: string;
      started_at: string;
      hero_class: string | null;
      opponent_class: string | null;
      analysis_count: number;
    }>;
    if (games.length < 2) return;

    const resolved = games.filter(
      (g) => g.hero_class && g.hero_class !== "未知" && g.opponent_class && g.opponent_class !== "未知",
    );
    const unknownEntries = games.filter(
      (g) => !g.hero_class || g.hero_class === "未知" || !g.opponent_class || g.opponent_class === "未知",
    );
    const mergedIds = new Set<string>();

    for (const ue of unknownEntries) {
      const nearest = resolved.find((r) => {
        const diff = Math.abs(
          new Date(ue.started_at).getTime() - new Date(r.started_at).getTime(),
        );
        return diff < 10 * 60 * 1000;
      });
      if (nearest) {
        this.db
          .prepare(`UPDATE analyses SET game_id = ? WHERE game_id = ?`)
          .run(nearest.game_id, ue.game_id);
        mergedIds.add(ue.game_id);
      }
    }

    const remaining = games.filter((g) => !mergedIds.has(g.game_id));
    let i = 0;
    while (i < remaining.length) {
      let j = i + 1;
      while (j < remaining.length) {
        const a = remaining[i];
        const b = remaining[j];
        const diff = Math.abs(
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        );
        if (
          a.hero_class === b.hero_class &&
          a.opponent_class === b.opponent_class &&
          diff < 10 * 60 * 1000
        ) {
          j++;
        } else {
          break;
        }
      }
      if (j - i > 1) {
        const group = remaining.slice(i, j);
        const canonical = group.reduce((best, g) =>
          g.analysis_count > best.analysis_count ||
          (g.analysis_count === best.analysis_count && g.started_at > best.started_at)
            ? g
            : best,
        );
        for (const g of group) {
          if (g.game_id === canonical.game_id) continue;
          this.db
            .prepare(`UPDATE analyses SET game_id = ? WHERE game_id = ?`)
            .run(canonical.game_id, g.game_id);
          mergedIds.add(g.game_id);
        }
        const count = this.db
          .prepare(`SELECT COUNT(*) as count FROM analyses WHERE game_id = ?`)
          .get(canonical.game_id) as { count: number };
        this.db
          .prepare(`UPDATE games SET analysis_count = ? WHERE game_id = ?`)
          .run(count.count, canonical.game_id);
      }
      i = j;
    }

    for (const gameId of mergedIds) {
      this.db.prepare(`DELETE FROM snapshots WHERE game_id = ?`).run(gameId);
      this.db.prepare(`DELETE FROM games WHERE game_id = ?`).run(gameId);
    }
  }

  saveSnapshot(snapshot: GameStateSnapshot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshots (revision, game_id, captured_at, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(snapshot.revision, snapshot.gameId, snapshot.capturedAt, JSON.stringify(snapshot));
    this.ensureGame(snapshot);
  }

  private ensureGame(snapshot: GameStateSnapshot): void {
    const heroClass = snapshot.self.hero.name ?? "未知";
    const opponentClass = snapshot.opponent.hero.name ?? "未知";
    this.db
      .prepare(
        `INSERT INTO games (game_id, started_at, hero_class, opponent_class, game_mode, first_turn, last_turn)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET
           hero_class = excluded.hero_class,
           opponent_class = excluded.opponent_class,
           last_turn = MAX(last_turn, excluded.last_turn)`,
      )
      .run(
        snapshot.gameId,
        snapshot.capturedAt,
        heroClass,
        opponentClass,
        snapshot.gameMode,
        snapshot.turn,
        snapshot.turn,
      );
  }

  saveAnalysis(result: AnalysisResult): number {
    const createdAt = result.createdAt ?? new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO analyses (snapshot_revision, game_id, created_at, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        result.snapshotRevision,
        result.gameId ?? null,
        createdAt,
        JSON.stringify(result),
      );
    if (result.gameId) {
      this.db
        .prepare(
          `UPDATE games SET analysis_count = analysis_count + 1 WHERE game_id = ?`,
        )
        .run(result.gameId);
    }
    return Number(info.lastInsertRowid);
  }

  listGames(): GameInfo[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM games ORDER BY started_at DESC`,
      )
      .all() as Array<{
        game_id: string;
        started_at: string;
        hero_class: string;
        opponent_class: string;
        game_mode: string;
        first_turn: number;
        last_turn: number;
        analysis_count: number;
      }>;
    return rows.map((r) => ({
      gameId: r.game_id,
      startedAt: r.started_at,
      heroClass: r.hero_class ?? "未知",
      opponentClass: r.opponent_class ?? "未知",
      gameMode: r.game_mode as GameInfo["gameMode"],
      firstTurn: r.first_turn ?? 0,
      lastTurn: r.last_turn ?? 0,
      analysisCount: r.analysis_count ?? 0,
    }));
  }

  listAnalysesByGame(gameId: string): AnalysisResult[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM analyses WHERE game_id = ? ORDER BY id ASC`,
      )
      .all(gameId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as AnalysisResult);
  }

  saveAdoption(record: Omit<AdoptionRecord, "id">): void {
    this.db
      .prepare(
        `INSERT INTO adoptions (analysis_id, agent_id, agent_name, summary, snapshot_turn, adopted, matched_actions, total_recommended, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.analysisId,
        record.agentId,
        record.agentName,
        record.summary,
        record.snapshotTurn,
        record.adopted ? 1 : 0,
        record.matchedActions,
        record.totalRecommended,
        record.createdAt,
      );
  }

  getAdoptionStats(agentId?: string): AdoptionStats {
    const agentFilter = agentId ? "WHERE agent_id = ?" : "";
    const params = agentId ? [agentId] : [];

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM adoptions ${agentFilter}`)
      .get(...params) as { count: number };
    const adoptedRow = this.db
      .prepare(
        `SELECT COUNT(*) as count, SUM(adopted) as adopted, SUM(matched_actions) as matched, SUM(total_recommended) as total
         FROM adoptions ${agentFilter}`,
      )
      .get(...params) as { count: number; adopted: number; matched: number; total: number };

    const perAgent = this.db
      .prepare(
        `SELECT agent_id, agent_name,
                COUNT(*) as analyses,
                SUM(adopted) as adopted
         FROM adoptions
         GROUP BY agent_id
         ORDER BY analyses DESC`,
      )
      .all() as Array<{ agent_id: string; agent_name: string; analyses: number; adopted: number }>;

    const total = Number(totalRow.count);
    const adopted = Number(adoptedRow.adopted ?? 0);
    const matched = Number(adoptedRow.matched ?? 0);
    const totalRec = Number(adoptedRow.total ?? 0);

    return {
      totalAnalyses: total,
      totalAdopted: adopted,
      adoptionRate: total > 0 ? Math.round((adopted / total) * 100) : 0,
      actionsMatched: matched,
      actionsTotal: totalRec,
      actionMatchRate: totalRec > 0 ? Math.round((matched / totalRec) * 100) : 0,
      perAgent: perAgent.map((a) => ({
        agentId: a.agent_id,
        agentName: a.agent_name,
        analyses: Number(a.analyses),
        adopted: Number(a.adopted),
        adoptionRate:
          Number(a.analyses) > 0
            ? Math.round((Number(a.adopted) / Number(a.analyses)) * 100)
            : 0,
      })),
    };
  }

  getAdoptionRecords(limit = 50): AdoptionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM adoptions ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
        id: number; analysis_id: number; agent_id: string; agent_name: string;
        summary: string; snapshot_turn: number; adopted: number;
        matched_actions: number; total_recommended: number; created_at: string;
      }>;
    return rows.map((r) => ({
      id: r.id,
      analysisId: r.analysis_id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      summary: r.summary,
      snapshotTurn: r.snapshot_turn,
      adopted: r.adopted === 1,
      matchedActions: r.matched_actions,
      totalRecommended: r.total_recommended,
      createdAt: r.created_at,
    }));
  }

  listAnalyses(limit = 50): AnalysisResult[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM analyses ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as AnalysisResult);
  }

  setCardCatalogVersion(version: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO metadata (key, value) VALUES ('cardCatalogVersion', ?)`,
      )
      .run(version);
  }

  close(): void {
    this.db.close();
  }
}
