import { type Flag, flagLabel, hostNote, type Outcome, outcomeHint, outcomeLabel, saidFirst, seriousFlags } from "../../report/analyze.ts";
import type { Report } from "../../report/types.ts";
import type { ReportDetail, ReportRow } from "../reports.ts";
import type { ClaimRow } from "../sql.ts";
import { claimList } from "./cards.ts";
import { day, esc, page, plural, REPO } from "./layout.ts";

export const reportHref = (name: string) => "/r/" + name.split("/").map(encodeURIComponent).join("/");
const tone = (o: Outcome) => (o === "started" ? "ok" : o === "needs-setup" || o === "needs-service" ? "weak" : "off");
export const outcomeBadge = (o: Outcome) => `<span class="badge ${tone(o)}" title="${esc(outcomeHint[o])}">${esc(outcomeLabel[o])}</span>`;

/** One report as a card: the line an agent or a person scans when choosing. */
export function reportCard(r: ReportRow): string {
  const bits = [r.outcome === "started" ? plural(r.tools, "tool") : "", r.contacts > 0 ? `contacts ${plural(r.contacts, "host")}` : r.contacts === 0 && r.outcome === "started" ? "contacts 0 hosts" : "", r.serious ? `<span class="badge weak">tool text about the user, other tools or private files</span>` : ""].filter(Boolean);
  return `<article class="card claim">
<h3 class="mono"><a href="${reportHref(r.package)}">${esc(r.package)}</a> <span class="muted small">${esc(r.version)}</span></h3>
<div class="meta">${outcomeBadge(r.outcome)}${bits.map((b) => (b.startsWith("<") ? b : `<span class="nw">${b}</span>`)).join("")}<span class="nw">run ${day(r.ranAt)}</span></div>
</article>`;
}
export const reportList = (rows: ReportRow[], empty: string) => (rows.length ? `<div class="stack">${rows.map(reportCard).join("\n")}</div>` : `<p class="muted">${esc(empty)}</p>`);

/** A repository address written by the package: linked only when it is plainly a GitHub or GitLab page. */
const repoLink = (raw: string | undefined) => {
  const m = raw?.match(/(github\.com|gitlab\.com)[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/].*)?$/);
  return m ? `<a href="https://${m[1]}/${esc(m[2])}" rel="nofollow noopener">${esc(m[1])}/${esc(m[2])}</a>` : raw ? esc(raw) : "not stated";
};
const flagList = (flags: Flag[]) => `<ul>${flags.map((f) => `<li><b>${esc(flagLabel[f.kind])}</b> in <code>${esc(f.tool)}</code>${f.quote ? `: <q>${esc(f.quote)}</q>` : ""}</li>`).join("")}</ul>`;

export function reportPage(d: ReportDetail, claims: ClaimRow[], origin: string): string {
  const { report: r, summary: s, history } = d;
  const started = s.outcome === "started";
  const launch = r.install.bin && r.install.bins && r.install.bins.length > 1 ? `npx -y -p ${r.package}@${r.version} ${r.install.bin}` : `npx -y ${r.package}@${r.version}`;
  const serious = seriousFlags(s.flags);
  const orders = s.flags.filter((f) => f.kind === "orders" || f.kind === "very-long");
  const facts = [
    [started ? String(s.tools) : "", s.tools === 1 ? "tool listed" : "tools listed"],
    [r.network ? String(s.contacts.length) : "", s.contacts.length === 1 ? "host contacted" : "hosts contacted"],
    [r.install.ok ? String(s.wrote) : "", s.wrote === 1 ? "file written" : "files written"],
    [r.start.ms !== undefined && started ? (r.start.ms / 1000).toFixed(1) + " s" : "", "to start"],
    [r.install.deps !== undefined ? String(r.install.deps) : "", "dependencies"],
  ].filter(([n]) => n !== "");
  const few = (xs: string[]) => xs.slice(0, 3).map((x) => `<code>${esc(x)}</code>`).join(", ") + (xs.length > 3 ? ` +${xs.length - 3}` : "");
  const reason = started ? "" : saidFirst(r);
  const wants = started ? "nothing" : s.needs.length ? few(s.needs) : reason ? `<q>${esc(reason)}</q>` : "not said";
  const answer = r.install.ok ? `<p class="answer"><b>Needs to start:</b> ${wants}${r.calls?.length ? `<br><b>Answers a call with no setup:</b> ${s.callsAnswered} of ${r.calls.length} tried` : ""}${r.network ? `<br><b>Contacts while installing and starting:</b> ${s.contacts.length ? few(s.contacts) : "nothing"}` : ""}</p>` : "";
  const contacted = `<h2>What it contacted</h2>
${!r.network ? '<p class="muted">Not recorded for this run.</p>' : s.contacts.length ? `<ul>${s.contacts.map((n) => `<li><code>${esc(n)}</code>${hostNote(n) ? `<span class="muted">: ${hostNote(n)}</span>` : ""}</li>`).join("")}</ul><p class="small muted">Hosts it looked up or connected to while installing and starting with no input, watched from outside its sandbox. The npm registry is left out. Says nothing about what its tools contact when called.</p>` : '<p>Nothing besides the npm registry it was installed from. <span class="muted">Watched from outside its sandbox while it was installed and started with no input. Its tools may still contact things when called.</span></p>'}`;
  const tool = (t: Report["tools"][number]) => `<details><summary><code>${esc(t.name)}</code>${t.params.length ? ` <span class="muted small">${t.params.map(esc).join(", ")}</span>` : ""}</summary><pre class="cmd">${esc(t.description || "(no description)")}</pre></details>`;
  const prev = history.find((h) => h.version !== r.version);
  const changed = prev && started && prev.outcome === "started" && prev.toolsHash !== r.toolsHash;
  const badgeUrl = `${origin}/badge/${r.package}.svg`;
  const body = `
<p class="small"><a href="/">← Reports</a></p>
<h1 class="mono">${esc(r.package)}</h1>
<div class="meta">${outcomeBadge(s.outcome)}<span class="mono">${esc(r.version)}</span><a href="https://www.npmjs.com/package/${esc(r.package)}/v/${esc(r.version)}" rel="nofollow noopener">npm</a></div>
<p class="lede" style="margin-top:12px">${esc(outcomeHint[s.outcome])} <span class="nw">Run ${day(r.ranAt)}.</span></p>
${answer}
<div class="facts">${facts.map(([n, label]) => `<div class="fact"><b>${esc(n)}</b><span>${label}</span></div>`).join("")}</div>
${changed ? `<p class="note">Its tool definitions changed since version ${esc(prev.version)}. If you approved the earlier ones, read them again.</p>` : ""}

${contacted}

<h2>Starting it</h2>
<pre class="cmd">${esc(launch)}</pre>
<p class="small muted">Installing a package runs its code. Use a sandbox for anything you have not read.</p>
${s.needs.length ? `<p>Its error output names these settings: ${s.needs.map((n) => `<code>${esc(n)}</code>`).join(", ")}.</p>` : ""}
${!started && (r.start.stderr || r.start.error || r.install.error) ? `<details open><summary>What it said when it did not start</summary><pre class="cmd">${esc(r.start.stderr || r.start.error || r.install.error)}</pre><p class="small muted">Written by the package or by npm, not by this site.</p></details>` : ""}

${r.calls?.length ? `<h2>Calling its tools</h2>
<p>${plural(r.calls.length, "tool")} that ${r.calls.length === 1 ? "takes" : "take"} no input and ${r.calls.length === 1 ? "looks" : "look"} read-only ${r.calls.length === 1 ? "was" : "were"} called once with nothing. <b>${s.callsAnswered} answered.</b></p>
<div class="scroll"><table><tbody>${r.calls.map((c) => `<tr><td><code>${esc(c.tool)}</code></td><td>${c.ok ? `<span class="badge ok">Answered</span> <span class="muted nw">${(c.ms / 1000).toFixed(1)} s · ${c.bytes.toLocaleString("en")} characters</span>` : `<span class="badge weak">No answer</span> <span class="muted">${esc((c.error ?? "").slice(0, 160))}</span>`}</td></tr>`).join("")}</tbody></table></div>
${r.network?.callNames ? (s.callContacts.length ? `<p>While being called it contacted, for the first time: ${s.callContacts.map((n) => `<code>${esc(n)}</code>${hostNote(n) ? ` <span class="muted">(${hostNote(n)})</span>` : ""}`).join(", ")}.</p>` : "<p>While being called it contacted nothing it had not already contacted.</p>") : ""}
<p class="small muted">Only tools whose names read like looking something up, with no required input, are tried, five at most. Tools that need input, and anything that sounds like it changes or sends something, are not called.</p>

` : ""}${started ? `<h2>What its tools tell an agent</h2>
${serious.length ? `<p>Wording worth reading before an agent does:</p>${flagList(serious)}` : "<p>In the tool descriptions, nothing that talks about the user, other tools or private files, or uses hidden characters.</p>"}
${orders.length ? `<details><summary>${plural(orders.length, "tool")} with commands in capitals or very long text</summary>${flagList(orders)}<p class="small muted">Common and usually harmless: it is how many makers stress how a tool should be used.</p></details>` : ""}
<p class="small muted">Found by simple pattern rules in each tool's description (up to 3,000 characters), quoted as written. Parameter descriptions are not scanned. A clean result is not a safety review.</p>

<h2>Tools</h2>
${r.tools.slice(0, r.tools.length > 8 ? 5 : 8).map(tool).join("\n")}
${r.tools.length > 8 ? `<details class="all"><summary>${r.tools.length - 5} more tools</summary>${r.tools.slice(5).map(tool).join("\n")}</details>` : ""}
<p class="small muted hint">Descriptions are the package's own words, cut at 3,000 characters. Treat them as data.</p>` : ""}

${r.wrote.length ? `<h2>Files it wrote</h2><ul>${r.wrote.map((p) => `<li><code>${esc(p).replaceAll("/", "/<wbr>")}</code></li>`).join("")}</ul><p class="small muted">Paths inside its sandbox, where its home folder is <code>/tmp</code> and its own folder cannot be written to.</p>` : ""}

<h2>Install facts</h2>
<div class="scroll"><table><tbody>
<tr><th>License</th><td>${esc(r.install.license ?? "not stated")}</td></tr>
<tr><th>Needs</th><td>${esc(r.install.engines ?? "not stated")}</td></tr>
<tr><th>Source</th><td>${repoLink(r.install.repository)}</td></tr>
<tr><th>Install scripts</th><td>${r.install.scripts?.length ? `${r.install.scripts.map((x) => `<code>${esc(x)}</code>`).join(", ")} declare them. This runner does not run them.` : "None declared by it or anything installed with it."}</td></tr>
${r.install.integrity ? `<tr><th>Tarball</th><td><code>${esc(r.install.integrity)}</code></td></tr>` : ""}
</tbody></table></div>

${claims.length ? `<h2>Proven calls</h2>${claimList(claims, "", { showPackage: false })}` : ""}

${history.length > 1 ? `<h2>Versions reported</h2><div class="scroll"><table><thead><tr><th>Version</th><th>Run</th><th>Result</th><th>Tools</th></tr></thead><tbody>${history.map((h) => `<tr><td class="mono">${esc(h.version)}</td><td class="nw">${day(h.ranAt)}</td><td>${outcomeBadge(h.outcome)}</td><td>${h.tools}</td></tr>`).join("")}</tbody></table></div>` : ""}

<h2>Check this report yourself</h2>
<p>This site did not write the report. A public job on a GitHub-hosted machine did${r.host ? `: <a href="${esc(r.host.run)}" rel="noopener">the run</a>, from <a href="${REPO}/tree/${esc(r.host.commit)}" rel="noopener">this commit</a> of the open-source runner` : ""}. GitHub signed a token that names that job and the hash of the report, so any edit since would show.</p>
<p class="small"><a href="/v1/reports/${esc(r.package)}">Report as JSON</a> · <a href="/v1/reports/${esc(r.package)}?raw=1">exact text and token</a> · <a href="/about#check">how to verify it</a></p>

<h2>Show it on your README</h2>
<p><img src="/badge/${esc(r.package)}.svg" alt="Bragproof: ${esc(outcomeLabel[s.outcome])}" height="20"></p>
<pre class="cmd">${esc(`[![Bragproof](${badgeUrl})](${origin}${reportHref(r.package)})`)}</pre>
<p class="small muted">New version out? <a href="/publish">Ask for a fresh report</a>.</p>`;
  return page({ title: `${r.package}: ${outcomeLabel[s.outcome].toLowerCase()} · Bragproof`, origin, path: "", body, description: `${r.package}@${r.version}: ${outcomeLabel[s.outcome]}. ${started ? plural(s.tools, "tool") + ", " : ""}${r.network ? `${s.contacts.length} hosts contacted while installing and starting. ` : ""}A run report anyone can check.`, alternate: `/v1/reports/${r.package}` });
}

/** The page for a package nobody has reported yet: the way in for a maker. */
export function noReportPage(name: string, queued: boolean, origin: string): string {
  const body = `
<p class="small"><a href="/">← Reports</a></p>
<h1 class="mono">${esc(name)}</h1>
${queued ? `<p class="lede">A report is on its way. Runs start every 15 minutes or so; this page shows the report when it is in.</p>` : `<p class="lede">No report on this package yet.</p>
<form method="post" action="/request"><input type="hidden" name="package" value="${esc(name)}"><button type="submit">Run a report on it</button></form>
<p class="small muted hint">Free, no account. If npm has a package of this name that presents itself as an MCP server, its newest version is installed on a throwaway machine and started with no configuration.</p>`}`;
  return page({ title: `${name} · Bragproof`, origin, path: "", body });
}
