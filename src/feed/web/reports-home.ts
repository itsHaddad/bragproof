import { validPackage } from "../../report/types.ts";
import type { ReportRow, State } from "../reports.ts";
import { esc, page, plural } from "./layout.ts";
import { reportHref, reportList } from "./report.ts";

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) + "%" : "–");
export const startedOf = (s: State) => s.outcomes.find((o) => o.outcome === "started")?.n ?? 0;

/** The form a maker (or anyone) uses to get a package reported. Plain HTML, no script. */
export const askForm = (value = "", label = "Run a report") => `<form class="search" method="post" action="/request">
<input type="text" name="package" value="${esc(value)}" placeholder="@you/your-mcp-server" aria-label="npm package name" autocapitalize="off" autocomplete="off" spellcheck="false" required>
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
<p class="lede">We install each MCP server on a throwaway machine, start it with nothing, and publish what happened: does it start, what does it need, what does it contact. Every report links to the public run that made it.</p>
<div class="facts">
<div class="fact"><b>${o.state.total.toLocaleString("en")}</b><span>servers reported</span></div>
<div class="fact"><b>${pct(started, o.state.total)}</b><span>start with no setup</span></div>
<div class="fact"><b>${o.state.contacting}</b><span>contact something just from being installed and started</span></div>
<div class="fact"><b>${o.state.serious}</b><span>have tool text about the user, other tools or private files</span></div>
</div>
<p><a class="button quiet" href="/publish">Made one? Get it listed</a> <a class="small" style="margin-left:8px" href="/state">The numbers in full</a></p>`;
  const chips = [["", "All"], ["started", "Start with no setup"], ["needs-setup", "Need setup"], ["contacts", "Contact something"]] as const;
  const heading = filtered ? `${o.rows.length >= 60 ? "First 60 reports" : plural(o.rows.length, "report")}${o.q ? ` matching "${esc(o.q)}"` : ""} <a class="small" href="/">clear</a>` : "Latest runs";
  const body = `${intro}
<form class="search" method="get" action="/#results" role="search">
<input type="search" name="q" value="${esc(o.q)}" placeholder="sqlite, time zone…" aria-label="Search reports">
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
<p class="small muted">Agents: <code>POST ${esc(o.origin)}/v1/requests</code> with <code>{"package":"name"}</code>, or the <code>request_report</code> tool at <code>${esc(o.origin)}/mcp</code>. <a href="/publish">More</a></p>

<h2>Give your agent the habit</h2>
<p>Add Bragproof as a tool and your agent can look a server up before it runs one, and find servers that start with no setup.</p>
<pre class="cmd">claude mcp add --transport http bragproof ${esc(o.origin)}/mcp</pre>
<p class="small muted">Any client that speaks MCP over HTTP works: the address is <code>${esc(o.origin)}/mcp</code>, no key. Tools: <code>check_package</code>, <code>find_servers</code>, <code>request_report</code>.</p>`}`;
  return page({ title: "Bragproof: know what an MCP server does before you run it", origin: o.origin, path: "/", body, alternate: "/v1/reports" });
}
