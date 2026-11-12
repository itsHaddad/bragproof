import { hostNote, type Outcome, outcomeHint, outcomeLabel } from "../../report/analyze.ts";
import type { ReportDetail, State } from "../reports.ts";
import { esc, page, plural, REPO } from "./layout.ts";
import { startedOf } from "./reports-home.ts";

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

/** The whole collection in numbers: the page to cite. */
export function statePage(s: State, origin: string): string {
  const started = startedOf(s);
  const bars = s.outcomes
    .map((o) => `<tr><td>${esc(outcomeLabel[o.outcome])}<div class="small muted">${esc(outcomeHint[o.outcome])}</div></td><td class="nw"><b>${o.n}</b> <span class="muted">${pct(o.n, s.total)}%</span></td><td class="barcell"><div class="bar${o.outcome === "started" ? " good" : ""}" style="width:${Math.max(pct(o.n, s.total), 1)}%"></div></td></tr>`)
    .join("");
  const list = (rows: { name: string; n: number }[], empty: string) => (rows.length ? `<div class="scroll"><table><tbody>${rows.map((r) => `<tr><td><code>${esc(r.name)}</code></td><td class="nw">${r.n} ${r.n === 1 ? "server" : "servers"}</td><td class="muted small">${hostNote(r.name)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${empty}</p>`);
  const body = `
<h1>The state of MCP servers</h1>
<p class="lede">What happened when ${s.total.toLocaleString("en")} MCP servers from npm were each installed on a clean machine and started with no configuration. Live numbers: they change as reports come in.</p>
<div class="facts">
<div class="fact"><b>${pct(started, s.total)}%</b><span>start with no setup (${started.toLocaleString("en")} of ${s.total.toLocaleString("en")})</span></div>
<div class="fact"><b>${s.contacting}</b><span>contact something when installed and started${s.hosts[0] && s.hosts[0].n * 2 > s.contacting ? `; ${s.hosts[0].n} of them the same host` : ""}</span></div>
<div class="fact"><b>${s.flagged}</b><span>have tool text with commands in capitals or other unusual wording</span></div>
<div class="fact"><b>${s.serious}</b><span>have tool text about the user, other tools or private files</span></div>
</div>

<h2>What happens when you start one</h2>
<div class="scroll"><table class="bars"><tbody>${bars}</tbody></table></div>
<p class="small"><a href="/?show=started#results">Browse the ones that start</a> · <a href="/?show=needs-setup#results">the ones that need setup</a></p>

${s.callable ? `<h2>Do they answer when called?</h2>
<p>For ${s.callable} servers the runner found a tool it was willing to call blind: one that takes no input and reads like looking something up. Called once with nothing, ${s.answering} (${pct(s.answering, s.callable)}%) returned a result not marked as an error from at least one such tool. The rest returned an error, asked for setup, or did not reply in time.</p>` : ""}

<h2>What they contact when installed and started</h2>
${list(s.hosts, "Nothing recorded yet.")}
<p class="small muted">Hosts looked up or connected to while a server was installed and started with no input, watched from outside its sandbox. The npm registry is left out. <a href="/?show=contacts#results">Which servers</a></p>

<h2>Settings they ask for most</h2>
${list(s.needs, "Nothing recorded yet.")}
<p class="small muted">Names found in the error output of servers that would not start.</p>

<h2>How this is measured</h2>
<ul>
<li>Each server is the newest version on npm, installed from the registry without running install scripts, on Linux x64 with Node 24.</li>
<li>It is started with no arguments, no environment and no input, as an unprivileged user in a sandbox, on a machine that is thrown away afterwards.</li>
<li>"Starts" means it answered the two requests every client sends first: <code>initialize</code> and <code>tools/list</code>.</li>
${s.leftOut ? `<li>${s.leftOut} packages that turned out to have no start command (libraries and kits, not servers) are left out of every number here.</li>` : ""}
<li>Up to five tools per server are called, and only ones that take no input and whose names read like looking something up. What the other tools do is not in these numbers.</li>
<li>A server that needs a key is not broken. "Needs setup" is a fact for whoever is about to use it, not a mark against it.</li>
</ul>
<p>Every report links to the public run that made it and can be checked without trusting this site. <a href="/about#check">How</a> · <a href="${REPO}">Source</a> · <a href="/v1/state">These numbers as JSON</a></p>`;
  return page({ title: "The state of MCP servers · Bragproof", origin, path: "/state", body, description: `${pct(started, s.total)}% of ${s.total} MCP servers from npm start with no setup. ${s.contacting} contact something just from being installed and started. Live numbers from checkable runs.`, alternate: "/v1/state" });
}

const BADGE: Partial<Record<Outcome, string>> = { started: "#17603a", "needs-setup": "#8a4a12", "needs-service": "#8a4a12" };

/** A badge for a README: says what the newest report found. Text is fixed words and numbers only. */
export function badgeSvg(d: ReportDetail | null): string {
  const o = d?.summary.outcome;
  // The same shape for every server that starts, so a clean result is not advertised while another is left out.
  const right = !d || !o ? "not reported" : o === "started" ? `starts · ${plural(d.summary.tools, "tool")}${d.report.network ? ` · contacts ${plural(d.summary.contacts.length, "host")}` : ""}` : outcomeLabel[o].toLowerCase();
  const color = (o && BADGE[o]) || "#66625a";
  const w1 = 70;
  const w2 = Math.round(right.length * 5.3) + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w1 + w2}" height="20" role="img" aria-label="bragproof: ${esc(right)}"><title>bragproof: ${esc(right)}</title><clipPath id="r"><rect width="${w1 + w2}" height="20" rx="4"/></clipPath><g clip-path="url(#r)"><rect width="${w1}" height="20" fill="#555"/><rect x="${w1}" width="${w2}" height="20" fill="${color}"/></g><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="8" y="14">bragproof</text><text x="${w1 + 8}" y="14" textLength="${w2 - 16}" lengthAdjust="spacing">${esc(right)}</text></g></svg>`;
}
