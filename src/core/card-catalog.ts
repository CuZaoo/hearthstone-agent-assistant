import { readFile } from "node:fs/promises";

export interface CardCatalogEntry {
  cardId: string;
  name: string;
  text: string;
  nameZh?: string;
  nameEn?: string;
  textZh?: string;
  textEn?: string;
  cost: number;
  attack?: number;
  health?: number;
  cardType?: string;
  collectible: boolean;
  standard?: boolean;
  imageHash?: string;
}

export interface CardCatalogFile {
  version: string;
  generatedAt: string;
  locale: string;
  gameBuild?: number;
  entries: CardCatalogEntry[];
}

export class CardCatalog {
  readonly version: string;
  readonly generatedAt: string;
  readonly gameBuild?: number;
  private readonly entries = new Map<string, CardCatalogEntry>();
  private currentLanguage: "zhCN" | "enUS" = "zhCN";

  constructor(file: CardCatalogFile) {
    this.version = file.version;
    this.generatedAt = file.generatedAt;
    this.gameBuild = file.gameBuild;
    for (const entry of [...file.entries, ...BUILT_IN_VISIBLE_CARDS]) {
      if (!this.entries.has(entry.cardId)) {
        this.entries.set(entry.cardId, normalizeEntry(entry));
      }
    }
  }

  static async load(path: string): Promise<CardCatalog> {
    const raw = await readFile(path, "utf8");
    const file = JSON.parse(raw) as CardCatalogFile;
    return new CardCatalog(file);
  }

  setLanguage(lang: "zhCN" | "enUS"): void {
    this.currentLanguage = lang;
  }

  get language(): "zhCN" | "enUS" {
    return this.currentLanguage;
  }

  get(cardId?: string): CardCatalogEntry | undefined {
    if (!cardId) return undefined;
    const entry = this.entries.get(cardId);
    if (!entry) return undefined;
    if (this.currentLanguage === "enUS" && entry.nameEn) {
      return { ...entry, name: entry.nameEn, text: entry.textEn ?? entry.text };
    }
    if (this.currentLanguage === "zhCN" && entry.nameZh) {
      return { ...entry, name: entry.nameZh, text: entry.textZh ?? entry.text };
    }
    return entry;
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

  hasFeatures(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.imageHash) return true;
    }
    return false;
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

function normalizeEntry(entry: CardCatalogEntry): CardCatalogEntry {
  return {
    ...entry,
    nameZh: entry.nameZh ?? entry.name,
    nameEn: entry.nameEn ?? entry.name,
    textZh: entry.textZh ?? entry.text,
    textEn: entry.textEn ?? entry.text,
  };
}

const BUILT_IN_VISIBLE_CARDS: CardCatalogEntry[] = [
  {
    cardId: "AT_037t",
    name: "树苗",
    nameZh: "树苗",
    nameEn: "Sapling",
    text: "",
    textZh: "",
    textEn: "",
    cost: 1,
    attack: 1,
    health: 1,
    cardType: "MINION",
    collectible: false,
    standard: true,
  },
  {
    cardId: "BAR_COIN1",
    name: "幸运币",
    nameZh: "幸运币",
    nameEn: "The Coin",
    text: "在本回合中，获得一个\n法力水晶。",
    textZh: "在本回合中，获得一个\n法力水晶。",
    textEn: "Gain 1 Mana Crystal this turn only.",
    cost: 0,
    cardType: "SPELL",
    collectible: false,
    standard: true,
  },
];
