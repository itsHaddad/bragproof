import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Made: a log of things agents built, kept as one JSON object per line in a file on this machine. Nothing
 * here is sent anywhere. The file is plain text on purpose: an agent can read it, grep it or fix a line. */

export const KINDS = ["site", "app", "cli", "service", "library", "skill", "script", "dataset", "doc", "other"] as const;
export const STATES = ["live", "working", "prototype", "abandoned", "unknown"] as const;

export type Made = {
  id: string;
  name: string;
  /** One sentence: what it is for, in words someone would search for. */
  what: string;
  kind: (typeof KINDS)[number];
  /** Where it is: a folder or file, a web address, a repository. At least one. */
  path?: string;
  url?: string;
  repo?: string;
  /** How to use or run it: a command, or a sentence. */
  use?: string;
  project?: string;
  tags: string[];
  state: (typeof STATES)[number];
  /** Who made it (an agent, a session, a person), when it was made, and when this entry last changed. */
  by?: string;
  made?: string;
  updated: string;
  /** Filled in by `made check`: when it was last looked at and what was found. */
  checked?: { at: string; ok: boolean; note: string };
};

export const defaultFile = () => process.env.MADE_FILE || join(homedir(), ".made", "made.jsonl");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "thing";
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Why a value cannot be an entry; empty when it can. */
export function problems(e: Partial<Made>): string[] {
  const bad: string[] = [];
  if (!text(e.name, 120)) bad.push("name is missing");
  if (text(e.what, 400).length < 12) bad.push("what must say in a sentence what it is for");
  if (!KINDS.includes(e.kind as Made["kind"])) bad.push("kind must be one of " + KINDS.join(", "));
  if (!text(e.path, 500) && !text(e.url, 500) && !text(e.repo, 500)) bad.push("say where it is: a path, a url or a repo");
  if (e.url && !/^https?:\/\//.test(e.url)) bad.push("url must start with http:// or https://");
  if (e.state !== undefined && !STATES.includes(e.state)) bad.push("state must be one of " + STATES.join(", "));
  return bad;
}

export function load(file = defaultFile()): Made[] {
  if (!existsSync(file)) return [];
  const out: Made[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Made;
      if (e && typeof e.id === "string" && typeof e.name === "string") out.push({ ...e, tags: Array.isArray(e.tags) ? e.tags : [] });
    } catch {
      /* a broken line is skipped, never fatal: the rest of the log still works */
    }
  }
  return out;
}

export function save(entries: Made[], file = defaultFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
}

/** Adds an entry, or updates the one with the same id (or the same name in the same project). Returns it. */
export function put(input: Partial<Made>, file = defaultFile(), now = new Date()): Made {
  const bad = problems(input);
  if (bad.length) throw new Error(bad.join("; "));
  const entries = load(file);
  const name = text(input.name, 120);
  const project = text(input.project, 80) || undefined;
  const at = entries.findIndex((e) => (input.id ? e.id === input.id : e.name.toLowerCase() === name.toLowerCase() && (e.project ?? "") === (project ?? "")));
  const before = at >= 0 ? entries[at] : undefined;
  let id = input.id || before?.id || slug(project && !slug(name).startsWith(slug(project)) ? `${project}-${name}` : name);
  if (!before) for (let n = 2; entries.some((e) => e.id === id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
  const entry: Made = {
    ...before,
    id,
    name,
    what: text(input.what, 400),
    kind: input.kind as Made["kind"],
    ...(text(input.path, 500) ? { path: text(input.path, 500) } : {}),
    ...(text(input.url, 500) ? { url: text(input.url, 500) } : {}),
    ...(text(input.repo, 500) ? { repo: text(input.repo, 500) } : {}),
    ...(text(input.use, 600) ? { use: text(input.use, 600) } : {}),
    ...(project ? { project } : {}),
    tags: [...new Set((input.tags ?? before?.tags ?? []).map((t) => slug(String(t))).filter(Boolean))].slice(0, 12),
    state: input.state ?? before?.state ?? "unknown",
    ...(text(input.by, 80) ? { by: text(input.by, 80) } : {}),
    ...(text(input.made, 10) || before?.made ? { made: text(input.made, 10) || before?.made } : { made: now.toISOString().slice(0, 10) }),
    updated: now.toISOString().slice(0, 10),
  };
  if (at >= 0) entries[at] = entry;
  else entries.push(entry);
  save(entries, file);
  return entry;
}

export function remove(id: string, file = defaultFile()): boolean {
  const entries = load(file);
  const left = entries.filter((e) => e.id !== id);
  if (left.length === entries.length) return false;
  save(left, file);
  return true;
}

/** Entries matching every word, best first. A word in the name counts most, then tags and project, then the
 * sentence and the usage line. Abandoned things sink; things found broken by `made check` sink a little. */
export function find(entries: Made[], query: string, opts: { kind?: string; state?: string; limit?: number } = {}): Made[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  const scored: { e: Made; score: number }[] = [];
  for (const e of entries) {
    if (opts.kind && e.kind !== opts.kind) continue;
    if (opts.state && e.state !== opts.state) continue;
    const name = e.name.toLowerCase();
    const mid = [e.id, e.project ?? "", ...e.tags, e.kind].join(" ").toLowerCase();
    const rest = [e.what, e.use ?? "", e.path ?? "", e.url ?? "", e.repo ?? ""].join(" ").toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = name.includes(w) ? 6 : mid.includes(w) ? 3 : rest.includes(w) ? 1 : 0;
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (!all) continue;
    if (e.state === "abandoned") score -= 4;
    if (e.state === "live") score += 1;
    if (e.checked && !e.checked.ok) score -= 1;
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || (b.e.updated > a.e.updated ? 1 : -1)).slice(0, opts.limit ?? 20).map((s) => s.e);
}
