import { type Level, rank } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";

/** The feed's table and queries as plain SQL, shared by every store (local SQLite, Cloudflare D1), so they
 * cannot drift apart. Input only ever reaches a query as a bound argument. */

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

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS posts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    admitted_at TEXT NOT NULL,
    claim TEXT NOT NULL, subject TEXT NOT NULL, package TEXT NOT NULL, version TEXT NOT NULL,
    tags TEXT NOT NULL, pass INTEGER NOT NULL, level TEXT NOT NULL, hardware TEXT,
    search TEXT NOT NULL,
    receipt TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS posts_by_level ON posts (level, pass, seq)",
];

type Sql = { sql: string; args: (string | number | null)[] };

export const selectLevel = (id: string): Sql => ({ sql: "SELECT level FROM posts WHERE id = ?", args: [id] });
export const countLevel = (level: Level): Sql => ({ sql: "SELECT count(*) AS n FROM posts WHERE level = ?", args: [level] });
export const selectReceipt = (id: string): Sql => ({ sql: "SELECT receipt FROM posts WHERE id = ?", args: [id] });

/** Stronger evidence replaces a weaker copy of the same receipt body, never the other way round, so nobody can
 * bury a proven post by posting its body first without the proof. */
export const shouldReplace = (existing: Level, incoming: Level) => rank(incoming) > rank(existing);

/** Replaces a stored copy only while that copy is still weaker, so two copies arriving at once cannot leave
 * the weaker one in place. */
export function upgrade(receipt: Receipt, level: Level, hardware: string | null): Sql {
  const weaker = (["self-reported", "witnessed", "attested"] as Level[]).filter((l) => rank(l) < rank(level));
  return { sql: `UPDATE posts SET level = ?, hardware = ?, receipt = ? WHERE id = ? AND level IN (${weaker.map(() => "?").join(",") || "''"})`, args: [level, hardware, JSON.stringify(receipt), receipt.bodyHash, ...weaker] };
}

export function insert(receipt: Receipt, level: Level, hardware: string | null): Sql {
  const s = receipt.spec;
  const tags = s.tags ?? [];
  const search = [s.claim, s.subject.name, s.subject.package, ...tags, ...s.steps.map((st) => st.tool)].join(" ").toLowerCase();
  return {
    sql: "INSERT INTO posts (id, admitted_at, claim, subject, package, version, tags, pass, level, hardware, search, receipt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [receipt.bodyHash, new Date().toISOString(), s.claim, s.subject.name, s.subject.package, s.subject.version, JSON.stringify(tags), receipt.result.pass ? 1 : 0, level, hardware, search, JSON.stringify(receipt)],
  };
}

/** By default only proven receipts (witnessed or attested) whose check passed: the ones an agent can act on.
 * Newest first, except when catching up from a cursor (`after`): then oldest first, so a reader that takes a
 * page at a time and continues from the last row it got misses nothing. */
export function find(query: Query = {}): Sql {
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
  return { sql: `SELECT seq, id, admitted_at, claim, subject, package, version, tags, pass, level, hardware FROM posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq ${order} LIMIT ${limit}`, args };
}

export const toRow = (r: any): PostRow => ({ seq: r.seq, id: r.id, admittedAt: r.admitted_at, claim: r.claim, subject: r.subject, package: r.package, version: r.version, tags: JSON.parse(r.tags), pass: !!r.pass, level: r.level, hardware: r.hardware });

/** What a store must do. Methods may answer at once (local SQLite) or later (D1). */
export type FeedStore = {
  count(level: Level): number | Promise<number>;
  add(receipt: Receipt, level: Level, hardware: string | null): { added: boolean; level: Level } | Promise<{ added: boolean; level: Level }>;
  find(query?: Query): PostRow[] | Promise<PostRow[]>;
  receipt(id: string): Receipt | null | Promise<Receipt | null>;
};
