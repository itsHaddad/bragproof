import type { Policy } from "../attest/confidential-space.ts";
import type { JwksSource } from "../attest/jwt.ts";
import { defaultPolicy, normalForm, verifyReceipt } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";
import type { ReportPolicy } from "../report/verify.ts";
import { type AskOutcome, ReportBook } from "./reports.ts";
import type { ClaimQuery, ClaimRow, PostRow, Query } from "./sql.ts";
import type { ClaimDetail, FeedStore, Stats } from "./store.ts";

export type PublishOutcome = { ok: true; id: string; level: string; added: boolean } | { ok: false; reason: string };

export type FeedOptions = {
  policy?: Policy;
  keys?: JwksSource;
  /** How many self-reported receipts the feed keeps. They cost nothing to make, so a public feed keeps few
   * (or none: 0) and a private one may keep many. Proven receipts are never capped. */
  selfReportedCap?: number;
  /** Which runs are believed for run reports, and why a package may not be queued (null when it may). */
  reportPolicy?: ReportPolicy;
  packageEligible?: (name: string) => Promise<string | null>;
};

/** A small limit per sender on publishing, so one sender cannot flood the feed. Reading is never limited. */
function limiter(perMinute: number) {
  const seen = new Map<string, { at: number; n: number }>();
  return (who: string) => {
    const now = Date.now();
    const s = seen.get(who);
    if (!s || now - s.at > 60_000) {
      seen.delete(who);
      seen.set(who, { at: now, n: 1 });
      // Drop the oldest entries rather than everything, so a flood of new senders does not reset the others.
      while (seen.size > 10_000) seen.delete(seen.keys().next().value as string);
      return true;
    }
    return ++s.n <= perMinute;
  };
}

/** IPv6 senders are counted by /64, the block one subscriber normally holds. */
export const senderKey = (address: string) => (address.includes(":") && !address.startsWith("::ffff:") ? address.split(":").slice(0, 4).join(":") : address);

/** What the feed does, apart from HTTP: admit a receipt only after verifying it, and answer queries. The REST
 * routes, the MCP tools and the pages all call this, so they cannot drift apart. */
export class FeedService {
  private policy: Policy;
  private allow = limiter(20);
  private allowAsk = limiter(6);
  /** Run reports and the queue of packages asked for. */
  readonly reports: ReportBook;

  constructor(
    private db: FeedStore,
    private options: FeedOptions = {},
  ) {
    this.policy = options.policy ?? defaultPolicy();
    this.reports = new ReportBook(db.db, { policy: options.reportPolicy, keys: options.keys, eligible: options.packageEligible });
  }

  /** Asks for a report on a package, a few per sender per minute. */
  async askReport(pkg: unknown, sender = "unknown"): Promise<AskOutcome> {
    if (!this.allowAsk(senderKey(sender))) return { ok: false, reason: "too many requests from this sender, try again in a minute" };
    return this.reports.ask(typeof pkg === "string" ? pkg.trim().toLowerCase() : pkg, senderKey(sender));
  }

  async publish(receipt: unknown, sender = "unknown"): Promise<PublishOutcome> {
    if (!this.allow(senderKey(sender))) return { ok: false, reason: "too many receipts from this sender, try again in a minute" };
    let size: number;
    try {
      size = JSON.stringify(receipt ?? null).length;
    } catch {
      return { ok: false, reason: "receipt is not plain data" };
    }
    if (size > 64_000) return { ok: false, reason: "receipt is larger than 64 kB" };
    const verdict = await verifyReceipt(receipt, this.policy, this.options.keys);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const cap = this.options.selfReportedCap ?? 1000;
    if (verdict.level === "self-reported" && (await this.db.count("self-reported")) >= cap) return { ok: false, reason: cap === 0 ? "this feed only takes proven receipts (witnessed or attested)" : "this feed holds as many self-reported receipts as it keeps; proven ones are always taken" };
    // Stored in normal form: only the fields the format defines, so nothing unverified is served alongside.
    const r = normalForm(receipt as Receipt);
    // The hardware column is for hardware evidence only; a run GitHub witnessed has none.
    const stored = await this.db.add(r, verdict.level, verdict.level === "attested" ? (verdict.facts?.hardware ?? null) : null, verdict.facts?.requester ?? null);
    return { ok: true, id: r.bodyHash, level: stored.level, added: stored.added };
  }

  /** Receipts, for catching up on new evidence. */
  async search(query: Query): Promise<{ posts: PostRow[]; cursor: number }> {
    const posts = await this.db.find(query);
    return { posts, cursor: posts.reduce((m, p) => Math.max(m, p.seq), query.after ?? 0) };
  }

  async receipt(id: string): Promise<Receipt | null> {
    return /^[0-9a-f]{64}$/.test(id) ? this.db.receipt(id) : null;
  }

  /** Claims with their proof counted: what a reader choosing a tool wants. */
  claims(query: ClaimQuery): Promise<ClaimRow[]> {
    return this.db.claims(query);
  }

  async claim(specHash: string): Promise<ClaimDetail | null> {
    return /^[0-9a-f]{64}$/.test(specHash) ? this.db.claim(specHash) : null;
  }

  stats(): Promise<Stats> {
    return this.db.stats();
  }

  tags(): Promise<{ tag: string; n: number }[]> {
    return this.db.tags();
  }
}
