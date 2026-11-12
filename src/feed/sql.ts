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
  specHash: string;
  requester: string | null;
};

/** One claim with everything proven about it: every run of the same spec counts towards it. */
export type ClaimRow = {
  specHash: string;
  claim: string;
  subject: string;
  package: string;
  version: string;
  tags: string[];
  /** The strongest proof any passing run has. */
  best: Level | null;
  /** Runs whose check passed, and runs whose check failed. */
  passes: number;
  fails: number;
  /** Distinct requesters (a GitHub account, a cloud project) among the passing runs. */
  requesters: number;
  lastPassAt: string | null;
  lastFailAt: string | null;
  latestSeq: number;
};

/** `level` is a floor: "witnessed" (the default) returns witnessed and attested posts, "attested" only those
 * with hardware evidence, "self-reported" or "any" everything. */
export type Query = { q?: string; level?: Level | "any"; pass?: boolean | "any"; after?: number; limit?: number };
export type ClaimQuery = { q?: string; level?: Level | "any"; tag?: string; package?: string; requester?: string; specHash?: string; limit?: number };

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
/** Columns added after the first feeds existed; a store adds them when they are missing. */
export const ADDED_COLUMNS = ["spec_hash TEXT", "requester TEXT", "witness TEXT"];
export const LATE_INDEXES = ["CREATE INDEX IF NOT EXISTS posts_by_spec ON posts (spec_hash, seq)", "CREATE INDEX IF NOT EXISTS posts_by_package ON posts (package, seq)", "CREATE INDEX IF NOT EXISTS posts_by_witness ON posts (witness, pass)"];

export type Sql = { sql: string; args: (string | number | null)[] };

export const selectLevel = (id: string): Sql => ({ sql: "SELECT level FROM posts WHERE id = ?", args: [id] });
export const countLevel = (level: Level): Sql => ({ sql: "SELECT count(*) AS n FROM posts WHERE level = ?", args: [level] });
export const selectReceipt = (id: string): Sql => ({ sql: "SELECT receipt FROM posts WHERE id = ?", args: [id] });

/** Stronger evidence replaces a weaker copy of the same receipt body, never the other way round, so nobody can
 * bury a proven post by posting its body first without the proof. */
export const shouldReplace = (existing: Level, incoming: Level) => rank(incoming) > rank(existing);

/** The requester as counted: the account or project, without the repository, so one owner's many repositories
 * count once. */
export const witnessOf = (requester: string | null) => (requester ? requester.split("/")[0]!.toLowerCase() : null);

export type Extra = { hardware: string | null; specHash: string; requester: string | null };

/** Replaces a stored copy only while that copy is still weaker, so two copies arriving at once cannot leave
 * the weaker one in place. */
export function upgrade(receipt: Receipt, level: Level, x: Extra): Sql {
  const weaker = (["self-reported", "witnessed", "attested"] as Level[]).filter((l) => rank(l) < rank(level));
  return {
    sql: `UPDATE posts SET level = ?, hardware = ?, requester = ?, witness = ?, receipt = ? WHERE id = ? AND level IN (${weaker.map(() => "?").join(",") || "''"})`,
    args: [level, x.hardware, x.requester, witnessOf(x.requester), JSON.stringify(receipt), receipt.bodyHash, ...weaker],
  };
}

export function insert(receipt: Receipt, level: Level, x: Extra): Sql {
  const s = receipt.spec;
  const tags = s.tags ?? [];
  const search = [s.claim, s.subject.name, s.subject.package, ...tags, ...s.steps.map((st) => st.tool)].join(" ").toLowerCase();
  return {
    sql: "INSERT INTO posts (id, admitted_at, claim, subject, package, version, tags, pass, level, hardware, search, receipt, spec_hash, requester, witness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [receipt.bodyHash, new Date().toISOString(), s.claim, s.subject.name, s.subject.package, s.subject.version, JSON.stringify(tags), receipt.result.pass ? 1 : 0, level, x.hardware, search, JSON.stringify(receipt), x.specHash, x.requester, witnessOf(x.requester)],
  };
}

const levelFloor = (level: Level | "any", where: string[]) => {
  if (level === "attested") where.push("level = 'attested'");
  else if (level === "witnessed") where.push("level IN ('attested', 'witnessed')");
};
const words = (q: unknown, where: string[], args: (string | number)[]) => {
  for (const term of (typeof q === "string" ? q : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push("instr(search, ?) > 0");
    args.push(term);
  }
};
const clamp = (limit: unknown, fallback: number) => Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit as number) : fallback, 1), 100);
const POST_COLUMNS = "seq, id, admitted_at, claim, subject, package, version, tags, pass, level, hardware, spec_hash, requester";

/** Receipts. By default only proven ones (witnessed or attested) whose check passed. Newest first, except when
 * catching up from a cursor (`after`): then oldest first, so a reader that takes a page at a time and
 * continues from the last row it got misses nothing. */
export function find(query: Query = {}): Sql {
  const where: string[] = [];
  const args: (string | number)[] = [];
  levelFloor(query.level ?? "witnessed", where);
  const pass = query.pass ?? true;
  if (pass !== "any") {
    where.push("pass = ?");
    args.push(pass ? 1 : 0);
  }
  if (query.after !== undefined) {
    where.push("seq > ?");
    args.push(Number.isFinite(query.after) ? Math.trunc(query.after) : 0);
  }
  words(query.q, where, args);
  return { sql: `SELECT ${POST_COLUMNS} FROM posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq ${query.after !== undefined ? "ASC" : "DESC"} LIMIT ${clamp(query.limit, 20)}`, args };
}

/** Receipts of one claim, newest first, whatever their result: a claim page shows its failures too. */
export const receiptsOf = (specHash: string): Sql => ({ sql: `SELECT ${POST_COLUMNS} FROM posts WHERE spec_hash = ? ORDER BY seq DESC LIMIT 100`, args: [specHash] });

/** Claims, each with its runs counted. Only runs at or above the level floor count, and a claim is listed
 * only when at least one such run passed. Most recently proven first. */
export function claims(query: ClaimQuery = {}): Sql {
  // '' marks a row whose stored receipt could not be read when the table was brought up to date.
  const where: string[] = ["spec_hash IS NOT NULL", "spec_hash <> ''"];
  const args: (string | number)[] = [];
  const floor: string[] = [];
  levelFloor(query.level ?? "witnessed", floor);
  where.push(...floor);
  words(query.q, where, args);
  if (typeof query.tag === "string") {
    // A tag that could not be a tag matches nothing, rather than being ignored.
    if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(query.tag)) {
      where.push("instr(tags, ?) > 0");
      args.push(JSON.stringify(query.tag));
    } else where.push("0");
  }
  if (typeof query.package === "string") {
    where.push("package = ?");
    args.push(query.package.slice(0, 214));
  }
  if (typeof query.requester === "string") {
    // Claims this requester has a passing run for; the counts shown still cover everyone's runs.
    where.push(`spec_hash IN (SELECT spec_hash FROM posts WHERE witness = ? AND pass = 1${floor.length ? " AND " + floor.join(" AND ") : ""})`);
    args.push(query.requester.slice(0, 120).toLowerCase());
  }
  if (typeof query.specHash === "string") {
    where.push("spec_hash = ?");
    args.push(query.specHash);
  }
  return {
    sql: `SELECT spec_hash, max(claim) AS claim, max(subject) AS subject, max(package) AS package, max(version) AS version, max(tags) AS tags,
      sum(pass) AS passes, sum(1 - pass) AS fails,
      count(DISTINCT CASE WHEN pass = 1 THEN witness END) AS requesters,
      max(CASE WHEN pass = 1 THEN CASE level WHEN 'attested' THEN 2 WHEN 'witnessed' THEN 1 ELSE 0 END END) AS best,
      max(CASE WHEN pass = 1 THEN admitted_at END) AS last_pass_at, max(CASE WHEN pass = 0 THEN admitted_at END) AS last_fail_at,
      max(CASE WHEN pass = 1 THEN seq END) AS latest_seq
      FROM posts WHERE ${where.join(" AND ")} GROUP BY spec_hash ${typeof query.specHash === "string" ? "" : "HAVING sum(pass) > 0"} ORDER BY latest_seq DESC LIMIT ${clamp(query.limit, 30)}`.replace(/\s+/g, " "),
    args,
  };
}

export const stats = (): Sql => ({ sql: "SELECT count(DISTINCT spec_hash) AS claims, count(DISTINCT package) AS packages, count(*) AS receipts, count(DISTINCT witness) AS requesters FROM posts WHERE pass = 1 AND level IN ('attested', 'witnessed') AND spec_hash <> ''", args: [] });

/** The most used tags among proven claims. */
export const tags = (): Sql => ({ sql: "SELECT j.value AS tag, count(DISTINCT p.spec_hash) AS n FROM posts p, json_each(p.tags) j WHERE p.pass = 1 AND p.level IN ('attested', 'witnessed') AND p.spec_hash <> '' GROUP BY j.value ORDER BY n DESC, tag ASC LIMIT 24", args: [] });

export const toRow = (r: any): PostRow => ({ seq: r.seq, id: r.id, admittedAt: r.admitted_at, claim: r.claim, subject: r.subject, package: r.package, version: r.version, tags: JSON.parse(r.tags), pass: !!r.pass, level: r.level, hardware: r.hardware, specHash: r.spec_hash ?? "", requester: r.requester ?? null });

export const toClaim = (r: any): ClaimRow => ({
  specHash: r.spec_hash,
  claim: r.claim,
  subject: r.subject,
  package: r.package,
  version: r.version,
  tags: JSON.parse(r.tags),
  best: r.best === 2 ? "attested" : r.best === 1 ? "witnessed" : r.best === 0 ? "self-reported" : null,
  passes: Number(r.passes) || 0,
  fails: Number(r.fails) || 0,
  requesters: Number(r.requesters) || 0,
  lastPassAt: r.last_pass_at ?? null,
  lastFailAt: r.last_fail_at ?? null,
  latestSeq: Number(r.latest_seq) || 0,
});
