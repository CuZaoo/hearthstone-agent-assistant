import Database from "better-sqlite3";
import type { AnalysisResult, GameStateSnapshot } from "../shared/types.js";

export class HistoryDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        revision TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  saveSnapshot(snapshot: GameStateSnapshot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshots (revision, captured_at, payload_json)
         VALUES (?, ?, ?)`,
      )
      .run(snapshot.revision, snapshot.capturedAt, JSON.stringify(snapshot));
  }

  saveAnalysis(result: AnalysisResult): void {
    this.db
      .prepare(
        `INSERT INTO analyses (snapshot_revision, created_at, payload_json)
         VALUES (?, ?, ?)`,
      )
      .run(
        result.snapshotRevision,
        result.createdAt ?? new Date().toISOString(),
        JSON.stringify(result),
      );
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

