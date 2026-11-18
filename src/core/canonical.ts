// Kept from the first Bragproof: canonical JSON, so two people holding the same value get the same bytes and
// the same hash. Hashing now uses the platform's own SHA-256, which a browser and a terminal both have.

/** Canonical JSON: object keys sorted, no whitespace, `undefined` members dropped. Numbers must be finite. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical: number is not finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonical: unsupported value of type ${typeof value}`);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const hashOf = (value: unknown): Promise<string> => sha256Hex(canonical(value));
