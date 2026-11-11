import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export type Jwk = { kid?: string; kty: string; alg?: string; n?: string; e?: string; [k: string]: unknown };
/** Returns the issuer's keys; `fresh` asks to skip a cache because a token named a key that was not in it. */
export type JwksSource = (fresh?: boolean) => Promise<Jwk[]>;
export type DecodedJwt = { header: Record<string, any>; claims: Record<string, any> };

const b64urlJson = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/** Verifies an RS256 JWT against a key set and returns its claims. Checks the signature only; what the claims
 * must say is the caller's policy. Throws with a plain reason on any failure. */
export async function verifyJwt(token: string, keys: JwksSource): Promise<DecodedJwt> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token is not a JWT");
  let header: Record<string, any>;
  let claims: Record<string, any>;
  try {
    header = b64urlJson(parts[0]!);
    claims = b64urlJson(parts[1]!);
  } catch {
    throw new Error("token is not readable");
  }
  // Only RS256: a token must not be able to choose a weaker or keyless algorithm.
  if (header.alg !== "RS256") throw new Error("token algorithm is not RS256");
  const pick = (set: Jwk[]) => set.find((k) => k.kid === header.kid && k.kty === "RSA");
  const jwk = pick(await keys()) ?? pick(await keys(true));
  if (!jwk) throw new Error("no signing key with this token's key id: the issuer never published it, or has retired it since, so this token cannot be checked");
  const key = createPublicKey({ key: jwk as any, format: "jwk" });
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2]!, "base64url"));
  if (!ok) throw new Error("token signature does not verify");
  return { header, claims };
}

/** Reads the key set an OpenID issuer publishes, cached for an hour. */
export function issuerKeys(issuer: string, fetcher: typeof fetch = fetch): JwksSource {
  let cache: { at: number; keys: Jwk[] } | null = null;
  return async (fresh = false) => {
    if (cache && Date.now() - cache.at < (fresh ? 60_000 : 3_600_000)) return cache.keys;
    const conf = (await (await fetcher(issuer + "/.well-known/openid-configuration")).json()) as { jwks_uri?: string };
    if (!conf.jwks_uri?.startsWith("https://")) throw new Error("issuer does not publish a key set");
    const set = (await (await fetcher(conf.jwks_uri)).json()) as { keys?: Jwk[] };
    cache = { at: Date.now(), keys: set.keys ?? [] };
    return cache.keys;
  };
}
