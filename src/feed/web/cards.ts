import type { ClaimRow } from "../sql.ts";
import { badge, day, esc, plural } from "./layout.ts";

export const packageHref = (name: string) => "/p/" + name.split("/").map(encodeURIComponent).join("/");
export const makerHref = (requester: string) => "/m/" + requester.split("/").map(encodeURIComponent).join("/");

const nw = (s: string) => `<span class="nw">${s}</span>`;

/** "Proven 3 times · by 2 accounts · last ...": the line that says how much a claim can be leaned on. An
 * account is a GitHub account or a cloud project that asked for a run; it is not a person or an agent. */
export function proofLine(c: ClaimRow): string {
  if (!c.passes) return `<span class="badge bad">No passing run</span> ${nw(plural(c.fails, "failed run"))} ${nw("last " + day(c.lastFailAt))}`;
  const parts = [nw(`Proven ${c.passes === 1 ? "once" : plural(c.passes, "time")}`), nw(`by ${plural(c.requesters, "account")}`), nw(`last ${day(c.lastPassAt)}`)];
  const failed = c.fails ? ` · <span class="badge bad">${plural(c.fails, "failed run")}</span>` : "";
  return parts.join(" · ") + failed;
}

/** A claim as a card. The whole card opens the claim; the package link stays its own target. */
export function claimCard(c: ClaimRow, opts: { showPackage?: boolean } = {}): string {
  const pkg = opts.showPackage === false ? `<span class="mono">@${esc(c.version)}</span>` : `<a class="mono" href="${packageHref(c.package)}">${esc(c.package)}@${esc(c.version)}</a>`;
  return `<article class="card claim">
<h3><a href="/c/${c.specHash}">${esc(c.claim)}</a></h3>
<div class="meta">${c.best ? badge(c.best) : ""}${pkg}</div>
<div class="meta">${proofLine(c)}</div>
</article>`;
}

export const claimList = (claims: ClaimRow[], empty: string, opts: { showPackage?: boolean } = {}) => (claims.length ? `<div class="stack">${claims.map((c) => claimCard(c, opts)).join("\n")}</div>` : `<p class="muted">${esc(empty)}</p>`);
