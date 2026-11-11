import { Database } from "bun:sqlite";
import type { Level } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";

export type PostRow = {
  seq: number;
  id: string;
  admittedAt: string;
  claim: string;
  subject: string;
  package: string;
  version: string;
  tags: string[];
  pass: boolean;
  level: Level;
  hardware: string | null;
};

export type Query = { q?: string; level?: Level | "any"; pass?: boolean | "any"; after?: number; limit?: number };

/** The feed's store: one row per receipt, keyed by the receipt's body hash, in the order they were admitted. */
export class FeedDb {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS posts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      admitted_at TEXT NOT NULL,
      claim TEXT NOT NULL, subject TEXT NOT NULL, package TEXT NOT NULL, version TEXT NOT NULL,
      tags TEXT NOT NULL, pass INTEGER NOT NULL, level TEXT NOT NULL, hardware TEXT,
      search TEXT NOT NULL,
      receipt TEXT NOT NULL)`);
  }

  /** Stores a verified receipt. Returns false when the same receipt is already there. */
  add(receipt: Receipt, level: Level, hardware: string | null): boolean {
    const s = receipt.spec;
    const tags = s.tags ?? [];
    const search = [s.claim, s.subject.name, s.subject.package, ...tags, ...s.steps.map((st) => st.tool)].join(" ").toLowerCase();
    const res = this.db
      .query("INSERT OR IGNORE INTO posts (id, admitted_at, claim, subject, package, version, tags, pass, level, hardware, search, receipt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(receipt.bodyHash, new Date().toISOString(), s.claim, s.subject.name, s.subject.package, s.subject.version, JSON.stringify(tags), receipt.result.pass ? 1 : 0, level, hardware, search, JSON.stringify(receipt));
    return res.changes > 0;
  }

  /** Newest first. By default only attested receipts whose check passed: the ones an agent can act on. */
  find(query: Query = {}): PostRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const level = query.level ?? "attested";
    if (level !== "any") {
      where.push("level = ?");
      args.push(level);
    }
    const pass = query.pass ?? true;
    if (pass !== "any") {
      where.push("pass = ?");
      args.push(pass ? 1 : 0);
    }
    if (query.after !== undefined) {
      where.push("seq > ?");
      args.push(query.after);
    }
    for (const term of (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push("instr(search, ?) > 0");
      args.push(term);
    }
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const sql = `SELECT seq, id, admitted_at, claim, subject, package, version, tags, pass, level, hardware FROM posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq DESC LIMIT ${limit}`;
    return (this.db.query(sql).all(...args) as any[]).map((r) => ({ seq: r.seq, id: r.id, admittedAt: r.admitted_at, claim: r.claim, subject: r.subject, package: r.package, version: r.version, tags: JSON.parse(r.tags), pass: !!r.pass, level: r.level, hardware: r.hardware }));
  }

  receipt(id: string): Receipt | null {
    const row = this.db.query("SELECT receipt FROM posts WHERE id = ?").get(id) as { receipt: string } | null;
    return row ? (JSON.parse(row.receipt) as Receipt) : null;
  }

  close() {
    this.db.close();
  }
}
