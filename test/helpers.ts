import { generateKeyPairSync, sign } from "node:crypto";
import { AUDIENCE, ISSUER, type Policy } from "../src/attest/confidential-space.ts";
import type { Jwk, JwksSource } from "../src/attest/jwt.ts";
import { bodyHashOf } from "../src/receipt/receipt.ts";
import type { CheckResult, CheckSpec, Receipt } from "../src/receipt/types.ts";

/** A stand-in for Google's attestation service: a key pair the tests own, so they can mint tokens that say
 * anything and see which ones the verifier believes. */
export function fakeAttestor(kid = "test-key") {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid, alg: "RS256" };
  const keys: JwksSource = async () => [jwk];
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const mint = (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const head = b64({ alg: "RS256", typ: "JWT", kid, ...header });
    const body = b64(claims);
    return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
  };
  return { keys, mint };
}

export const RUNNER = "sha256:" + "ab".repeat(32);
export const WORKFLOW = "example/bragproof/.github/workflows/check.yml";
export const COMMIT = "c0".repeat(20);
export const policy: Policy = { runnerDigests: [RUNNER], hardware: ["GCP_INTEL_TDX", "GCP_AMD_SEV_SNP"], maxSkewSeconds: 600, githubWorkflow: WORKFLOW, githubCommits: [COMMIT] };

/** The claims a genuine GitHub Actions token carries for a run of `bodyHash`. */
export const goodGithubClaims = (bodyHash: string, finishedAt: string): Record<string, any> => ({
  iss: "https://token.actions.githubusercontent.com",
  aud: "bragproof:" + bodyHash,
  iat: Math.floor(Date.parse(finishedAt) / 1000) + 2,
  runner_environment: "github-hosted",
  repository: "some-maker/their-tool",
  job_workflow_ref: WORKFLOW + "@refs/tags/check-v1",
  job_workflow_sha: COMMIT,
});

export function witnessedReceipt(attestor: ReturnType<typeof fakeAttestor>, change: (claims: Record<string, any>) => void = () => {}, s = spec(), r = result()): Receipt {
  const bodyHash = bodyHashOf(s, r);
  const claims = goodGithubClaims(bodyHash, r.finishedAt);
  change(claims);
  return { v: 1, type: "bragproof/receipt", spec: s, result: r, bodyHash, evidence: { kind: "github-actions", token: attestor.mint(claims) } };
}

export const spec = (): CheckSpec => ({
  v: 1,
  claim: "The echo tool returns the message it was given.",
  subject: { kind: "mcp-stdio", name: "Echo server", package: "@example/echo", version: "1.0.0" },
  steps: [{ tool: "echo", arguments: { message: "hi" }, expect: { contains: "hi" } }],
  tags: ["mcp", "echo"],
});

export const result = (over: Partial<CheckResult> = {}): CheckResult => ({
  pass: true,
  subjectIntegrity: "sha512-abc",
  lockHash: "c".repeat(64),
  steps: [{ tool: "echo", pass: true, outputHash: "d".repeat(64), outputPreview: "Echo: hi" }],
  startedAt: "2026-11-12T10:00:00.000Z",
  finishedAt: "2026-11-12T10:00:20.000Z",
  runnerVersion: "0.1.0",
  ...over,
});

/** The claims a genuine token carries for a run of `bodyHash` that ended at `finishedAt`. */
export const goodClaims = (bodyHash: string, finishedAt: string): Record<string, any> => ({
  iss: ISSUER,
  aud: AUDIENCE,
  iat: Math.floor(Date.parse(finishedAt) / 1000) + 2,
  exp: Math.floor(Date.parse(finishedAt) / 1000) + 3602,
  eat_nonce: [bodyHash],
  swname: "CONFIDENTIAL_SPACE",
  dbgstat: "disabled-since-boot",
  secboot: true,
  hwmodel: "GCP_INTEL_TDX",
  submods: { container: { image_digest: RUNNER, image_reference: "example/runner@" + RUNNER }, gce: { zone: "europe-west4-a" } },
});

export function attestedReceipt(attestor: ReturnType<typeof fakeAttestor>, change: (claims: Record<string, any>) => void = () => {}, s = spec(), r = result()): Receipt {
  const bodyHash = bodyHashOf(s, r);
  const claims = goodClaims(bodyHash, r.finishedAt);
  change(claims);
  return { v: 1, type: "bragproof/receipt", spec: s, result: r, bodyHash, evidence: { kind: "gcp-confidential-space", token: attestor.mint(claims) } };
}

export const selfReported = (s = spec(), r = result()): Receipt => ({ v: 1, type: "bragproof/receipt", spec: s, result: r, bodyHash: bodyHashOf(s, r), evidence: { kind: "none" } });
