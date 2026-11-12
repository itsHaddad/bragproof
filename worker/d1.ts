import type { Level } from "../src/receipt/receipt.ts";
import type { Receipt } from "../src/receipt/types.ts";
import { countLevel, type FeedStore, find, insert, type PostRow, type Query, SCHEMA, selectLevel, selectReceipt, shouldReplace, toRow, upgrade } from "../src/feed/sql.ts";

/** The part of Cloudflare D1 this store uses. */
export type D1 = {
  prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> } };
  exec(sql: string): Promise<unknown>;
};

/** The feed's store on Cloudflare D1. Same SQL as the local store (src/feed/sql.ts). */
export class D1Store implements FeedStore {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1) {}

  private init() {
    this.ready ??= (async () => {
      for (const statement of SCHEMA) await this.db.prepare(statement.replace(/\s+/g, " ")).bind().run();
    })();
    return this.ready;
  }

  async count(level: Level): Promise<number> {
    await this.init();
    const q = countLevel(level);
    return (await this.db.prepare(q.sql).bind(...q.args).first<{ n: number }>())?.n ?? 0;
  }

  async add(receipt: Receipt, level: Level, hardware: string | null) {
    await this.init();
    const sel = selectLevel(receipt.bodyHash);
    const existing = await this.db.prepare(sel.sql).bind(...sel.args).first<{ level: Level }>();
    if (existing) {
      if (!shouldReplace(existing.level, level)) return { added: false, level: existing.level };
      const up = upgrade(receipt, level, hardware);
      await this.db.prepare(up.sql).bind(...up.args).run();
      const now = await this.db.prepare(sel.sql).bind(...sel.args).first<{ level: Level }>();
      return { added: now?.level === level, level: now?.level ?? level };
    }
    const ins = insert(receipt, level, hardware);
    try {
      await this.db.prepare(ins.sql).bind(...ins.args).run();
    } catch {
      // Two copies arriving at once: the other one won the insert. Report what is stored.
      const now = await this.db.prepare(sel.sql).bind(...sel.args).first<{ level: Level }>();
      if (now) return { added: false, level: now.level };
      throw new Error("the receipt could not be stored");
    }
    return { added: true, level };
  }

  async find(query: Query = {}): Promise<PostRow[]> {
    await this.init();
    const q = find(query);
    return (await this.db.prepare(q.sql).bind(...q.args).all<Record<string, unknown>>()).results.map(toRow);
  }

  async receipt(id: string): Promise<Receipt | null> {
    await this.init();
    const q = selectReceipt(id);
    const row = await this.db.prepare(q.sql).bind(...q.args).first<{ receipt: string }>();
    return row ? (JSON.parse(row.receipt) as Receipt) : null;
  }
}
