import type { ClaimRow } from "../sql.ts";
import { claimList } from "./cards.ts";
import { esc, page, plural } from "./layout.ts";

/** Everything proven about one package, across versions. */
export function packagePage(name: string, claims: ClaimRow[], origin: string): string {
  const versions = [...new Set(claims.map((c) => c.version))];
  const body = `
<p class="small"><a href="/">← Feed</a></p>
<h1 class="mono">${esc(name)}</h1>
<p class="lede">${plural(claims.length, "proven claim")} · ${versions.length === 1 ? "version" : "versions"} ${versions.map(esc).join(", ")} · <a href="https://www.npmjs.com/package/${esc(name)}" rel="nofollow noopener">npm</a></p>
${claimList(claims, "Nothing is proven about this package here yet.", { showPackage: false })}
<h2>Made this, or use it?</h2>
<p>Anyone can add a claim about this package, or run an existing one again from their own repository.</p>
<p><a class="button quiet" href="/publish">Get your thing listed</a></p>`;
  return page({ title: `${name} · Bragproof`, origin, path: "", body, alternate: `/v1/claims?package=${encodeURIComponent(name)}` });
}

/** Every claim one account has asked for a passing check of: the page a maker points people and agents at. */
export function makerPage(requester: string, claims: ClaimRow[], origin: string): string {
  const [kind, who] = [requester.split(":")[0], requester.split(":").slice(1).join(":")];
  const what = kind === "github" ? "GitHub account" : kind === "gcp" ? "Google Cloud project" : "account";
  const body = `
<p class="small"><a href="/">← Feed</a></p>
<h1>Checks asked for by ${esc(requester)}</h1>
<p class="lede">${plural(claims.length, "claim")} with at least one passing run asked for by this ${what}${kind === "github" ? ` (<a href="https://github.com/${esc(who)}" rel="nofollow noopener">github.com/${esc(who)}</a>)` : ""}.</p>
<p class="note small">"Asked for by" is who started the run, as the receipt's evidence names them. It does not say they wrote the thing that was tested: anyone can ask for a check of any package.</p>
${claimList(claims, "No proven claims from this account.")}`;
  return page({ title: `Checks asked for by ${requester} · Bragproof`, origin, path: "", body, alternate: `/v1/claims?requester=${encodeURIComponent(requester)}` });
}

export const notFound = (origin: string) => page({ title: "Not found · Bragproof", origin, path: "", body: `<h1>Nothing here</h1><p>That page does not exist. <a href="/">Back to the feed</a></p>` });
