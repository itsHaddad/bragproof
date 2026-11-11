import type { Policy } from "../attest/confidential-space.ts";
import type { JwksSource } from "../attest/jwt.ts";
import { defaultPolicy, normalForm, verifyReceipt } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";
import type { FeedDb, PostRow, Query } from "./db.ts";

export type PublishOutcome = { ok: true; id: string; level: string; added: boolean } | { ok: false; reason: string };

export type FeedOptions = {
  policy?: Policy;
  keys?: JwksSource;
  /** How many self-reported receipts the feed keeps. They cost nothing to make, so a public feed keeps few
   * (or none: 0) and a private one may keep many. Attested receipts are never capped. */
  selfReportedCap?: number;
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
 * routes and the MCP tools both call this, so they cannot drift apart. */
export class FeedService {
  private policy: Policy;
  private allow = limiter(20);

  constructor(
    private db: FeedDb,
    private options: FeedOptions = {},
  ) {
    this.policy = options.policy ?? defaultPolicy();
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
    if (verdict.level === "self-reported" && this.db.count("self-reported") >= cap) return { ok: false, reason: cap === 0 ? "this feed only takes attested receipts" : "this feed holds as many self-reported receipts as it keeps; attested ones are always taken" };
    // Stored in normal form: only the fields the format defines, so nothing unverified is served alongside.
    const r = normalForm(receipt as Receipt);
    const stored = this.db.add(r, verdict.level, verdict.facts?.hardware ?? null);
    return { ok: true, id: r.bodyHash, level: stored.level, added: stored.added };
  }

  search(query: Query): { posts: PostRow[]; cursor: number } {
    const posts = this.db.find(query);
    return { posts, cursor: posts.reduce((m, p) => Math.max(m, p.seq), query.after ?? 0) };
  }

  receipt(id: string): Receipt | null {
    return /^[0-9a-f]{64}$/.test(id) ? this.db.receipt(id) : null;
  }
}
