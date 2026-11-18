// Text of a session log in, report out. No clock, no randomness, no network: the same bytes and the same rules
// give the same report and the same id, in a browser tab or in a terminal.

import { hashOf, sha256Hex } from "./canonical.ts";
import { saidFindings } from "./claims.ts";
import { parseSession } from "./parse.ts";
import { editFindings } from "./rules-edit.ts";
import { shellFindings } from "./rules-shell.ts";
import type { Finding, Report, Session } from "./types.ts";

/** Changes whenever a rule changes what it reports. A report id is only comparable under the same rules. */
export const RULES = "2026-11-18.2";

/** Rules measured too imprecise to show. See docs/MEASUREMENT.md for the numbers that put them here:
 * of 30 "said the tests pass" findings read by hand, 17 were wrong and at most 13 could be right. */
export const SWITCHED_OFF: ReadonlySet<string> = new Set<string>(["said-no-run", "said-last-failed"]);

const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[?::1|.*\.local$|.*\.test$|example\.(com|org)$)/;

export function findingsOf(session: Session, all = false): { findings: Finding[]; hosts: string[] } {
  const findings: Finding[] = [];
  const hosts = new Set<string>();
  const testSteps = new Set<number>();
  for (const step of session.steps) {
    if (step.kind === "shell") {
      const shell = shellFindings(step, session.cwd);
      findings.push(...shell.findings);
      for (const h of shell.hosts) hosts.add(h);
      if (shell.ranTests) testSteps.add(step.n);
    }
    if (step.kind === "fetch") {
      const host = /^https?:\/\/([A-Za-z0-9.-]+)/.exec(step.url)?.[1];
      if (host) hosts.add(host.toLowerCase());
    }
    findings.push(...editFindings(step));
  }
  findings.push(...saidFindings(session.says, session.steps, testSteps));
  const shown = findings.filter((f) => all || !SWITCHED_OFF.has(f.rule)).sort((a, b) => a.step - b.step);
  return { findings: shown.slice(0, 2_000), hosts: [...hosts].filter((h) => !LOCAL.test(h)).sort().slice(0, 200) };
}

export async function analyze(text: string): Promise<Report> {
  const session = parseSession(text);
  const { findings, hosts } = findingsOf(session);
  const body = {
    rules: RULES,
    input: { sha256: await sha256Hex(text), bytes: new TextEncoder().encode(text).length, lines: session.lines, skippedLines: session.skippedLines },
    session: { steps: session.steps.length, turns: session.turns, models: session.models, askedFirst: session.askedFirst, start: session.start, end: session.end },
    hosts,
    findings,
  };
  return { ...body, id: await hashOf(body) };
}
