import { type AttestedFacts, DEFAULT_HARDWARE, fetchToken, insideConfidentialSpace, type Policy, verifyToken } from "../attest/confidential-space.ts";
import type { JwksSource } from "../attest/jwt.ts";
import { hashOf } from "./canonical.ts";
import { type CheckResult, type CheckSpec, type Evidence, FORMAT_VERSION, type Receipt, resultProblems, specProblems } from "./types.ts";
import trusted from "../../runners.json" with { type: "json" };

export const bodyHashOf = (spec: CheckSpec, result: CheckResult): string => hashOf({ v: FORMAT_VERSION, spec, result });

/** Wraps a result into a receipt. Inside a Confidential Space VM the receipt gets attested evidence; anywhere
 * else it is marked as carrying none. */
export async function makeReceipt(spec: CheckSpec, result: CheckResult): Promise<Receipt> {
  const bodyHash = bodyHashOf(spec, result);
  const evidence: Evidence = insideConfidentialSpace() ? { kind: "gcp-confidential-space", token: await fetchToken(bodyHash) } : { kind: "none" };
  return { v: 1, type: "claimcheck/receipt", spec, result, bodyHash, evidence };
}

export type Level = "attested" | "self-reported";

export type Verdict =
  | { ok: true; level: Level; pass: boolean; facts?: AttestedFacts; note: string }
  | { ok: false; reason: string };

export const defaultPolicy = (): Policy => ({ runnerDigests: (trusted as { runners: { digest: string }[] }).runners.map((r) => r.digest), hardware: DEFAULT_HARDWARE, maxSkewSeconds: 600 });

/** Decides whether a receipt holds together. `ok: false` means it is malformed, altered or its evidence does not
 * check out, and nothing in it should be believed. `ok: true` with level "self-reported" means it is intact but
 * is only the runner's word. `pass` is what the check found, and matters only when `ok` is true. */
export async function verifyReceipt(receipt: unknown, policy: Policy = defaultPolicy(), keys?: JwksSource): Promise<Verdict> {
  const r = receipt as Receipt;
  if (typeof r !== "object" || r === null || r.v !== 1 || r.type !== "claimcheck/receipt") return { ok: false, reason: "not a claimcheck receipt" };
  const problems = specProblems(r.spec);
  if (!problems.length) problems.push(...resultProblems(r.result, r.spec.steps.length));
  if (problems.length) return { ok: false, reason: problems[0]! };
  if (bodyHashOf(r.spec, r.result) !== r.bodyHash) return { ok: false, reason: "the spec or result was changed after the receipt was made" };
  if (r.result.pass !== r.result.steps.every((s) => s.pass)) return { ok: false, reason: "the overall result disagrees with its steps" };
  const ev = r.evidence;
  if (ev?.kind === "none") return { ok: true, level: "self-reported", pass: r.result.pass, note: "intact, but only the word of whoever ran it" };
  if (ev?.kind === "gcp-confidential-space" && typeof ev.token === "string") {
    const v = await verifyToken(ev.token, r.bodyHash, r.result.finishedAt, policy, keys);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, level: "attested", pass: r.result.pass, facts: v.facts, note: `ran in an accepted runner on ${v.facts.hardware} at ${v.facts.host}` };
  }
  return { ok: false, reason: "unknown kind of evidence" };
}
