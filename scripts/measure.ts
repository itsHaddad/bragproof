// The measurement behind the numbers on the method page, and the kill test in docs/RETHINK.md.
// Draws a seeded random sample of public sessions (SWE-chat traces, ODC-BY), reads each with the same engine the
// page uses, and writes the counts plus a random draw of findings for reading by hand.
//   bun scripts/measure.ts [sample size] [seed] [out dir]
// Run on a CI machine, not a laptop: it downloads a few hundred megabytes.

import { mkdir } from "node:fs/promises";
import { findingsOf, RULES, SWITCHED_OFF } from "../src/core/analyze.ts";
import { sha256Hex } from "../src/core/canonical.ts";
import { parseSession } from "../src/core/parse.ts";
import { quote } from "../src/core/text.ts";
import type { Finding, GroupId } from "../src/core/types.ts";

const DATASET = "cfahlgren1/SWE-chat";
const SIZE = Number(process.argv[2] ?? 300);
const SEED = process.argv[3] ?? "bragproof-2026-11-18";
const OUT = process.argv[4] ?? "measurement";
// The same rules the kill test counted, now in four groups: the neutral "settings and pipelines" rules were split out.
const PRIMARY: GroupId[] = ["skipped", "off", "secrets", "config"];

async function listTraces(): Promise<string[]> {
  const names: string[] = [];
  let url: string | null = `https://huggingface.co/api/datasets/${DATASET}/tree/main/traces?limit=1000`;
  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`list: ${res.status}`);
    for (const item of (await res.json()) as { type: string; path: string }[]) if (item.type === "file" && item.path.endsWith(".jsonl")) names.push(item.path);
    const next: RegExpExecArray | null = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "");
    url = next?.[1] ?? null;
  }
  return names.sort();
}

/** The same sample for the same seed and file list: files are ordered by the hash of seed and name. */
async function draw<T>(items: T[], key: (item: T) => string, n: number, seed: string): Promise<T[]> {
  const ranked = await Promise.all(items.map(async (item) => ({ item, rank: await sha256Hex(`${seed}\n${key(item)}`) })));
  return ranked.sort((a, b) => (a.rank < b.rank ? -1 : 1)).slice(0, n).map((r) => r.item);
}

await mkdir(OUT, { recursive: true });
const all = await listTraces();
const sample = await draw(all, (p) => p, SIZE, SEED);
console.log(`${all.length} traces listed, ${sample.length} drawn with seed "${SEED}"`);

interface Row { session: string; bytes: number; steps: number; askedFirst: boolean | null; findings: Finding[] }
const rows: Row[] = [];
const unread: string[] = [];
const context: Record<string, unknown> = {};
for (const path of sample) {
  const id = path.replace(/^traces\//, "").replace(/\.jsonl$/, "");
  const res = await fetch(`https://huggingface.co/datasets/${DATASET}/resolve/main/${path}`);
  if (!res.ok) {
    unread.push(`${id}: http ${res.status}`);
    continue;
  }
  const text = await res.text();
  try {
    const session = parseSession(text);
    if (session.steps.length === 0) {
      unread.push(`${id}: no steps`);
      continue;
    }
    const { findings } = findingsOf(session, true);
    rows.push({ session: id, bytes: text.length, steps: session.steps.length, askedFirst: session.askedFirst, findings });
    for (const f of findings) {
      const step = session.steps[f.step - 1];
      const tests = session.steps.filter((s) => s.n <= f.step && s.kind === "shell" && /test|pytest|jest|vitest|check/.test(s.command)).slice(-4);
      context[`${id}#${f.step}#${f.rule}`] = {
        command: quote(step?.command ?? "", 700),
        path: step?.path,
        failed: step?.failed,
        output: quote(step?.output ?? "", 400),
        ...(f.group === "said" ? { closing: quote(session.says.find((s) => s.afterStep === f.step || s.time === f.time)?.text ?? "", 900), testsBefore: tests.map((s) => ({ n: s.n, turn: s.turn, failed: s.failed, command: quote(s.command, 160), output: quote(s.output, 200) })) } : {}),
      };
    }
  } catch (e) {
    unread.push(`${id}: ${(e as Error).message}`);
  }
}

const n = rows.length;
const share = (count: number) => Math.round((count / n) * 1000) / 10;
const withGroup = (groups: GroupId[]) => rows.filter((r) => r.findings.some((f) => groups.includes(f.group))).length;
const rules = new Map<string, { group: GroupId; findings: number; sessions: number }>();
for (const r of rows) {
  const here = new Set<string>();
  for (const f of r.findings) {
    const row = rules.get(f.rule) ?? { group: f.group, findings: 0, sessions: 0 };
    row.findings++;
    if (!here.has(f.rule)) row.sessions++;
    here.add(f.rule);
    rules.set(f.rule, row);
  }
}
const groups: GroupId[] = ["skipped", "off", "config", "secrets", "outside", "undo", "hidden", "said"];
const summary = {
  dataset: DATASET,
  seed: SEED,
  listed: all.length,
  drawn: sample.length,
  read: n,
  unread,
  commit: process.env.GITHUB_SHA ?? "local",
  askedFirst: { no: rows.filter((r) => r.askedFirst === false).length, yes: rows.filter((r) => r.askedFirst === true).length, unknown: rows.filter((r) => r.askedFirst === null).length },
  k1: { sessions: withGroup(PRIMARY), percent: share(withGroup(PRIMARY)) },
  // Findings a diff cannot show at all: checks skipped, key files opened, work thrown away.
  notInDiff: { sessions: withGroup(["skipped", "secrets", "undo"]), percent: share(withGroup(["skipped", "secrets", "undo"])) },
  anyShown: { sessions: rows.filter((r) => r.findings.some((f) => !SWITCHED_OFF.has(f.rule))).length, percent: share(rows.filter((r) => r.findings.some((f) => !SWITCHED_OFF.has(f.rule))).length) },
  rulesVersion: RULES,
  groups: Object.fromEntries(groups.map((g) => [g, { sessions: withGroup([g]), percent: share(withGroup([g])) }])),
  rules: Object.fromEntries([...rules].sort((a, b) => b[1].sessions - a[1].sessions).map(([rule, v]) => [rule, { ...v, percent: share(v.sessions) }])),
};

// For reading by hand: 40 primary findings and up to 30 claims findings, drawn by the same seeded order,
// at most two per session and rule so one busy session cannot fill the draw.
const flat = rows.flatMap((r) => r.findings.map((f) => ({ ...f, session: r.session })));
const capped = (list: typeof flat) => {
  const seen = new Map<string, number>();
  return list.filter((f) => {
    const k = `${f.session}#${f.rule}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    return (seen.get(k) ?? 0) <= 2;
  });
};
const key = (f: (typeof flat)[number]) => `${f.session}#${f.step}#${f.rule}`;
const toRead = {
  primary: (await draw(capped(flat.filter((f) => PRIMARY.includes(f.group))), key, 40, SEED)).map((f) => ({ ...f, context: context[key(f)] })),
  said: (await draw(capped(flat.filter((f) => f.group === "said")), key, 30, SEED)).map((f) => ({ ...f, context: context[key(f)] })),
  other: (await draw(capped(flat.filter((f) => !PRIMARY.includes(f.group) && f.group !== "said")), key, 30, SEED)).map((f) => ({ ...f, context: context[key(f)] })),
};

await Bun.write(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await Bun.write(`${OUT}/to-read.json`, JSON.stringify(toRead, null, 2));
await Bun.write(`${OUT}/findings.jsonl`, flat.map((f) => JSON.stringify(f)).join("\n"));
console.log(JSON.stringify(summary, null, 2));
