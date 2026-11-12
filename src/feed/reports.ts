import type { JwksSource } from "../attest/jwt.ts";
import { type Outcome, type Summary, seriousFlags, summarize } from "../report/analyze.ts";
import { type Report, validPackage } from "../report/types.ts";
import { createHash } from "node:crypto";
import { isReportWorkflow, type ReportPolicy, verifyReport } from "../report/verify.ts";
import type { Executor } from "./store.ts";

/** Run reports in the feed: one per package version, admitted only with a token that proves the report
 * workflow made it. Also the queue of packages people asked to have reported. */

/** `contacts` is -1 when the network was not recorded for the run. */
export type ReportRow = { package: string; version: string; ranAt: string; outcome: Outcome; tools: number; contacts: number; flags: number; serious: number; toolsHash: string };
export type ReportDetail = { report: Report; summary: Summary; token: string; history: ReportRow[] };
export type State = { /** Servers with a tool that could be called blind, and how many of those answered one. */ callable: number; answering: number; total: number; /** Packages with no start command: not servers, so not counted. */ leftOut: number; outcomes: { outcome: Outcome; n: number }[]; contacting: number; flagged: number; serious: number; hosts: { name: string; n: number }[]; needs: { name: string; n: number }[] };
export type ReportQuery = { q?: string; outcome?: string; contacts?: boolean; limit?: number };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package TEXT NOT NULL, version TEXT NOT NULL, ran_at TEXT NOT NULL, admitted_at TEXT NOT NULL,
    latest INTEGER NOT NULL, outcome TEXT NOT NULL, tools INTEGER NOT NULL, contacts INTEGER NOT NULL,
    flags INTEGER NOT NULL, serious INTEGER NOT NULL, tools_hash TEXT NOT NULL,
    contact_names TEXT NOT NULL, need_names TEXT NOT NULL, search TEXT NOT NULL, names TEXT, calls_tried INTEGER, calls_ok INTEGER,
    report TEXT NOT NULL, token TEXT NOT NULL, UNIQUE (package, version))`,
  "CREATE INDEX IF NOT EXISTS reports_by_latest ON reports (latest, outcome, id)",
  "CREATE INDEX IF NOT EXISTS reports_by_package ON reports (package, id)",
  "CREATE TABLE IF NOT EXISTS requests (package TEXT PRIMARY KEY, asked_at TEXT NOT NULL, done_at TEXT, tries INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS askers (who TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (who, day))",
  "CREATE INDEX IF NOT EXISTS requests_open ON requests (done_at, asked_at)",
];
const COLUMNS = "package, version, ran_at, outcome, tools, contacts, flags, serious, tools_hash";
const toRow = (r: any): ReportRow => ({ package: r.package, version: r.version, ranAt: r.ran_at, outcome: r.outcome, tools: Number(r.tools), contacts: Number(r.contacts), flags: Number(r.flags), serious: Number(r.serious), toolsHash: r.tools_hash });
const clamp = (limit: unknown, fallback: number, max: number) => Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit as number) : fallback, 1), max);

export type AdmitOutcome = { ok: true; package: string; version: string; outcome: Outcome; kept: boolean } | { ok: false; reason: string };
/** A package is tried this many times before the queue gives up on it. */
const MAX_TRIES = 3;
const PER_SENDER_PER_DAY = 20;
export type AskOutcome = { ok: true; status: "reported" | "queued" | "already-queued"; package: string } | { ok: false; reason: string };

export class ReportBook {
  private ready: Promise<void> | null = null;
  constructor(
    private db: Executor,
    private options: { policy?: ReportPolicy; keys?: JwksSource; eligible?: (name: string) => Promise<string | null> } = {},
  ) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      for (const s of SCHEMA) await this.db.run(s.replace(/\s+/g, " "), []);
      // Added after the first feeds existed: the package and tool names on their own, so a search can rank a
      // match in a name above a match somewhere in a description. Filled in a few hundred rows per start.
      await this.db.run("ALTER TABLE reports ADD COLUMN names TEXT", []).catch(() => {});
      await this.db.run("ALTER TABLE reports ADD COLUMN calls_tried INTEGER", []).catch(() => {});
      await this.db.run("ALTER TABLE reports ADD COLUMN calls_ok INTEGER", []).catch(() => {});
      await this.db.run("UPDATE reports SET names = lower(package || ' ' || coalesce((SELECT group_concat(json_extract(j.value, '$.name'), ' ') FROM json_each(reports.report, '$.tools') j), '')) WHERE id IN (SELECT id FROM reports WHERE names IS NULL LIMIT 100)", []).catch(() => {});
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
    const now = new Date().toISOString();
    const done = () => this.db.run("UPDATE requests SET done_at = ? WHERE package = ? AND done_at IS NULL", [now, r.package]);
    const stored = (await this.all("SELECT version, outcome, ran_at FROM reports WHERE package = ?", [r.package])) as { version: string; outcome: string; ran_at: string }[];
    const same = stored.find((x) => x.version === r.version);
    // A run that found nothing must not hide one that did: a failed lookup of a package already reported, or a
    // run that did not finish, where the package has a real report of any version. An older run never replaces a newer one,
    // so a report and its token cannot be sent again later to undo a fresh report.
    const keep = (s.outcome === "not-found" && stored.length > 0) || (s.outcome === "timed-out" && stored.some((x) => x.outcome !== "timed-out" && x.outcome !== "not-found")) || (same !== undefined && same.ran_at >= r.ranAt);
    if (keep) {
      await done();
      return { ok: true, package: r.package, version: r.version, outcome: s.outcome, kept: false };
    }
    await this.db.run(
      `INSERT INTO reports (package, version, ran_at, admitted_at, latest, outcome, tools, contacts, flags, serious, tools_hash, contact_names, need_names, search, names, calls_tried, calls_ok, report, token) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (package, version) DO UPDATE SET latest = 1, ran_at = excluded.ran_at, admitted_at = excluded.admitted_at, outcome = excluded.outcome, tools = excluded.tools, contacts = excluded.contacts, flags = excluded.flags, serious = excluded.serious, tools_hash = excluded.tools_hash, contact_names = excluded.contact_names, need_names = excluded.need_names, search = excluded.search, names = excluded.names, calls_tried = excluded.calls_tried, calls_ok = excluded.calls_ok, report = excluded.report, token = excluded.token`.replace(/\s+/g, " "),
      [r.package, r.version, r.ranAt, now, s.outcome, s.tools, r.network ? s.contacts.length : -1, s.flags.length, serious, r.toolsHash, JSON.stringify(s.contacts), JSON.stringify(s.needs), search, [r.package, ...r.tools.map((t) => t.name)].join(" ").toLowerCase().slice(0, 20_000), s.callsTried, s.callsAnswered, reportText as string, token as string],
    );
    // The version reported last is the one shown for the package. If this step fails the package shows twice
    // until its next report, which is better than not at all.
    await this.db.run("UPDATE reports SET latest = 0 WHERE package = ? AND version <> ?", [r.package, r.version]);
    await done();
    return { ok: true, package: r.package, version: r.version, outcome: s.outcome, kept: true };
  }

  /** The newest report on a package, with its earlier versions. */
  async get(pkg: string): Promise<ReportDetail | null> {
    if (!validPackage(pkg)) return null;
    const row = (await this.all("SELECT report, token FROM reports WHERE package = ? AND latest = 1", [pkg]))[0];
    if (!row) return null;
    const report = JSON.parse(String(row.report)) as Report;
    // Newest run first, with the version shown at the top whatever its run time.
    const history = (await this.all(`SELECT ${COLUMNS} FROM reports WHERE package = ? ORDER BY latest DESC, ran_at DESC LIMIT 20`, [pkg])).map(toRow);
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
    const where = ["latest = 1", "outcome <> 'not-found'"];
    const args: (string | number)[] = [];
    const terms = (typeof query.q === "string" ? query.q : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    for (const term of terms) {
      where.push("instr(search, ?) > 0");
      args.push(term);
    }
    if (typeof query.outcome === "string" && /^[a-z-]{1,30}$/.test(query.outcome)) {
      where.push("outcome = ?");
      args.push(query.outcome);
    }
    if (query.contacts) where.push("contacts > 0");
    // Packages that are not servers stay findable by name, but are not shown among the latest.
    if (!query.q && !query.outcome) where.push("outcome <> 'no-start-command'");
    // A word in the package's name counts most, then in a tool's name, then anywhere in a description. Servers
    // that start come first, and ones with a great many tools last among equals: they match everything.
    const score = terms.map(() => "(CASE WHEN instr(package, ?) > 0 THEN 4 WHEN instr(coalesce(names, ''), ?) > 0 THEN 2 ELSE 0 END)").join(" + ");
    const order = terms.length ? `CASE outcome WHEN 'started' THEN 0 ELSE 1 END, ${score} DESC, CASE WHEN tools <= 40 THEN 0 ELSE 1 END, id DESC` : "id DESC";
    for (const term of terms) args.push(term, term);
    return (await this.all(`SELECT ${COLUMNS} FROM reports WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${clamp(query.limit, 30, 200)}`, args)).map(toRow);
  }

  /** Every reported package name, for a sitemap. */
  async names(): Promise<string[]> {
    return (await this.all("SELECT package FROM reports WHERE latest = 1 AND outcome NOT IN ('not-found', 'no-start-command') ORDER BY id DESC LIMIT 5000")).map((r) => String(r.package));
  }

  /** The numbers for the whole collection. Packages that are not servers (no start command) are left out. */
  async state(): Promise<State> {
    const outcomes = (await this.all("SELECT outcome, count(*) AS n FROM reports WHERE latest = 1 AND outcome NOT IN ('not-found', 'no-start-command') GROUP BY outcome ORDER BY n DESC")).map((r) => ({ outcome: r.outcome as Outcome, n: Number(r.n) }));
    const c = (await this.all("SELECT count(*) AS total, sum(contacts > 0) AS contacting, sum(flags > 0) AS flagged, sum(serious > 0) AS serious, sum(coalesce(calls_tried, 0) > 0) AS callable, sum(coalesce(calls_ok, 0) > 0) AS answering FROM reports WHERE latest = 1 AND outcome NOT IN ('not-found', 'no-start-command')"))[0] ?? {};
    const leftOut = Number((await this.all("SELECT count(*) AS n FROM reports WHERE latest = 1 AND outcome = 'no-start-command'"))[0]?.n ?? 0);
    const top = async (column: string) => (await this.all(`SELECT j.value AS name, count(*) AS n FROM reports r, json_each(r.${column}) j WHERE r.latest = 1 AND r.outcome NOT IN ('not-found', 'no-start-command') GROUP BY j.value ORDER BY n DESC, name ASC LIMIT 15`)).map((r) => ({ name: String(r.name), n: Number(r.n) }));
    return { callable: Number(c.callable ?? 0), answering: Number(c.answering ?? 0), total: Number(c.total ?? 0), leftOut, outcomes, contacting: Number(c.contacting ?? 0), flagged: Number(c.flagged ?? 0), serious: Number(c.serious ?? 0), hosts: await top("contact_names"), needs: await top("need_names") };
  }

  /** Asks for a report on a package. Reported already: says so. Otherwise it joins the queue the report
   * workflow works through, if npm has a package of that name. */
  async ask(pkg: unknown, sender = "unknown"): Promise<AskOutcome> {
    if (!validPackage(pkg)) return { ok: false, reason: "that is not an npm package name" };
    // A report less than a day old stands; after that, asking again gets the newest version looked at.
    const last = (await this.all("SELECT max(admitted_at) AS at FROM reports WHERE package = ?", [pkg]))[0]?.at;
    if (typeof last === "string" && Date.now() - Date.parse(last) < 86_400_000) return { ok: true, status: "reported", package: pkg };
    if ((await this.all(`SELECT 1 FROM requests WHERE package = ? AND done_at IS NULL AND tries < ${MAX_TRIES}`, [pkg])).length) return { ok: true, status: "already-queued", package: pkg };
    if (Number((await this.all(`SELECT count(*) AS n FROM requests WHERE done_at IS NULL AND tries < ${MAX_TRIES}`))[0]?.n ?? 0) >= 300) return { ok: false, reason: "the queue is full, try again in an hour" };
    // A daily allowance per sender, kept in the database so it holds across restarts. The sender is stored
    // only as a hash, and only for counting.
    const who = createHash("sha256").update("asker:" + sender).digest("hex").slice(0, 32);
    const day = new Date().toISOString().slice(0, 10);
    await this.db.run("INSERT INTO askers (who, day, n) VALUES (?, ?, 1) ON CONFLICT (who, day) DO UPDATE SET n = n + 1", [who, day]);
    if (Number((await this.all("SELECT n FROM askers WHERE who = ? AND day = ?", [who, day]))[0]?.n ?? 0) > PER_SENDER_PER_DAY) return { ok: false, reason: "too many requests from this sender today" };
    const refusal = this.options.eligible ? await this.options.eligible(pkg) : null;
    if (refusal) return { ok: false, reason: refusal };
    await this.db.run("INSERT INTO requests (package, asked_at, done_at, tries) VALUES (?, ?, NULL, 0) ON CONFLICT (package) DO UPDATE SET asked_at = excluded.asked_at, done_at = NULL, tries = 0", [pkg, new Date().toISOString()]);
    return { ok: true, status: "queued", package: pkg };
  }

  /** Packages waiting for a report, oldest first. With the report workflow's own token the call takes them:
   * each gets an attempt counted, and one that has used its attempts without a report is given up on. */
  async queue(limit?: number, takerToken?: string): Promise<string[]> {
    const waiting = (await this.all(`SELECT package FROM requests WHERE done_at IS NULL AND tries < ${MAX_TRIES} ORDER BY asked_at ASC LIMIT ${clamp(limit, 40, 100)}`)).map((r) => String(r.package));
    if (takerToken && waiting.length && (await isReportWorkflow(takerToken, this.options.policy, this.options.keys))) {
      await this.db.run(`UPDATE requests SET tries = tries + 1 WHERE package IN (${waiting.map(() => "?").join(",")})`, waiting);
    }
    return waiting;
  }

  async isQueued(pkg: string): Promise<boolean> {
    return (await this.all(`SELECT 1 FROM requests WHERE package = ? AND done_at IS NULL AND tries < ${MAX_TRIES}`, [pkg])).length > 0;
  }
}

/** Why a package may not join the queue; null when it may. It must be on npm and present itself as an MCP
 * server, so the queue and the numbers are about MCP servers and not about whatever anyone types. */
export const mcpServerOnNpm = async (name: string): Promise<string | null> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return "npm has no package of that name";
    if (!res.ok) return "npm did not answer, try again in a minute";
    const meta = (await res.json()) as { name?: unknown; keywords?: unknown; description?: unknown; bin?: unknown };
    const text = [meta.name, meta.description, ...(Array.isArray(meta.keywords) ? meta.keywords : [])].filter((x) => typeof x === "string").join(" ");
    if (!/mcp|model[ -]?context[ -]?protocol/i.test(text)) return "that package does not present itself as an MCP server (no 'mcp' in its name, keywords or description)";
    if (!meta.bin) return "that package has no command to start, so it cannot be run as a server";
    return null;
  } catch {
    return "npm did not answer, try again in a minute";
  }
};
