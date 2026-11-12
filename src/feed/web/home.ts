import type { ClaimRow } from "../sql.ts";
import type { Stats } from "../store.ts";
import { claimList } from "./cards.ts";
import { esc, page, plural } from "./layout.ts";

/** The older part of the site: claims a maker chose, each proven by a receipt. */
export function claimsPage(o: { origin: string; claims: ClaimRow[]; stats: Stats; tags: { tag: string; n: number }[]; q: string; tag: string; all: boolean }): string {
  const validTag = /^[a-z0-9][a-z0-9-]{0,31}$/.test(o.tag);
  const filtered = !!(o.q || o.tag);
  const chip = (t: { tag: string; n: number }) => `<a class="chip" href="/claims?tag=${encodeURIComponent(t.tag)}#results"${o.tag === t.tag ? ' aria-current="true"' : ""}>${esc(t.tag)} <span class="muted">${t.n}</span></a>`;
  const first = o.tags.slice(0, 8);
  const rest = o.tags.slice(8);
  const intro = filtered
    ? ""
    : `
<h1>Proven calls</h1>
<p class="lede">Beyond a run report, a maker can state a claim about what a tool does, give the exact calls that show it, and have them run on a machine they cannot tamper with. Each listing here is one such claim with its receipt.</p>
<p><a class="button quiet" href="/publish#claims">Add a proven call</a></p>
<p class="small muted">${plural(o.stats.claims, "proven claim")} about ${plural(o.stats.packages, "package")} so far. Most are checks of well-known packages, run to start the feed. Every receipt was verified before it was listed.</p>`;
  const heading = o.all ? "Everything this feed holds" : filtered ? `${o.claims.length >= 60 ? "First 60 claims" : plural(o.claims.length, "claim")}${o.q ? ` matching "${esc(o.q)}"` : ""}${validTag ? ` tagged ${esc(o.tag)}` : ""} <a class="small" href="/claims">clear</a>` : "Recently proven";
  const body = `${intro}
<form class="search" method="get" action="/claims#results" role="search">
<input type="search" name="q" value="${esc(o.q)}" placeholder="e.g. distance between two points" aria-label="Search proven claims">
<button type="submit">Search</button>
</form>
<div class="chips" aria-label="Tags">${first.map(chip).join("")}</div>
${rest.length ? `<details class="tags"${rest.some((t) => t.tag === o.tag) ? " open" : ""}><summary>All ${o.tags.length} tags</summary><div class="chips">${rest.map(chip).join("")}</div></details>` : ""}
<h2 id="results">${heading}</h2>
${claimList(o.claims, filtered ? "Nothing proven matches that yet. If you made it, you can be the first to list it." : "Nothing has been proven here yet.")}
${filtered && !o.claims.length ? '<p style="margin-top:12px"><a class="button" href="/publish">Get your thing listed</a></p>' : ""}
<p class="small muted" style="margin-top:16px">${o.all ? 'Showing everything this feed holds, including self-reported receipts. <a href="/claims">Show only proven claims</a>' : 'Showing claims with at least one passing run that is witnessed or attested. <a href="/claims?show=all">Include self-reported receipts</a>'}</p>`;
  return page({ title: "Proven calls · Bragproof", origin: o.origin, path: "/claims", body, alternate: "/v1/claims" });
}
