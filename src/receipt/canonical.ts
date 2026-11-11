import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted, no whitespace, `undefined` members dropped. Two parties that hold the same
 * value always get the same bytes, so the same hash. Numbers must be finite; the formats here only use integers. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical: number is not finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map((v) => canonical(v === undefined ? null : v)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
  }
  throw new Error("canonical: unsupported value of type " + typeof value);
}

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

export const hashOf = (value: unknown): string => sha256Hex(canonical(value));
