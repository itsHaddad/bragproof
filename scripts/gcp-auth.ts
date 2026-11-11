import { createSign } from "node:crypto";

/** An access token for a Google Cloud service account, from its JSON key file (GOOGLE_APPLICATION_CREDENTIALS). */
export async function gcpToken(scope = "https://www.googleapis.com/auth/cloud-platform"): Promise<{ token: string; project: string; email: string }> {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("set GOOGLE_APPLICATION_CREDENTIALS to a service account key file");
  const key = (await Bun.file(path).json()) as { client_email: string; private_key: string; project_id: string; token_uri: string };
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iss: key.client_email, scope, aud: key.token_uri, iat: now, exp: now + 3000 });
  const assertion = unsigned + "." + createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const res = await fetch(key.token_uri, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error("no access token: " + (body.error_description ?? res.status));
  return { token: body.access_token, project: key.project_id, email: key.client_email };
}

export async function gcp(token: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: init.method ?? "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}
