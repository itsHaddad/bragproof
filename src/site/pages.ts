// The words and structure of each page. The report parts on the home page are made by the same code the browser uses.

import measured from "../../docs/measurement.json" with { type: "json" };
import { RULES } from "../core/analyze.ts";
import { GROUPS, groupOf } from "../core/groups.ts";
import { LIMITS } from "../core/parse.ts";
import type { Report } from "../core/types.ts";
import { toHtml } from "../ui/h.ts";
import { icon, mark } from "../ui/icons.ts";
import { fingerprint, ledger, panel } from "../ui/view.ts";
import { esc, sourceLink } from "./layout.ts";
import { RULE_TEXT } from "./rules-text.ts";

/** What the hand reading found. The files it was read from are the measure workflow's artifacts; see docs/MEASUREMENT.md. */
export const READ_BY_HAND = { primary: { read: 40, held: 39 }, other: { read: 30, held: 26 }, said: { read: 30, heldAtMost: 13 } } as const;

const M = measured as { read: number; drawn: number; listed: number; seed: string; commit: string; askedFirst: { no: number }; k1: { sessions: number; percent: number }; notInDiff: { sessions: number; percent: number }; anyShown: { sessions: number; percent: number }; groups: Record<string, { sessions: number; percent: number }>; rules: Record<string, { sessions: number; percent: number; findings: number }> };
const SHOWN = GROUPS.filter((g) => g.id !== "said");
const pct = (n: number): string => `${n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function rates(): string {
  const top = Math.max(...SHOWN.map((g) => M.groups[g.id]?.percent ?? 0), 1);
  const rows = SHOWN.map((g) => {
    const v = M.groups[g.id] ?? { sessions: 0, percent: 0 };
    return `<tr><td>${toHtml(mark(g.shape))} ${esc(g.title)}</td><td class="bar-cell"><svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="fill-x" width="${Math.round((v.percent / top) * 1000) / 10}" height="10"/></svg></td><td class="num">${v.sessions} of ${M.read}</td><td class="num">${pct(v.percent)}</td></tr>`;
  }).join("");
  return `<div class="wide-table" data-reveal><table class="rates rules-table"><thead><tr><th scope="col">Kind of finding</th><th scope="col"><span class="visually-hidden">Share as a bar</span></th><th scope="col" class="num">Sessions</th><th scope="col" class="num">Share</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function home(example: Report, origin: string): string {
  const megabytes = LIMITS.bytes / 1024 / 1024;
  return `<section class="hero page"><div class="split">
<div class="hero-text">
<h1 data-enter="0">The diff shows the code. The log shows the rest.</h1>
<p class="lead" data-enter="1">Give it a coding agent's session log. See each check skipped, key file opened and package brought in, with the line that shows it.</p>
<div class="actions" data-enter="2">
<button class="btn btn-primary" id="choose" type="button">${toHtml(icon("file"))}Choose a log file</button>
<input class="visually-hidden" type="file" id="file" accept=".jsonl,.json,.txt,application/json,text/plain" tabindex="-1" aria-hidden="true">
<button class="btn btn-plain" id="paste-open" type="button" aria-expanded="false" aria-controls="paste">${toHtml(icon("paste"))}Paste text</button>
<button class="btn btn-plain" id="back" type="button" hidden>Back to the example</button>
</div>
<p class="where" data-enter="3">${toHtml(icon("lock"))}<span>Read on this device and sent nowhere. Claude Code keeps its logs in <code>~/.claude/projects</code>. Up to ${megabytes}&nbsp;MB.</span></p>
<div class="feedback">
<div class="paste" id="paste" hidden>
<div class="field"><label for="paste-text">Lines from a session log</label><textarea class="input" id="paste-text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="error"></textarea></div>
<button class="btn btn-plain" id="paste-read" type="button">Read this text</button>
</div>
<p class="status" id="status" role="status"></p>
<p class="error" id="error" role="alert" hidden></p>
</div>
</div>
<div class="panel" id="panel" tabindex="-1" data-enter="2" aria-label="Report">${toHtml(panel(example, "Example session", 0, true))}</div>
</div></section>

<section class="section page" aria-labelledby="h-ledger">
<div class="split"><h2 id="h-ledger">Every finding, with its line</h2><p class="lead">Each row is something the log shows the agent did. It may have been asked to: a log cannot say. Press a row to find it on the tape.</p></div>
<div id="ledger">${toHtml(ledger(example, 0))}</div>
</section>

<section class="section page" aria-labelledby="h-rates"><div class="split flip">
${rates()}
<div>
<h2 id="h-rates">How often agents do this</h2>
<p>These rules were run over ${M.read} real sessions that their authors made public. ${M.anyShown.sessions} of them (${pct(M.anyShown.percent)}) had at least one finding, and ${M.notInDiff.sessions} (${pct(M.notInDiff.percent)}) had one that no diff can show. ${M.askedFirst.no} ran with permission prompts switched off.</p>
<p><a class="more" href="/method/">How this was measured, and how to run it again</a></p>
</div>
</div></section>

<section class="section page" aria-labelledby="h-limits"><div class="split">
<div>
<h2 id="h-limits">What a clean report does not prove</h2>
<ul class="plain-list">
<li>${toHtml(icon("note"))}<span>An agent can do the same things in ways these rules do not know, or where the log does not look.</span></li>
<li>${toHtml(icon("note"))}<span>The log sits on the same disk as the agent, which could change it.</span></li>
<li>${toHtml(icon("note"))}<span>Whether the tests passed. A rule for that was tried, was wrong more often than right, and is switched off.</span></li>
</ul>
</div>
<div class="card">
<div id="fingerprint">${toHtml(fingerprint(example))}</div>
<button class="btn btn-plain" id="copy-id" type="button">${toHtml(icon("copy"))}Copy the report id <span class="copy-said" role="status"></span></button>
<p class="command">bun src/cli.ts session.jsonl</p>
<p class="caption">The same file and rules give the same id in a terminal. Try it with the <a href="${sourceLink(origin, "")}">source</a> and the <a href="/example-session.jsonl">example log</a>.</p>
</div>
</div></section>
<script type="application/json" id="example-report">${JSON.stringify(example).replace(/</g, "\\u003c")}</script>`;
}

export function method(origin: string): string {
  const ruleRows = RULE_TEXT.map((r) => {
    const g = groupOf(r.group);
    const m = M.rules[r.id];
    return `<tr><td>${toHtml(mark(g.shape))}${esc(g.short)}</td><td>${esc(r.shows)}</td><td class="num">${m ? `${m.sessions} of ${M.read}` : `0 of ${M.read}`}</td></tr>`;
  }).join("");
  return `<section class="hero page"><div class="split">
<div>
<h1 data-enter="0">How it works, and how far to trust it</h1>
</div>
<div data-enter="1">
<p class="lead">Each rule looks for one thing a session log can show beyond doubt, such as a commit made with its checks off. A finding is a fact with its line. There is no score.</p>
<p class="muted">The page reads Claude Code session logs. Other agents' logs are not read yet and are refused with a message.</p>
</div>
</div></section>

<section class="section page" aria-labelledby="h-rules">
<div class="split"><h2 id="h-rules">The rules</h2><p class="lead">Rules <span class="mono">${esc(RULES)}</span>. The last column is how many of ${M.read} public sessions each rule reported in, measured at commit <span class="mono">${esc(M.commit.slice(0, 7))}</span>.</p></div>
<div class="wide-table" data-reveal><table class="rules-table"><thead><tr><th scope="col">Kind</th><th scope="col">What the log has to show</th><th scope="col" class="num">Sessions</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
</section>

<section class="section page" aria-labelledby="h-measured"><div class="split">
<div class="prose">
<h2 id="h-measured">How the numbers were made</h2>
<p>${M.drawn} sessions were drawn at random, with a fixed seed, from the ${M.listed.toLocaleString("en-GB")} public traces of the SWE-chat dataset. ${M.read} were Claude Code logs with at least one step and were read; the rest were another agent's format or empty.</p>
<p>Then findings were drawn at random and read by hand against the log. The reading was done by the builder, a language model, and not by an outside person. Treat it as a first check.</p>
<p>One public repository workflow does the drawing and counting: <a href="${sourceLink(origin, ".github/workflows/measure.yml")}">measure.yml</a>. The pass marks were written down before the first run: <a href="${sourceLink(origin, "docs/RETHINK.md")}">the plan</a>, <a href="${sourceLink(origin, "docs/MEASUREMENT.md")}">the result</a>.</p>
</div>
<div class="wide-table" data-reveal><table class="rates"><thead><tr><th scope="col">What was checked</th><th scope="col" class="num">Result</th></tr></thead><tbody>
<tr><td>Sessions with a check skipped or switched off, or a key file opened</td><td class="num">${M.k1.sessions} of ${M.read} (${pct(M.k1.percent)})</td></tr>
<tr><td>Those findings, read by hand: the action happened as stated</td><td class="num">${READ_BY_HAND.primary.held} of ${READ_BY_HAND.primary.read}</td></tr>
<tr><td>Other findings (brought in, hard to undo), read by hand, before three fixes</td><td class="num">${READ_BY_HAND.other.held} of ${READ_BY_HAND.other.read}</td></tr>
<tr><td>&ldquo;Said the tests pass&rdquo; with no passing run in the log: held at most</td><td class="num">${READ_BY_HAND.said.heldAtMost} of ${READ_BY_HAND.said.read}, switched off</td></tr>
<tr><td>Hidden text shown to the agent</td><td class="num">0 of ${M.read}</td></tr>
</tbody></table><p class="caption">Sessions come from people who chose to publish their logs, and several come from the same few projects. Other people's rates will differ.</p></div>
</div></section>

<section class="section page" aria-labelledby="h-cannot"><div class="split flip">
<div class="prose">
<h2 id="h-cannot">What it cannot see</h2>
<ul class="plain-list">
<li>${toHtml(icon("note"))}<span><strong>Anything outside the log.</strong> A script the agent wrote and ran can do what no rule sees. So can a sub-agent whose steps are logged elsewhere.</span></li>
<li>${toHtml(icon("note"))}<span><strong>Intent.</strong> You may have asked for the force push. The log does not say, so the page does not guess.</span></li>
<li>${toHtml(icon("note"))}<span><strong>A log that was changed.</strong> The file is on the same disk as the agent, with the same rights.</span></li>
<li>${toHtml(icon("note"))}<span><strong>Ways around the patterns.</strong> A flag passed through a variable or an alias is not matched. The rules are public, so they can be avoided on purpose.</span></li>
</ul>
</div>
<div class="prose">
<h2>Your log stays with you</h2>
<p>The page has no place to send a log to. It is a set of files with no server code behind them, and its content policy forbids the script from connecting to any address, this one included. You can load the page, switch the network off, and it still works.</p>
<p>Nothing is stored on your device either. Closing the tab forgets the log.</p>
<p>Lines quoted from a log are shown as text. Hidden and direction-changing characters are replaced by their code, so what you read is what is there.</p>
<p><a class="more" href="${sourceLink(origin, "SECURITY.md")}">Security notes and threat model</a></p>
</div>
</div></section>`;
}

export function notFound(): string {
  return `<section class="hero page"><div class="split"><div><h1 data-enter="0">No page at this address</h1></div><div data-enter="1"><p class="lead">The address may be mistyped, or the page was removed.</p><p><a class="btn btn-primary" href="/">Read a session log</a></p></div></div></section>`;
}
