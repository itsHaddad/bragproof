import { validPackage } from "../../report/types.ts";
import type { ReportRow, State } from "../reports.ts";
import { esc, page, plural } from "./layout.ts";
import { reportHref, reportList } from "./report.ts";

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) + "%" : "–");
export const startedOf = (s: State) => s.outcomes.find((o) => o.outcome === "started")?.n ?? 0;

/** The form a maker (or anyone) uses to get a package reported. Plain HTML, no script. */
export const askForm = (value = "", label = "Run a report") => `<form class="search" method="post" action="/request">
<input type="text" name="package" value="${esc(value)}" placeholder="npm package name, e.g. @you/your-mcp-server" aria-label="npm package name" autocapitalize="off" autocomplete="off" spellcheck="false" required>
<button type="submit">${label}</button>
</form>`;

export function homePage(o: { origin: string; rows: ReportRow[]; state: State; q: string; filter: string }): string {
  const filtered = !!(o.q || o.filter);
  const started = startedOf(o.state);
  const exact = validPackage(o.q) && !o.rows.some((r) => r.package === o.q) ? o.q : "";
  const intro = filtered
    ? ""
    : `
<h1>Know what an MCP server does before you run it.</h1>
<p class="lede">Bragproof installs each server on a throwaway machine, starts it with nothing, and publishes what happened: whether it starts, what it asks for, what it contacts, and what its tools tell an agent. Every report can be checked against the public run that made it.</p>
<div class="facts">
<div class="fact"><b>${o.state.total}</b><span>servers reported</span></div>
<div class="fact"><b>${pct(started, o.state.total)}</b><span>start with no setup</span></div>
<div class="fact"><b>${o.state.contacting}</b><span>contact something just by starting</span></div>
<div class="fact"><b>${o.state.serious}</b><span>have wording worth reading</span></div>
</div>
<p class="small"><a href="/state">The state of MCP servers, in numbers</a> · <a href="#listed">Made one? Get it listed</a></p>`;
  const chips = [["", "All"], ["started", "Start with no setup"], ["needs-setup", "Need setup"], ["contacts", "Contact something"]] as const;
  const heading = filtered ? `${o.rows.length >= 60 ? "First 60 reports" : plural(o.rows.length, "report")}${o.q ? ` matching "${esc(o.q)}"` : ""} <a class="small" href="/">clear</a>` : "Latest reports";
  const body = `${intro}
<form class="search" method="get" action="/#results" role="search">
<input type="search" name="q" value="${esc(o.q)}" placeholder="a package name, or what you need: sqlite, time zone, diagrams" aria-label="Search reports">
<button type="submit">Search</button>
</form>
<div class="chips" aria-label="Filter">${chips.map(([v, label]) => `<a class="chip" href="/?${o.q ? "q=" + encodeURIComponent(o.q) + "&" : ""}show=${v}#results"${o.filter === v ? ' aria-current="true"' : ""}>${label}</a>`).join("")}</div>
<h2 id="results">${heading}</h2>
${reportList(o.rows, filtered ? "No report matches that." : "No reports yet.")}
${exact ? `<div class="card" style="margin-top:12px"><h3>No report on <span class="mono">${esc(exact)}</span> yet</h3><p class="muted">If npm has it, a report can be run now. <a href="${reportHref(exact)}">Open its page</a></p></div>` : ""}
${filtered ? "" : `
<h2 id="listed">Made one? Get it listed.</h2>
<p>Type your package's name. No post to write, no account, no pull request. In a few minutes it has a report, a page agents can find, and a badge for your README that says it starts.</p>
${askForm()}
<p class="small muted">Agents: <code>POST ${esc(o.origin)}/v1/requests</code> with <code>{"package":"name"}</code>, or the <code>request_report</code> tool at <code>${esc(o.origin)}/mcp</code>. <a href="/publish">More</a></p>`}`;
  return page({ title: "Bragproof: know what an MCP server does before you run it", origin: o.origin, path: "/", body, alternate: "/v1/reports" });
}
