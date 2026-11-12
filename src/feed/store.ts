import { requesterOf } from "../attest/confidential-space.ts";
import { hashOf } from "../receipt/canonical.ts";
import type { Level } from "../receipt/receipt.ts";
import type { Receipt } from "../receipt/types.ts";
import * as q from "./sql.ts";

/** The three things a database must do for the feed. A local SQLite file and Cloudflare D1 each provide them;
 * everything else is the same code. */
export type Executor = {
  all(sql: string, args: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  run(sql: string, args: (string | number | null)[]): Promise<void>;
};

export type Stats = { claims: number; packages: number; receipts: number; requesters: number };
export type ClaimDetail = { claim: q.ClaimRow; latest: Receipt; receipts: q.PostRow[] };

/** A spec's identity: every run of the same spec is evidence for the same claim. */
export const specHashOf = (receipt: Receipt): string => hashOf(receipt.spec);

/** Who asked for a run, read from a stored receipt's token without checking it again. Only for receipts the
 * feed verified when it admitted them. */
function storedRequester(receipt: Receipt): string | null {
  if (receipt.evidence.kind === "none") return null;
  try {
    const claims = JSON.parse(Buffer.from(receipt.evidence.token.split(".")[1]!, "base64url").toString("utf8"));
    return requesterOf(receipt.evidence.kind, claims) || null;
  } catch {
    return null;
  }
}

export class FeedStore {
  private ready: Promise<void> | null = null;
  constructor(private db: Executor) {}

  /** Creates the table, and brings an older feed's table up to date: adds the newer columns and fills them
   * in from the receipts it already holds. */
  private init(): Promise<void> {
    this.ready ??= this.prepare().catch((e) => {
      // A failed start must not be remembered: the next request tries again.
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  private async prepare(): Promise<void> {
    for (const statement of q.SCHEMA) await this.db.run(statement.replace(/\s+/g, " "), []);
    try {
      await this.db.all("SELECT spec_hash, requester, witness FROM posts LIMIT 1", []);
    } catch {
      for (const column of q.ADDED_COLUMNS) await this.db.run(`ALTER TABLE posts ADD COLUMN ${column}`, []).catch(() => {});
    }
    for (const statement of q.LATE_INDEXES) await this.db.run(statement, []);
    // A few rows per start, so a large old table never exceeds what one request may do; it finishes over
    // several starts. A row that cannot be read is marked '' and left out of every count, not retried for ever.
    for (const row of await this.db.all("SELECT id, receipt FROM posts WHERE spec_hash IS NULL LIMIT 20", [])) {
      let specHash = "";
      let requester: string | null = null;
      try {
        const receipt = JSON.parse(String(row.receipt)) as Receipt;
        specHash = specHashOf(receipt);
        requester = storedRequester(receipt);
      } catch {
        /* unreadable: marked and skipped */
      }
      await this.db.run("UPDATE posts SET spec_hash = ?, requester = ?, witness = ? WHERE id = ?", [specHash, requester, q.witnessOf(requester), String(row.id)]);
    }
  }

  private async all(s: q.Sql) {
    await this.init();
    return this.db.all(s.sql, s.args);
  }

  async count(level: Level): Promise<number> {
    return Number((await this.all(q.countLevel(level)))[0]?.n ?? 0);
  }

  /** Stores a verified receipt and returns the level now on record. */
  async add(receipt: Receipt, level: Level, hardware: string | null, requester: string | null): Promise<{ added: boolean; level: Level }> {
    const extra = { hardware, specHash: specHashOf(receipt), requester };
    const stored = async () => (await this.all(q.selectLevel(receipt.bodyHash)))[0]?.level as Level | undefined;
    const existing = await stored();
    if (existing) {
      if (!q.shouldReplace(existing, level)) return { added: false, level: existing };
      const up = q.upgrade(receipt, level, extra);
      await this.db.run(up.sql, up.args);
      const now = (await stored()) ?? level;
      return { added: now === level, level: now };
    }
    const ins = q.insert(receipt, level, extra);
    try {
      await this.db.run(ins.sql, ins.args);
    } catch (e) {
      // Two copies arriving at once: the other one won the insert. Report what is stored.
      const now = await stored();
      if (now) return { added: false, level: now };
      throw e;
    }
    return { added: true, level };
  }

  async find(query: q.Query = {}): Promise<q.PostRow[]> {
    return (await this.all(q.find(query))).map(q.toRow);
  }

  async receipt(id: string): Promise<Receipt | null> {
    const row = (await this.all(q.selectReceipt(id)))[0];
    return row ? (JSON.parse(String(row.receipt)) as Receipt) : null;
  }

  async claims(query: q.ClaimQuery = {}): Promise<q.ClaimRow[]> {
    return (await this.all(q.claims(query))).map(q.toClaim);
  }

  /** One claim with its receipts and one receipt in full (for the exact calls and what they returned). The
   * counts cover proven runs only, as the lists do; if the claim has none, every run counts and says so by its
   * level. The receipt in full is the newest proven passing run when there is one. */
  async claim(specHash: string): Promise<ClaimDetail | null> {
    const claim = (await this.claims({ specHash, limit: 1 }))[0] ?? (await this.claims({ specHash, level: "any", limit: 1 }))[0];
    if (!claim) return null;
    const receipts = (await this.all(q.receiptsOf(specHash))).map(q.toRow);
    const proven = receipts.filter((r) => r.level !== "self-reported");
    const pick = proven.find((r) => r.pass) ?? proven[0] ?? receipts.find((r) => r.pass) ?? receipts[0];
    const latest = pick ? await this.receipt(pick.id) : null;
    return latest ? { claim, latest, receipts } : null;
  }

  async stats(): Promise<Stats> {
    const r = (await this.all(q.stats()))[0] ?? {};
    return { claims: Number(r.claims ?? 0), packages: Number(r.packages ?? 0), receipts: Number(r.receipts ?? 0), requesters: Number(r.requesters ?? 0) };
  }

  async tags(): Promise<{ tag: string; n: number }[]> {
    return (await this.all(q.tags())).map((r) => ({ tag: String(r.tag), n: Number(r.n) }));
  }
}
