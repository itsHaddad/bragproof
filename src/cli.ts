#!/usr/bin/env bun
// The same reader as the page, in a terminal: bun src/cli.ts <session.jsonl> [--json]
// It prints the report and its id. The id matches the one the page shows for the same file and rules.

import { analyze } from "./core/analyze.ts";
import { GROUPS } from "./core/groups.ts";
import { NotALog } from "./core/types.ts";

const [path, flag] = process.argv.slice(2);
if (!path || path === "--help") {
  console.log("Usage: bun src/cli.ts <session.jsonl> [--json]\nClaude Code keeps its session logs under ~/.claude/projects/<project>/<session>.jsonl");
  process.exit(path ? 0 : 2);
}
try {
  const report = await analyze(await Bun.file(path).text());
  if (flag === "--json") console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.session.steps} steps, ${report.session.turns} turns, ${report.findings.length} findings. Rules ${report.rules}.`);
    for (const group of GROUPS) {
      const found = report.findings.filter((f) => f.group === group.id);
      if (found.length === 0) continue;
      console.log(`\n${group.title} (${found.length})`);
      for (const f of found) console.log(`  step ${f.step}  ${f.fact}\n           ${f.evidence}`);
    }
    if (report.hosts.length > 0) console.log(`\nHosts named in commands: ${report.hosts.join(", ")}`);
    console.log(`\nReport id ${report.id}\nA clean report is not proof of a clean session: see the method page.`);
  }
} catch (e) {
  console.error(e instanceof NotALog ? e.message : `Could not read the file: ${(e as Error).message}`);
  process.exit(1);
}
