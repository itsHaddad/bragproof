import { Database } from "bun:sqlite";
import type { Level } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";
import { countLevel, type FeedStore, find, insert, type PostRow, type Query, SCHEMA, selectLevel, selectReceipt, shouldReplace, toRow, upgrade } from "./sql.ts";

export type { PostRow, Query } from "./sql.ts";

/** The feed's store on a local SQLite file: one row per receipt, keyed by the receipt's body hash, in the
 * order they were admitted. The SQL is in sql.ts, shared with the Cloudflare D1 store. */
export class FeedDb implements FeedStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    for (const statement of SCHEMA) this.db.run(statement);
  }

  count(level: Level): number {
    const q = countLevel(level);
    return (this.db.query(q.sql).get(...q.args) as { n: number }).n;
  }

  /** Stores a verified receipt and returns the level now on record. */
  add(receipt: Receipt, level: Level, hardware: string | null): { added: boolean; level: Level } {
    const sel = selectLevel(receipt.bodyHash);
    const existing = this.db.query(sel.sql).get(...sel.args) as { level: Level } | null;
    if (existing) {
      if (!shouldReplace(existing.level, level)) return { added: false, level: existing.level };
      const up = upgrade(receipt, level, hardware);
      this.db.query(up.sql).run(...up.args);
      return { added: true, level };
    }
    const ins = insert(receipt, level, hardware);
    this.db.query(ins.sql).run(...ins.args);
    return { added: true, level };
  }

  find(query: Query = {}): PostRow[] {
    const q = find(query);
    return (this.db.query(q.sql).all(...q.args) as Record<string, unknown>[]).map(toRow);
  }

  receipt(id: string): Receipt | null {
    const q = selectReceipt(id);
    const row = this.db.query(q.sql).get(...q.args) as { receipt: string } | null;
    return row ? (JSON.parse(row.receipt) as Receipt) : null;
  }

  close() {
    this.db.close();
  }
}
