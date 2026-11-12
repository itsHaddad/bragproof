import { Database } from "bun:sqlite";
import { type Level, rank } from "../receipt/receipt.ts";
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

/** `level` is a floor: "witnessed" (the default) returns witnessed and attested posts, "attested" only those
 * with hardware evidence, "self-reported" or "any" everything. */
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
    this.db.run("CREATE INDEX IF NOT EXISTS posts_by_level ON posts (level, pass, seq)");
  }

  count(level: Level): number {
    return (this.db.query("SELECT count(*) AS n FROM posts WHERE level = ?").get(level) as { n: number }).n;
  }

  /** Stores a verified receipt and returns the level now on record. The same body may arrive twice with
   * different evidence: stronger evidence replaces a weaker copy, never the other way round, so nobody
   * can bury a proven post by posting its body first without the proof. */
  add(receipt: Receipt, level: Level, hardware: string | null): { added: boolean; level: Level } {
    const existing = this.db.query("SELECT level FROM posts WHERE id = ?").get(receipt.bodyHash) as { level: Level } | null;
    if (existing) {
      if (rank(level) > rank(existing.level)) {
        this.db.query("UPDATE posts SET level = ?, hardware = ?, receipt = ? WHERE id = ?").run(level, hardware, JSON.stringify(receipt), receipt.bodyHash);
        return { added: true, level };
      }
      return { added: false, level: existing.level };
    }
    const s = receipt.spec;
    const tags = s.tags ?? [];
    const search = [s.claim, s.subject.name, s.subject.package, ...tags, ...s.steps.map((st) => st.tool)].join(" ").toLowerCase();
    this.db
      .query("INSERT INTO posts (id, admitted_at, claim, subject, package, version, tags, pass, level, hardware, search, receipt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(receipt.bodyHash, new Date().toISOString(), s.claim, s.subject.name, s.subject.package, s.subject.version, JSON.stringify(tags), receipt.result.pass ? 1 : 0, level, hardware, search, JSON.stringify(receipt));
    return { added: true, level };
  }

  /** By default only proven receipts (witnessed or attested) whose check passed: the ones an agent can act on. Newest first, except
   * when catching up from a cursor (`after`): then oldest first, so a reader that takes a page at a time and
   * continues from the last row it got misses nothing. */
  find(query: Query = {}): PostRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const level = query.level ?? "witnessed";
    if (level === "attested") where.push("level = 'attested'");
    else if (level === "witnessed") where.push("level IN ('attested', 'witnessed')");
    const pass = query.pass ?? true;
    if (pass !== "any") {
      where.push("pass = ?");
      args.push(pass ? 1 : 0);
    }
    if (query.after !== undefined) {
      where.push("seq > ?");
      args.push(Number.isFinite(query.after) ? Math.trunc(query.after) : 0);
    }
    for (const term of (typeof query.q === "string" ? query.q : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push("instr(search, ?) > 0");
      args.push(term);
    }
    const asked = Number.isFinite(query.limit) ? Math.trunc(query.limit as number) : 20;
    const limit = Math.min(Math.max(asked, 1), 100);
    const order = query.after !== undefined ? "ASC" : "DESC";
    const sql = `SELECT seq, id, admitted_at, claim, subject, package, version, tags, pass, level, hardware FROM posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq ${order} LIMIT ${limit}`;
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
