#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultFile, find, KINDS, load, type Made, put, remove, STATES, save } from "../made/store.ts";

const HELP = `made: a log of what your agents built, so you and your other agents can find it. Local only.

  made find <words...> [--kind k] [--state s] [--json]     search; every word must match
  made list [--kind k] [--project p] [--json]              everything, newest first
  made show <id>                                           one entry in full
  made add --name N --what "one sentence" --kind K (--path P | --url U | --repo R)
           [--use "how to run it"] [--project P] [--tags a,b] [--state S] [--by who]
                                                           add, or update the entry of the same name and project
  made import <file.jsonl>                                 add many (one JSON object per line)
  made rm <id>
  made check [--write]                                     see whether each path exists and each url answers
  made html [--out file]                                   a page of everything, to open in a browser

  kinds:  ${KINDS.join(", ")}
  states: ${STATES.join(", ")}
  file:   ${defaultFile()}   (set MADE_FILE to use another)

  Before building something, run made find. After building something another session could use, run made add.`;

function parse(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}
const str = (v: string | true | undefined) => (typeof v === "string" ? v : undefined);
const home = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** One entry as an agent wants to read it: what, where, how, and anything known to be wrong with it. */
export function line(e: Made): string {
  const where = [e.path, e.url, e.repo].filter(Boolean).join("  ");
  const flags = [e.state !== "unknown" ? e.state : "", e.checked && !e.checked.ok ? "CHECK FAILED: " + e.checked.note : ""].filter(Boolean).join(", ");
  return `${e.id}  [${e.kind}${flags ? ", " + flags : ""}]\n  ${e.what}\n  where: ${where}${e.use ? `\n  use:   ${e.use}` : ""}`;
}

async function checkOne(e: Made): Promise<{ ok: boolean; note: string }> {
  const notes: string[] = [];
  let ok = true;
  if (e.path && !existsSync(home(e.path))) {
    ok = false;
    notes.push("path is gone");
  }
  if (e.url) {
    try {
      const res = await fetch(e.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (res.status >= 400) {
        ok = false;
        notes.push("url answers " + res.status);
      }
    } catch {
      ok = false;
      notes.push("url does not answer");
    }
  }
  return { ok, note: notes.join("; ") || "found" };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(entries: Made[]): string {
  const groups = new Map<string, Made[]>();
  for (const e of entries) groups.set(e.project ?? "(no project)", [...(groups.get(e.project ?? "(no project)") ?? []), e]);
  const card = (e: Made) => `<article><h3>${esc(e.name)} <span class="k">${esc(e.kind)}${e.state !== "unknown" ? " · " + esc(e.state) : ""}</span></h3><p>${esc(e.what)}</p>
<p class="w">${e.url && /^https?:\/\//.test(e.url) ? `<a href="${esc(e.url)}">${esc(e.url)}</a> ` : ""}${e.path ? `<code>${esc(e.path)}</code> ` : ""}${e.repo ? `<code>${esc(e.repo)}</code>` : ""}</p>${e.use ? `<pre>${esc(e.use)}</pre>` : ""}${e.checked && !e.checked.ok ? `<p class="bad">Check failed ${esc(e.checked.at)}: ${esc(e.checked.note)}</p>` : ""}</article>`;
  const body = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([p, es]) => `<section><h2>${esc(p)} <span class="k">${es.length}</span></h2>${es.map(card).join("\n")}</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Made</title><style>
:root{--bg:#fbfaf7;--card:#fff;--fg:#1c1b19;--muted:#66625a;--line:#e6e1d6;--link:#14532d;--bad:#8a4a12}@media (prefers-color-scheme:dark){:root{--bg:#141311;--card:#1c1b18;--fg:#ece9e2;--muted:#a39e93;--line:#2f2d28;--link:#9ddbb4;--bad:#e6b37c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px 60px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 10px}h3{font-size:1rem;margin:0 0 4px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}p{margin:0 0 6px}.k{color:var(--muted);font-weight:400;font-size:.94rem}.w{overflow-wrap:anywhere}a{color:var(--link)}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.94em}pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.bad{color:var(--bad)}.muted{color:var(--muted)}
</style></head><body><main><h1>Made</h1><p class="muted">${entries.length} things your agents built, by project. Search from a terminal with <code>made find &lt;words&gt;</code>.</p>${body}</main></body></html>`;
}

async function main(): Promise<number> {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parse(argv);
  const file = defaultFile();
  const out = (entries: Made[]) => console.log(flags.json ? JSON.stringify(entries, null, 2) : entries.length ? entries.map(line).join("\n\n") : "nothing found");

  if (cmd === "find") {
    if (!rest.length) return fail("find needs words to look for");
    out(find(load(file), rest.join(" "), { kind: str(flags.kind), state: str(flags.state), limit: Number(str(flags.limit)) || 12 }));
    return 0;
  }
  if (cmd === "list") {
    const project = str(flags.project);
    out(load(file).filter((e) => (!flags.kind || e.kind === flags.kind) && (!project || e.project === project)).sort((a, b) => (b.updated > a.updated ? 1 : -1)));
    return 0;
  }
  if (cmd === "show") {
    const e = load(file).find((x) => x.id === rest[0]);
    if (!e) return fail("no entry with that id");
    console.log(JSON.stringify(e, null, 2));
    return 0;
  }
  if (cmd === "add") {
    try {
      const e = put({ id: str(flags.id), name: str(flags.name), what: str(flags.what), kind: str(flags.kind) as Made["kind"], path: str(flags.path), url: str(flags.url), repo: str(flags.repo), use: str(flags.use), project: str(flags.project), tags: str(flags.tags)?.split(","), state: str(flags.state) as Made["state"], by: str(flags.by) }, file);
      console.log("saved " + e.id);
      return 0;
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  if (cmd === "import") {
    if (!rest[0] || !existsSync(rest[0])) return fail("import needs a file with one JSON object per line");
    let ok = 0;
    for (const [i, raw] of readFileSync(rest[0], "utf8").split("\n").entries()) {
      if (!raw.trim()) continue;
      try {
        put(JSON.parse(raw), file);
        ok++;
      } catch (e) {
        console.error(`line ${i + 1}: ${(e as Error).message}`);
      }
    }
    console.log(`imported ${ok}`);
    return 0;
  }
  if (cmd === "rm") {
    if (!remove(rest[0] ?? "", file)) return fail("no entry with that id");
    console.log("removed");
    return 0;
  }
  if (cmd === "check") {
    const entries = load(file);
    const at = new Date().toISOString().slice(0, 10);
    let bad = 0;
    for (const e of entries) {
      const found = await checkOne(e);
      e.checked = { at, ...found };
      if (!found.ok) {
        bad++;
        console.log(`${e.id}: ${found.note}`);
      }
    }
    if (flags.write) save(entries, file);
    console.log(`${entries.length - bad} of ${entries.length} found${flags.write ? "; results saved" : " (add --write to record this)"}`);
    return 0;
  }
  if (cmd === "html") {
    const to = str(flags.out) ?? join(dirname(file), "index.html");
    writeFileSync(to, page(load(file)));
    console.log(to);
    return 0;
  }
  console.log(HELP);
  return cmd && cmd !== "help" && cmd !== "--help" ? 64 : 0;
}

function fail(why: string): number {
  console.error(why);
  return 1;
}

if (import.meta.main) main().then((code) => process.exit(code));
