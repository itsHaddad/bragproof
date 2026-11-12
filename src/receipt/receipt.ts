import { type AttestedFacts, DEFAULT_HARDWARE, fetchToken, insideConfidentialSpace, type Policy, verifyToken } from "../attest/confidential-space.ts";
import { fetchGithubToken, insideGithubActions, verifyGithubToken } from "../attest/github-actions.ts";
import type { JwksSource } from "../attest/jwt.ts";
import { hashOf } from "./canonical.ts";
import { type CheckResult, type CheckSpec, type Evidence, extraKeys, FORMAT_VERSION, type Receipt, resultProblems, specProblems } from "./types.ts";
import trusted from "../../runners.json" with { type: "json" };

export const bodyHashOf = (spec: CheckSpec, result: CheckResult): string => hashOf({ v: FORMAT_VERSION, spec, result });

/** Wraps a result into a receipt. Inside a Confidential Space VM the receipt gets attested evidence; anywhere
 * else it is marked as carrying none. */
export async function makeReceipt(spec: CheckSpec, result: CheckResult): Promise<Receipt> {
  const bodyHash = bodyHashOf(spec, result);
  let evidence: Evidence = { kind: "none" };
  if (insideConfidentialSpace()) {
    try {
      evidence = { kind: "gcp-confidential-space", token: await fetchToken(bodyHash) };
    } catch (e) {
      // Better an honest unattested receipt than none: the run still happened, it just cannot be proven.
      console.error("no attestation token, the receipt is self-reported: " + (e as Error).message);
    }
  } else if (insideGithubActions() && process.getuid?.() === 0) {
    // Root means the package ran jailed, without the runner's environment: it could not ask for this token.
    try {
      evidence = { kind: "github-actions", token: await fetchGithubToken(bodyHash) };
    } catch (e) {
      console.error("no GitHub token, the receipt is self-reported: " + (e as Error).message);
    }
  }
  return { v: 1, type: "bragproof/receipt", spec, result, bodyHash, evidence };
}

/** "attested": hardware evidence from a confidential VM. "witnessed": a trusted host (GitHub) signed that the
 * runner ran on its machines, with no hardware evidence underneath. "self-reported": the runner's word only. */
export type Level = "attested" | "witnessed" | "self-reported";

/** Which level counts as at least which: used when a reader asks for "witnessed or better". */
export const rank = (level: Level): number => (level === "attested" ? 2 : level === "witnessed" ? 1 : 0);

export type Verdict =
  | { ok: true; level: Level; pass: boolean; facts?: AttestedFacts; note: string }
  | { ok: false; reason: string };

type Trusted = { runners: { digest: string }[]; github: { workflow: string; commits: { commit: string }[] } };

export const defaultPolicy = (): Policy => {
  const t = trusted as Trusted;
  return { runnerDigests: t.runners.map((r) => r.digest), hardware: DEFAULT_HARDWARE, maxSkewSeconds: 600, githubWorkflow: t.github.workflow, githubCommits: t.github.commits.map((c) => c.commit) };
};

/** Decides whether a receipt holds together. `ok: false` means it is malformed, altered or its evidence does not
 * check out, and nothing in it should be believed. `ok: true` with level "self-reported" means it is intact but
 * is only the runner's word. `pass` is what the check found, and matters only when `ok` is true. */
export async function verifyReceipt(receipt: unknown, policy: Policy = defaultPolicy(), keys?: JwksSource): Promise<Verdict> {
  try {
    return await verifyUnsafe(receipt, policy, keys);
  } catch (e) {
    // Whatever made the verifier throw (a number that cannot be hashed, a shape nobody foresaw) is a refusal.
    return { ok: false, reason: "the receipt could not be read: " + String((e as Error).message).slice(0, 120) };
  }
}

/** The receipt reduced to the fields the format defines, in a fixed order: what a feed stores and serves. */
export function normalForm(r: Receipt): Receipt {
  const evidence: Evidence = r.evidence.kind === "none" ? { kind: "none" } : { kind: r.evidence.kind, token: r.evidence.token };
  return { v: 1, type: "bragproof/receipt", spec: r.spec, result: r.result, bodyHash: r.bodyHash, evidence };
}

async function verifyUnsafe(receipt: unknown, policy: Policy, keys?: JwksSource): Promise<Verdict> {
  const r = receipt as Receipt;
  if (typeof r !== "object" || r === null || Array.isArray(r) || r.v !== 1 || r.type !== "bragproof/receipt") return { ok: false, reason: "not a bragproof receipt" };
  const problems: string[] = [];
  extraKeys(r as unknown as Record<string, unknown>, ["v", "type", "spec", "result", "bodyHash", "evidence"], "receipt", problems);
  if (typeof r.evidence === "object" && r.evidence !== null) extraKeys(r.evidence as Record<string, unknown>, r.evidence.kind === "none" ? ["kind"] : ["kind", "token"], "evidence", problems);
  if (!problems.length) problems.push(...specProblems(r.spec));
  if (!problems.length) problems.push(...resultProblems(r.result, r.spec));
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
  if (ev?.kind === "github-actions" && typeof ev.token === "string") {
    const v = await verifyGithubToken(ev.token, r.bodyHash, r.result.finishedAt, policy, keys);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, level: "witnessed", pass: r.result.pass, facts: v.facts, note: `ran in this project's check workflow on a GitHub-hosted machine, asked for by ${v.facts.host.replace("github-actions:", "")}` };
  }
  return { ok: false, reason: "unknown kind of evidence" };
}
