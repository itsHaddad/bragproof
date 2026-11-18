// "Said and shown": the agent's closing message says the tests pass; does the log show a test run that passed?
// This is the weakest kind of finding. Tests can run where the log does not see them (another terminal, a
// background job, a browser), and an agent may fail a test on purpose to prove the test works. So the wording
// is "the log does not show it", and whether this rule is switched on at all is decided by its measured
// precision (docs/MEASUREMENT.md), not by how good it sounds.

import { quote } from "./text.ts";
import type { Finding, Say, Step } from "./types.ts";

const CLAIM = /\b(?:all\s+)?(?:\d[\d,]*\s+)?(?:(?:unit|integration|e2e|existing)\s+)?tests?\s+(?:(?:are|is|now|all|still|suite)\s+){0,3}(?:pass(?:ing|ed|es)?|green)\b|\b\d[\d,]*\s+(?:tests?\s+)?pass(?:ed|ing)\b|\ball\s+(?:checks|tests)\s+(?:are\s+)?(?:pass|green)/i;
const HEDGE = /\b(should|will|would|once|if|until|ensure|make sure|verify that|whether|not|cannot|unable|todo|need to|needs to|to confirm|expected to|please run|you can run|when|before|after you|so that|to see|didn't|don't|doesn't|haven't|couldn't|can't|won't|isn't|aren't|fail(s|ed|ing|ure)?)\b/i;

/** Sentences of a closing message that say, without hedging, that tests pass. */
export function passClaims(text: string): string[] {
  const plain = text.replace(/```[\s\S]*?```/g, " ");
  return plain
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length < 400 && CLAIM.test(s) && !HEDGE.test(s) && !s.endsWith("?"));
}

export function saidFindings(says: Say[], steps: Step[], testSteps: Set<number>): Finding[] {
  const out: Finding[] = [];
  for (const say of says) {
    const claim = passClaims(say.text)[0];
    if (!claim) continue;
    const before = steps.filter((s) => s.n <= say.afterStep && testSteps.has(s.n));
    const inTurn = before.filter((s) => s.turn === say.turn);
    const last = inTurn[inTurn.length - 1];
    if (before.length === 0) out.push({ rule: "said-no-run", group: "said", step: say.afterStep, time: say.time, fact: "Said the tests pass. The log shows no test command before that", evidence: quote(claim) });
    else if (last && last.failed === true) out.push({ rule: "said-last-failed", group: "said", step: last.n, time: say.time, fact: "Said the tests pass. The last test command before that ended with an error", evidence: quote(claim) });
  }
  return out;
}
