import type { CheckSpec } from "../../receipt/types.ts";
import type { ClaimDetail } from "../store.ts";
import { makerHref, packageHref, proofLine } from "./cards.ts";
import { badge, day, esc, levelHint, page } from "./layout.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** The workflow a reader copies to run this same check from their own repository: one more independent proof. */
export const workflowFor = (spec: CheckSpec, origin: string) => `name: prove
on: workflow_dispatch
jobs:
  prove:
    permissions: { id-token: write, contents: read }
    uses: itsHaddad/bragproof/.github/workflows/check.yml@check-v1
    with:
      feed: ${origin}
      spec_b64: ${b64(JSON.stringify(spec))}`;

export function claimPage(d: ClaimDetail, origin: string): string {
  const { claim: c, latest, receipts } = d;
  const s = latest.spec.subject;
  // With a named bin, npx needs the package and the bin separately, as the runner started it.
  const launch = s.bin ? ["npx", "-y", "-p", `${s.package}@${s.version}`, s.bin, ...(s.args ?? [])] : ["npx", "-y", `${s.package}@${s.version}`, ...(s.args ?? [])];
  // The arguments were written by whoever filed the claim. On a line a reader may paste into a shell, anything
  // that is not a plain word is single-quoted, so it stays one argument and nothing in it runs.
  const quoted = launch.map((a) => (/^[A-Za-z0-9@%+=:,./_-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'")).join(" ");
  const steps = latest.spec.steps
    .map((st, i) => {
      const seen = latest.result.steps[i];
      const want = st.expect.equals !== undefined ? ["exactly", st.expect.equals] : st.expect.contains !== undefined ? ["text containing", st.expect.contains] : ["text matching the pattern", st.expect.matches ?? ""];
      return `<details${i === 0 ? " open" : ""}><summary><code>${esc(st.tool)}</code></summary>
<p class="small muted">Called with</p><pre>${esc(JSON.stringify(st.arguments, null, 2))}</pre>
<p class="small muted">Must return ${want[0]}</p><pre>${esc(want[1])}</pre>
<p class="small muted">What it returned in the run of ${day(latest.result.finishedAt)} (first 200 characters, written by the tool, not by this site)</p><pre>${esc(seen?.outputPreview ?? "")}</pre>
</details>`;
    })
    .join("\n");
  const rows = receipts
    .map(
      (r) => `<tr><td class="nw"><a href="/v1/posts/${r.id}" title="The receipt, as JSON">${day(r.admittedAt)}</a></td>
<td><span class="badge ${r.pass ? "ok" : "bad"}">${r.pass ? "Passed" : "Failed"}</span> ${badge(r.level)}</td>
<td class="who">${r.requester ? `<a href="${makerHref(r.requester.split("/")[0]!)}">${esc(r.requester.replace(/^github:/, ""))}</a>` : "unknown"}</td></tr>`,
    )
    .join("\n");
  const network = latest.spec.tags?.includes("needs-network") ? `<p class="note small">This check calls a service on the internet. The receipt shows what that service answered on ${day(c.lastPassAt ?? latest.result.finishedAt)}, not what it will answer you.</p>` : "";
  const body = `
<p class="small"><a href="/">← Feed</a> / <a href="${packageHref(c.package)}">${esc(c.package)}</a></p>
<h1>${esc(c.claim)}</h1>
<div class="meta">${c.best ? badge(c.best) : ""}<span class="mono">${esc(c.package)}@${esc(c.version)}</span>${s.homepage ? `<a href="${esc(s.homepage)}" rel="nofollow noopener">homepage</a>` : ""}<a href="https://www.npmjs.com/package/${esc(c.package)}/v/${esc(c.version)}" rel="nofollow noopener">npm</a></div>
<div class="meta">${proofLine(c)}</div>
${c.best ? `<p class="small muted hint">${esc(levelHint[c.best])} <a href="/about#levels">What the levels mean</a></p>` : ""}
${network}

<h2>Use it</h2>
<p>This is an MCP server (a tool server that AI agents connect to). Start the exact version that was tested:</p>
<pre class="cmd">${esc(quoted)}</pre>
<details><summary>As an MCP client configuration</summary><pre>${esc(JSON.stringify({ mcpServers: { [s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server"]: { command: "npx", args: launch.slice(1) } } }, null, 2))}</pre></details>
<p class="note small">A receipt shows the tool did what the calls below asked. It does not show the tool is safe. Installing a package runs its code, so run it in a sandbox.</p>

<h2>What was proven</h2>
<p class="muted">The exact calls that were made, in order, and what each had to return.</p>
${steps}

<h2>Receipts</h2>
<div class="scroll"><table><thead><tr><th>Receipt</th><th>Result</th><th>Asked for by</th></tr></thead><tbody>
${rows}
</tbody></table></div>

<h2>Check it yourself</h2>
<p>Do not take this site's word. Fetch a receipt and verify it on your own machine. Needs git and Bun.</p>
<pre class="cmd">git clone https://github.com/itsHaddad/bragproof && cd bragproof && bun install
bun src/cli/main.ts verify ${esc(origin)}/v1/posts/${receipts.find((r) => r.pass)?.id ?? receipts[0]?.id ?? ""}</pre>

<h2>Add your own proof</h2>
<p>Run the same check from your own repository. Your run counts as one more account on this page. Save this as <code>.github/workflows/prove.yml</code> in a public GitHub repository, then run it from the repository's Actions tab.</p>
<p><a class="button quiet" href="/c/${c.specHash}/prove.yml" download>Download prove.yml</a></p>
<pre>${esc(workflowFor(latest.spec, origin))}</pre>`;
  return page({ title: `${c.claim} · Bragproof`, description: `${c.claim} (${c.package}@${c.version})`, origin, path: "", body, alternate: `/v1/claims/${c.specHash}` });
}
