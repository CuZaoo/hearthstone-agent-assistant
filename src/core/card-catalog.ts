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
  entries: CardCatalogEntry[];
}

export class CardCatalog {
  readonly version: string;
  readonly generatedAt: string;
  readonly locale: "zhCN";
  private readonly entries = new Map<string, CardCatalogEntry>();

  constructor(file: CardCatalogFile) {
    this.version = file.version;
    this.generatedAt = file.generatedAt;
    this.locale = file.locale;
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
    return this.version !== "unconfigured" && this.entries.size > 0;
  }

  list(): CardCatalogEntry[] {
    return [...this.entries.values()];
  }
}
