import { readFile } from "node:fs/promises";

export interface CardCatalogEntry {
  cardId: string;
  name: string;
  text: string;
  cost: number;
  attack?: number;
  health?: number;
  cardType?: string;
  collectible: boolean;
  standard: boolean;
  imageHash?: string;
}

export interface CardCatalogFile {
  version: string;
  generatedAt: string;
  locale: "zhCN";
  gameBuild?: number;
  entries: CardCatalogEntry[];
}

export class CardCatalog {
  readonly version: string;
  readonly generatedAt: string;
  readonly locale: "zhCN";
  readonly gameBuild?: number;
  private readonly entries = new Map<string, CardCatalogEntry>();

  constructor(file: CardCatalogFile) {
    this.version = file.version;
    this.generatedAt = file.generatedAt;
    this.locale = file.locale;
    this.gameBuild = file.gameBuild;
    for (const entry of file.entries) {
      this.entries.set(entry.cardId, entry);
    }
  }

  static async load(path: string): Promise<CardCatalog> {
    const raw = await readFile(path, "utf8");
    const file = JSON.parse(raw) as CardCatalogFile;
    return new CardCatalog(file);
  }

  get(cardId?: string): CardCatalogEntry | undefined {
    return cardId ? this.entries.get(cardId) : undefined;
  }

  has(cardId?: string): boolean {
    return cardId ? this.entries.has(cardId) : false;
  }

  isReady(): boolean {
    return (
      this.version !== "unconfigured" &&
      this.entries.size > 0 &&
      Number.isInteger(this.gameBuild) &&
      (this.gameBuild ?? 0) > 0
    );
  }

  size(): number {
    return this.entries.size;
  }

  matchesGameBuild(gameBuild?: number): boolean | undefined {
    if (gameBuild === undefined || this.gameBuild === undefined) {
      return undefined;
    }
    return gameBuild === this.gameBuild;
  }

  list(): CardCatalogEntry[] {
    return [...this.entries.values()];
  }
}
