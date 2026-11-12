import type { JwksSource } from "../attest/jwt.ts";
import { type Outcome, type Summary, seriousFlags, summarize } from "../report/analyze.ts";
import { type Report, validPackage } from "../report/types.ts";
import { type ReportPolicy, verifyReport } from "../report/verify.ts";
import type { Executor } from "./store.ts";

/** Run reports in the feed: one per package version, admitted only with a token that proves the report
 * workflow made it. Also the queue of packages people asked to have reported. */

export type ReportRow = { package: string; version: string; ranAt: string; outcome: Outcome; tools: number; contacts: number; flags: number; serious: number; toolsHash: string };
export type ReportDetail = { report: Report; summary: Summary; token: string; history: ReportRow[] };
export type State = { total: number; outcomes: { outcome: Outcome; n: number }[]; contacting: number; flagged: number; serious: number; hosts: { name: string; n: number }[]; needs: { name: string; n: number }[] };
export type ReportQuery = { q?: string; outcome?: string; contacts?: boolean; limit?: number };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package TEXT NOT NULL, version TEXT NOT NULL, ran_at TEXT NOT NULL, admitted_at TEXT NOT NULL,
    latest INTEGER NOT NULL, outcome TEXT NOT NULL, tools INTEGER NOT NULL, contacts INTEGER NOT NULL,
    flags INTEGER NOT NULL, serious INTEGER NOT NULL, tools_hash TEXT NOT NULL,
    contact_names TEXT NOT NULL, need_names TEXT NOT NULL, search TEXT NOT NULL,
    report TEXT NOT NULL, token TEXT NOT NULL, UNIQUE (package, version))`,
  "CREATE INDEX IF NOT EXISTS reports_by_latest ON reports (latest, outcome, id)",
  "CREATE INDEX IF NOT EXISTS reports_by_package ON reports (package, id)",
  "CREATE TABLE IF NOT EXISTS requests (package TEXT PRIMARY KEY, asked_at TEXT NOT NULL, done_at TEXT)",
  "CREATE INDEX IF NOT EXISTS requests_open ON requests (done_at, asked_at)",
];
const COLUMNS = "package, version, ran_at, outcome, tools, contacts, flags, serious, tools_hash";
const toRow = (r: any): ReportRow => ({ package: r.package, version: r.version, ranAt: r.ran_at, outcome: r.outcome, tools: Number(r.tools), contacts: Number(r.contacts), flags: Number(r.flags), serious: Number(r.serious), toolsHash: r.tools_hash });
const clamp = (limit: unknown, fallback: number, max: number) => Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit as number) : fallback, 1), max);

export type AdmitOutcome = { ok: true; package: string; version: string; outcome: Outcome } | { ok: false; reason: string };
export type AskOutcome = { ok: true; status: "reported" | "queued" | "already-queued"; package: string } | { ok: false; reason: string };

export class ReportBook {
  private ready: Promise<void> | null = null;
  constructor(
    private db: Executor,
    private options: { policy?: ReportPolicy; keys?: JwksSource; exists?: (name: string) => Promise<boolean> } = {},
  ) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      for (const s of SCHEMA) await this.db.run(s.replace(/\s+/g, " "), []);
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }
  private async all(sql: string, args: (string | number | null)[] = []) {
    await this.init();
    return this.db.all(sql, args);
  }

  /** Stores a report after checking, byte for byte, that the report workflow made it. A newer run of the same
   * version replaces the older one. */
  async admit(reportText: unknown, token: unknown): Promise<AdmitOutcome> {
    const verdict = await verifyReport(reportText as string, token as string, this.options.policy, this.options.keys, Date.now());
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const r = verdict.report;
    const s = summarize(r);
    const serious = seriousFlags(s.flags).length;
    const search = [r.package, r.start.serverName ?? "", ...r.tools.map((t) => t.name + " " + t.description)].join(" ").toLowerCase().slice(0, 30_000);
    await this.init();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO reports (package, version, ran_at, admitted_at, latest, outcome, tools, contacts, flags, serious, tools_hash, contact_names, need_names, search, report, token) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (package, version) DO UPDATE SET ran_at = excluded.ran_at, admitted_at = excluded.admitted_at, outcome = excluded.outcome, tools = excluded.tools, contacts = excluded.contacts, flags = excluded.flags, serious = excluded.serious, tools_hash = excluded.tools_hash, contact_names = excluded.contact_names, need_names = excluded.need_names, search = excluded.search, report = excluded.report, token = excluded.token`.replace(/\s+/g, " "),
      [r.package, r.version, r.ranAt, now, s.outcome, s.tools, s.contacts.length, s.flags.length, serious, r.toolsHash, JSON.stringify(s.contacts), JSON.stringify(s.needs), search, reportText as string, token as string],
    );
    // The version reported last is the one shown for the package.
    await this.db.run("UPDATE reports SET latest = CASE WHEN version = ? THEN 1 ELSE 0 END WHERE package = ?", [r.version, r.package]);
    await this.db.run("UPDATE requests SET done_at = ? WHERE package = ? AND done_at IS NULL", [now, r.package]);
    return { ok: true, package: r.package, version: r.version, outcome: s.outcome };
  }

  /** The newest report on a package, with its earlier versions. */
  async get(pkg: string): Promise<ReportDetail | null> {
    if (!validPackage(pkg)) return null;
    const row = (await this.all("SELECT report, token FROM reports WHERE package = ? AND latest = 1", [pkg]))[0];
    if (!row) return null;
    const report = JSON.parse(String(row.report)) as Report;
    const history = (await this.all(`SELECT ${COLUMNS} FROM reports WHERE package = ? ORDER BY id DESC LIMIT 20`, [pkg])).map(toRow);
    return { report, summary: summarize(report), token: String(row.token), history };
  }

  /** The report text and token exactly as admitted, for anyone who wants to check them. */
  async raw(pkg: string): Promise<{ report: string; token: string } | null> {
    if (!validPackage(pkg)) return null;
    const row = (await this.all("SELECT report, token FROM reports WHERE package = ? AND latest = 1", [pkg]))[0];
    return row ? { report: String(row.report), token: String(row.token) } : null;
  }

  /** Reports, one per package. Searching puts the ones that start first; otherwise newest first. */
  async list(query: ReportQuery = {}): Promise<ReportRow[]> {
    const where = ["latest = 1"];
    const args: (string | number)[] = [];
    for (const term of (typeof query.q === "string" ? query.q : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push("instr(search, ?) > 0");
      args.push(term);
    }
    if (typeof query.outcome === "string" && /^[a-z-]{1,30}$/.test(query.outcome)) {
      where.push("outcome = ?");
      args.push(query.outcome);
    }
    if (query.contacts) where.push("contacts > 0");
    const order = query.q ? "CASE outcome WHEN 'started' THEN 0 ELSE 1 END, instr(package, ?) = 0, id DESC" : "id DESC";
    if (query.q) args.push(query.q.toLowerCase().split(/\s+/).filter(Boolean)[0] ?? "");
    return (await this.all(`SELECT ${COLUMNS} FROM reports WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${clamp(query.limit, 30, 200)}`, args)).map(toRow);
  }

  /** The numbers for the whole collection. */
  async state(): Promise<State> {
    const outcomes = (await this.all("SELECT outcome, count(*) AS n FROM reports WHERE latest = 1 AND outcome <> 'not-found' GROUP BY outcome ORDER BY n DESC")).map((r) => ({ outcome: r.outcome as Outcome, n: Number(r.n) }));
    const c = (await this.all("SELECT count(*) AS total, sum(contacts > 0) AS contacting, sum(flags > 0) AS flagged, sum(serious > 0) AS serious FROM reports WHERE latest = 1 AND outcome <> 'not-found'"))[0] ?? {};
    const top = async (column: string) => (await this.all(`SELECT j.value AS name, count(*) AS n FROM reports r, json_each(r.${column}) j WHERE r.latest = 1 GROUP BY j.value ORDER BY n DESC, name ASC LIMIT 15`)).map((r) => ({ name: String(r.name), n: Number(r.n) }));
    return { total: Number(c.total ?? 0), outcomes, contacting: Number(c.contacting ?? 0), flagged: Number(c.flagged ?? 0), serious: Number(c.serious ?? 0), hosts: await top("contact_names"), needs: await top("need_names") };
  }

  /** Asks for a report on a package. Reported already: says so. Otherwise it joins the queue the report
   * workflow works through, if npm has a package of that name. */
  async ask(pkg: unknown): Promise<AskOutcome> {
    if (!validPackage(pkg)) return { ok: false, reason: "that is not an npm package name" };
    // A report less than a day old stands; after that, asking again gets the newest version looked at.
    const last = (await this.all("SELECT max(admitted_at) AS at FROM reports WHERE package = ?", [pkg]))[0]?.at;
    if (typeof last === "string" && Date.now() - Date.parse(last) < 86_400_000) return { ok: true, status: "reported", package: pkg };
    if ((await this.all("SELECT 1 FROM requests WHERE package = ? AND done_at IS NULL", [pkg])).length) return { ok: true, status: "already-queued", package: pkg };
    if (Number((await this.all("SELECT count(*) AS n FROM requests WHERE done_at IS NULL"))[0]?.n ?? 0) >= 300) return { ok: false, reason: "the queue is full, try again in an hour" };
    if (this.options.exists && !(await this.options.exists(pkg))) return { ok: false, reason: "npm has no package of that name" };
    await this.db.run("INSERT INTO requests (package, asked_at, done_at) VALUES (?, ?, NULL) ON CONFLICT (package) DO UPDATE SET asked_at = excluded.asked_at, done_at = NULL", [pkg, new Date().toISOString()]);
    return { ok: true, status: "queued", package: pkg };
  }

  async queue(limit?: number): Promise<string[]> {
    return (await this.all(`SELECT package FROM requests WHERE done_at IS NULL ORDER BY asked_at ASC LIMIT ${clamp(limit, 40, 100)}`)).map((r) => String(r.package));
  }
}

/** Whether npm has a package of this name. Used before queueing, so the queue holds only real packages. */
export const onNpm = async (name: string): Promise<boolean> => {
  try {
    const res = await fetch("https://registry.npmjs.org/" + name.replace("/", "%2F"), { method: "HEAD", signal: AbortSignal.timeout(8000) });
    return res.status === 200;
  } catch {
    return false;
  }
};
