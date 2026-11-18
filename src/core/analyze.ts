// Text of a session log in, report out. No clock, no randomness, no network: the same bytes and the same rules
// give the same report and the same id, in a browser tab or in a terminal.

import { hashOf, sha256Hex } from "./canonical.ts";
import { saidFindings } from "./claims.ts";
import { parseSession } from "./parse.ts";
import { editFindings } from "./rules-edit.ts";
import { shellFindings } from "./rules-shell.ts";
import { quote } from "./text.ts";
import type { CheckRun, Finding, Report, Session } from "./types.ts";

/** Changes whenever a rule changes what it reports. A report id is only comparable under the same rules. */
export const RULES = "2026-11-19.1";

/** Rules measured too imprecise to show. See docs/MEASUREMENT.md for the numbers that put them here:
 * of 30 "said the tests pass" findings read by hand, 17 were wrong and at most 13 could be right. */
export const SWITCHED_OFF: ReadonlySet<string> = new Set<string>(["said-no-run", "said-last-failed"]);

const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[?::1|.*\.local$|.*\.test$|example\.(com|org)$)/;

export interface Read {
  findings: Finding[];
  hosts: string[];
  checks: CheckRun[];
  commits: { made: number; noVerify: number };
}

const lastLine = (output: string): string => quote(output.trim().split("\n").filter((l) => l.trim()).pop() ?? "", 60);

export function findingsOf(session: Session, all = false): Read {
  const findings: Finding[] = [];
  const hosts = new Set<string>();
  const testSteps = new Set<number>();
  const checks: CheckRun[] = [];
  const commits = { made: 0, noVerify: 0 };
  for (const step of session.steps) {
    if (step.kind === "shell") {
      const shell = shellFindings(step, session.cwd);
      findings.push(...shell.findings);
      for (const h of shell.hosts) hosts.add(h);
      if (shell.ranTests) testSteps.add(step.n);
      if (shell.check) checks.push({ step: step.n, command: shell.check, failed: step.failed, lastLine: lastLine(step.output) });
      commits.made += shell.commits;
      commits.noVerify += shell.noVerify;
    }
    if (step.kind === "fetch") {
      const host = /^https?:\/\/([A-Za-z0-9.-]+)/.exec(step.url)?.[1];
      if (host) hosts.add(host.toLowerCase());
    }
    findings.push(...editFindings(step));
  }
  findings.push(...saidFindings(session.says, session.steps, testSteps));
  const shown = findings.filter((f) => all || !SWITCHED_OFF.has(f.rule)).sort((a, b) => a.step - b.step);
  return { findings: shown.slice(0, 2_000), hosts: [...hosts].filter((h) => !LOCAL.test(h)).sort().slice(0, 200), checks: checks.slice(-8), commits };
}

const LETTER: Record<string, string> = { shell: "s", edit: "e", read: "r", fetch: "f", other: "o" };

export async function analyze(text: string): Promise<Report> {
  const session = parseSession(text);
  const { findings, hosts, checks, commits } = findingsOf(session);
  const bytes = new TextEncoder().encode(text);
  const track = session.steps.map((s) => (s.failed ? (LETTER[s.kind] ?? "o").toUpperCase() : (LETTER[s.kind] ?? "o"))).join("");
  const closing = quote(session.says[session.says.length - 1]?.text ?? "", 220);
  const body = {
    rules: RULES,
    input: { sha256: await sha256Hex(bytes), bytes: bytes.length, lines: session.lines, skippedLines: session.skippedLines, stepsNotRead: session.stepsNotRead, linesCut: session.linesCut },
    session: { steps: session.steps.length, turns: session.turns, models: session.models.map((m) => quote(m, 60)), askedFirst: session.askedFirst, start: quote(session.start, 40), end: quote(session.end, 40), track, closing },
    labels: session.steps.map((s) => quote(s.command || s.path || s.url || s.tool, 90)),
    checks,
    commits,
    hosts,
    findings,
  };
  return { ...body, id: await hashOf(body) };
}
