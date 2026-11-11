import type { Policy } from "../attest/confidential-space.ts";
import type { JwksSource } from "../attest/jwt.ts";
import { defaultPolicy, verifyReceipt } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";
import type { FeedDb, PostRow, Query } from "./db.ts";

export type PublishOutcome = { ok: true; id: string; level: string; added: boolean } | { ok: false; reason: string };

/** What the feed does, apart from HTTP: admit a receipt only after verifying it, and answer queries. The REST
 * routes and the MCP tools both call this, so they cannot drift apart. */
export class FeedService {
  constructor(
    private db: FeedDb,
    private policy: Policy = defaultPolicy(),
    private keys?: JwksSource,
  ) {}

  async publish(receipt: unknown): Promise<PublishOutcome> {
    if (JSON.stringify(receipt ?? null).length > 64_000) return { ok: false, reason: "receipt is larger than 64 kB" };
    const verdict = await verifyReceipt(receipt, this.policy, this.keys);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const r = receipt as Receipt;
    const added = this.db.add(r, verdict.level, verdict.facts?.hardware ?? null);
    return { ok: true, id: r.bodyHash, level: verdict.level, added };
  }

  search(query: Query): { posts: PostRow[]; cursor: number } {
    const posts = this.db.find(query);
    return { posts, cursor: posts.reduce((m, p) => Math.max(m, p.seq), query.after ?? 0) };
  }

  receipt(id: string): Receipt | null {
    return /^[0-9a-f]{64}$/.test(id) ? this.db.receipt(id) : null;
  }
}
