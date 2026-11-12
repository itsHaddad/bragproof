import type { AttestedFacts, Policy, TokenVerdict } from "./confidential-space.ts";
import { issuerKeys, type JwksSource, verifyJwt } from "./jwt.ts";

/** GitHub Actions as the witness: a job on a GitHub-hosted machine can ask GitHub for a signed token that
 * names the workflow file that is running and the commit it was read from. When that workflow is this
 * project's check workflow, which starts a pinned runner image and nothing else, the token says "the
 * bragproof runner ran this, on GitHub's machine, not on the claimant's".
 * What this trusts: GitHub, as host and as signer. There is no hardware evidence underneath. */

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
export const audienceFor = (bodyHash: string) => "bragproof:" + bodyHash;

export const insideGithubActions = () => !!process.env.ACTIONS_ID_TOKEN_REQUEST_URL && !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

/** Asks GitHub for a token whose audience carries the receipt's hash. Only works in a job that was granted
 * `id-token: write`. */
export async function fetchGithubToken(bodyHash: string): Promise<string> {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL!);
  url.searchParams.set("audience", audienceFor(bodyHash));
  const res = await fetch(url, { headers: { authorization: "Bearer " + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } });
  const body = (await res.json().catch(() => ({}))) as { value?: string };
  if (!res.ok || typeof body.value !== "string") throw new Error("GitHub did not issue a token (" + res.status + ")");
  return body.value;
}

/** Checks a GitHub Actions token against the policy and against the receipt it is meant to bind. */
export async function verifyGithubToken(token: string, bodyHash: string, finishedAt: string, policy: Policy, keys: JwksSource = defaultKeys): Promise<TokenVerdict> {
  let claims: Record<string, any>;
  try {
    claims = (await verifyJwt(token, keys)).claims;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const no = (reason: string): TokenVerdict => ({ ok: false, reason });
  if (claims.iss !== GITHUB_ISSUER) return no("token issuer is not GitHub Actions");
  if (claims.aud !== audienceFor(bodyHash)) return no("token does not carry this receipt's hash: it belongs to another run");
  if (claims.runner_environment !== "github-hosted") return no("the job ran on a machine GitHub does not host, so its owner could have changed the run");
  const ref = typeof claims.job_workflow_ref === "string" ? claims.job_workflow_ref : "";
  if (!ref.startsWith(policy.githubWorkflow + "@")) return no(`the job was not this project's check workflow (${ref.slice(0, 120) || "unknown"})`);
  const commit = typeof claims.job_workflow_sha === "string" ? claims.job_workflow_sha : "";
  if (!policy.githubCommits.includes(commit)) return no(`the check workflow was read from a commit (${commit.slice(0, 12) || "unknown"}) this verifier does not accept`);
  const iat = typeof claims.iat === "number" ? claims.iat : Number.NaN;
  if (!Number.isFinite(iat) || Math.abs(iat - Date.parse(finishedAt) / 1000) > policy.maxSkewSeconds) return no("token was not issued at the time of the run");
  const facts: AttestedFacts = { hardware: "GITHUB_HOSTED", imageDigest: commit, imageReference: ref, issuedAt: new Date(iat * 1000).toISOString(), host: "github-actions:" + String(claims.repository ?? "unknown").slice(0, 100) };
  return { ok: true, facts };
}

const defaultKeys = issuerKeys(GITHUB_ISSUER);
