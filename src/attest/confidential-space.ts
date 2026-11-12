import { existsSync } from "node:fs";
import { issuerKeys, type JwksSource, verifyJwt } from "./jwt.ts";

/** Google Cloud Confidential Space: a container runs in a confidential VM (Intel TDX or AMD SEV-SNP) on a
 * locked-down image with no operator login. Google's attestation service checks the hardware evidence and
 * signs a token naming the container image that ran and any nonce the workload asked for.
 * What this trusts: the chip vendor, Google as host and verifier, and that nobody had physical access. */

export const ISSUER = "https://confidentialcomputing.googleapis.com";
export const AUDIENCE = "bragproof";
export const SOCKET = "/run/container_launcher/teeserver.sock";

export const insideConfidentialSpace = () => existsSync(SOCKET);

/** Asks the launcher for a token that carries `nonce` (10 to 74 bytes). Only works inside the VM. */
export async function fetchToken(nonce: string): Promise<string> {
  const res = await fetch("http://localhost/v1/token", {
    unix: SOCKET,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience: AUDIENCE, token_type: "OIDC", nonces: [nonce] }),
  } as RequestInit);
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error("attestation token request failed: " + text.slice(0, 200));
  return text;
}

export type Policy = {
  /** Container image digests of runners the verifier accepts ("sha256:..."). */
  runnerDigests: string[];
  /** Hardware the verifier accepts. */
  hardware: string[];
  /** Largest gap allowed between the end of the run and the token's issue time. */
  maxSkewSeconds: number;
  /** The check workflow a GitHub Actions token must name ("owner/repo/.github/workflows/file.yml"). */
  githubWorkflow: string;
  /** Commits of that workflow file the verifier accepts. */
  githubCommits: string[];
};

export const DEFAULT_HARDWARE = ["GCP_INTEL_TDX", "GCP_AMD_SEV_SNP"];

/** `requester` says who asked for the run, as the evidence names them: "github:owner/repo" or "gcp:project". */
export type AttestedFacts = { hardware: string; imageDigest: string; imageReference: string; issuedAt: string; host: string; requester: string };

/** Who asked for a run, read from a token's claims. Used by the verifiers, and by a store to label receipts it
 * verified before it kept this field. */
export function requesterOf(kind: string, claims: Record<string, any>): string {
  const name = kind === "github-actions" ? claims.repository : kind === "gcp-confidential-space" ? claims.submods?.gce?.project_id : undefined;
  if (typeof name !== "string" || !/^[A-Za-z0-9._:/-]{1,100}$/.test(name)) return "";
  return (kind === "github-actions" ? "github:" : "gcp:") + name;
}

export type TokenVerdict = { ok: true; facts: AttestedFacts } | { ok: false; reason: string };

/** Checks a Confidential Space token against the policy and against the receipt it is meant to bind. */
export async function verifyToken(token: string, bodyHash: string, finishedAt: string, policy: Policy, keys: JwksSource = defaultKeys): Promise<TokenVerdict> {
  let claims: Record<string, any>;
  try {
    claims = (await verifyJwt(token, keys)).claims;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const no = (reason: string): TokenVerdict => ({ ok: false, reason });
  if (claims.iss !== ISSUER) return no("token issuer is not Google's attestation service");
  if (claims.aud !== AUDIENCE) return no("token was issued for another audience");
  const nonces: unknown[] = Array.isArray(claims.eat_nonce) ? claims.eat_nonce : [claims.eat_nonce];
  if (!nonces.includes(bodyHash)) return no("token does not carry this receipt's hash: it belongs to another run");
  if (claims.swname !== "CONFIDENTIAL_SPACE") return no("the run was not in Confidential Space");
  if (claims.dbgstat !== "disabled-since-boot") return no("the VM image allowed debug access, so the operator could have changed the run");
  if (claims.secboot !== true) return no("the VM did not start with secure boot");
  const container = claims.submods?.container ?? {};
  const digest = typeof container.image_digest === "string" ? container.image_digest : "";
  if (!policy.runnerDigests.includes(digest)) return no(`the container that ran (${digest || "unknown"}) is not a runner this verifier accepts`);
  if (container.cmd_override?.length) return no("the container's command was overridden");
  const hardware = typeof claims.hwmodel === "string" ? claims.hwmodel : "";
  if (!policy.hardware.includes(hardware)) return no(`hardware ${hardware || "unknown"} is not accepted`);
  const iat = typeof claims.iat === "number" ? claims.iat : Number.NaN;
  const finished = Date.parse(finishedAt) / 1000;
  if (!Number.isFinite(iat) || Math.abs(iat - finished) > policy.maxSkewSeconds) return no("token was not issued at the time of the run");
  const gce = claims.submods?.gce ?? {};
  return { ok: true, facts: { hardware, imageDigest: digest, imageReference: String(container.image_reference ?? ""), issuedAt: new Date(iat * 1000).toISOString(), host: `google-cloud:${gce.zone ?? "unknown"}`, requester: requesterOf("gcp-confidential-space", claims) } };
}

const defaultKeys = issuerKeys(ISSUER);
