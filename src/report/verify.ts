import trusted from "../../runners.json" with { type: "json" };
import { GITHUB_ISSUER } from "../attest/github-actions.ts";
import { issuerKeys, type JwksSource, verifyJwt } from "../attest/jwt.ts";
import { sha256Hex } from "../receipt/canonical.ts";
import { type Report, reportProblems } from "./types.ts";

/** Which runs a verifier believes made a report: one workflow file, on one branch of one repository, on a
 * machine GitHub hosts. */
export type ReportPolicy = { repository: string; workflow: string; ref: string; maxAgeSeconds: number };
export const defaultReportPolicy = (): ReportPolicy => ({ ...trusted.reports, maxAgeSeconds: 900 });

export const reportAudience = (reportText: string) => "bragproof-report:" + sha256Hex(reportText);

export type ReportVerdict = { ok: true; report: Report; commit: string } | { ok: false; reason: string };

const defaultKeys = issuerKeys(GITHUB_ISSUER);

/** Checks that `reportText`, byte for byte, is what a run of the report workflow produced.
 * The token is GitHub's signed statement about one job; its audience carries the hash of the report, so the
 * text cannot be changed afterwards, and the token cannot be moved to another report.
 * `at` is the moment to judge freshness against: now when admitting, or omitted when re-checking a stored
 * report later (the signature and everything it says still hold; only "was it just made" cannot be asked). */
export async function verifyReport(reportText: string, token: string, policy: ReportPolicy = defaultReportPolicy(), keys: JwksSource = defaultKeys, at?: number): Promise<ReportVerdict> {
  const no = (reason: string): ReportVerdict => ({ ok: false, reason });
  if (typeof reportText !== "string" || typeof token !== "string") return no("a report and its token are both needed");
  let report: Report;
  try {
    report = JSON.parse(reportText);
  } catch {
    return no("the report is not JSON");
  }
  const problems = reportProblems(report);
  if (problems.length) return no("not a report: " + problems.slice(0, 3).join("; "));
  let claims: Record<string, any>;
  try {
    claims = (await verifyJwt(token, keys)).claims;
  } catch (e) {
    return no((e as Error).message);
  }
  if (claims.iss !== GITHUB_ISSUER) return no("token issuer is not GitHub Actions");
  if (claims.aud !== reportAudience(reportText)) return no("token does not carry this report's hash: the report was changed, or the token belongs to another");
  if (claims.runner_environment !== "github-hosted") return no("the job ran on a machine GitHub does not host");
  if (claims.repository !== policy.repository) return no("the job did not run in the report repository");
  if (claims.job_workflow_ref !== `${policy.workflow}@${policy.ref}`) return no(`the job was not the report workflow on its main branch (${String(claims.job_workflow_ref ?? "unknown").slice(0, 120)})`);
  const commit = typeof claims.job_workflow_sha === "string" ? claims.job_workflow_sha : "";
  if (!/^[0-9a-f]{40}$/.test(commit) || report.host?.commit !== commit) return no("the report does not name the commit the workflow ran from");
  if (!report.host.run.endsWith(`/${policy.repository}/actions/runs/${claims.run_id}`)) return no("the report does not name the run that made it");
  const iat = typeof claims.iat === "number" ? claims.iat : Number.NaN;
  if (!Number.isFinite(iat)) return no("token has no issue time");
  if (at !== undefined && Math.abs(at / 1000 - iat) > policy.maxAgeSeconds) return no("token was not issued just now");
  if (Math.abs(Date.parse(report.ranAt) / 1000 - iat) > 3600) return no("token was not issued at the time of the run");
  return { ok: true, report, commit };
}
