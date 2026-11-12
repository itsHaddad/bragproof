import type { Level } from "../receipt/receipt.ts";
import { handleMcp } from "./mcp.ts";
import type { FeedService } from "./service.ts";
import { claimPage, workflowFor } from "./web/claim.ts";
import { aboutPage, llmsTxt, publishPage } from "./web/guides.ts";
import { homePage } from "./web/home.ts";
import { html } from "./web/layout.ts";
import { makerPage, notFound, packagePage } from "./web/lists.ts";

// Reads may be made from any web page. Writes must say they are JSON, which a web page cannot send to another
// site without that site's permission, so a page cannot use its visitors to post.
const open = { "access-control-allow-origin": "*" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "x-content-type-options": "nosniff", ...headers } });
/** Reads that anyone may cache for a minute: the home page and searches each cost several queries. */
const cached = { ...{ "access-control-allow-origin": "*" }, "cache-control": "public, max-age=60" };

const levelOf = (v: string | null): Level | "any" | undefined => (v === "any" || v === "attested" || v === "witnessed" || v === "self-reported" ? v : undefined);
const numberOf = (v: string | null, digits: number) => (v !== null && new RegExp(`^\\d{1,${digits}}$`).test(v) ? Number(v) : undefined);
const textOf = (v: string | null, max: number) => (v === null ? undefined : v.slice(0, max));
const decoded = (path: string) => {
  try {
    return decodeURIComponent(path).slice(0, 300);
  } catch {
    return "";
  }
};

/** The feed over HTTP: pages for people, REST and MCP for agents. `publicOrigin` is the address the feed is
 * reached at; set it for anything public. `clientAddress` is the sender as the caller knows it: behind a
 * proxy, the caller must pass the address its own proxy reported, never a header a client can set. */
export function feedHandler(feed: FeedService, opts: { publicOrigin?: string } = {}) {
  return async (req: Request, clientAddress = "unknown"): Promise<Response> => {
    const url = new URL(req.url);
    const origin = opts.publicOrigin ?? url.origin;
    const path = url.pathname;
    const p = url.searchParams;
    if (req.method === "POST") {
      if (!(Number(req.headers.get("content-length") ?? 0) <= 100_000)) return json({ error: "body too large" }, 413);
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "send application/json" }, 415);
    }

    if (path === "/mcp") return req.method === "POST" ? handleMcp(feed, req, clientAddress, origin) : json({ error: "POST only" }, 405, { allow: "POST" });

    if (path === "/v1/posts" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "body is not JSON" }, 400);
      }
      const out = await feed.publish(body, clientAddress);
      if (out.ok) return json(out, out.added ? 201 : 200);
      return json({ error: out.reason }, out.reason.startsWith("too many") ? 429 : 422);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "not found" }, 404);

    // ---- REST for agents
    if (path === "/v1/posts") return json(await feed.search({ q: textOf(p.get("q"), 200), level: levelOf(p.get("level")), pass: p.get("pass") === "any" ? "any" : true, after: numberOf(p.get("after"), 12), limit: numberOf(p.get("limit"), 3) }), 200, open);
    const post = path.match(/^\/v1\/posts\/([0-9a-f]{64})$/);
    if (post) {
      const receipt = await feed.receipt(post[1]!);
      return receipt ? json(receipt, 200, open) : json({ error: "no post with this id" }, 404, open);
    }
    if (path === "/v1/claims") return json({ claims: await feed.claims({ q: textOf(p.get("q"), 200), level: levelOf(p.get("level")), tag: textOf(p.get("tag"), 32), package: textOf(p.get("package"), 214), requester: textOf(p.get("requester"), 120), limit: numberOf(p.get("limit"), 3) }) }, 200, cached);
    const one = path.match(/^\/v1\/claims\/([0-9a-f]{64})$/);
    if (one) {
      const detail = await feed.claim(one[1]!);
      return detail ? json(detail, 200, open) : json({ error: "no claim with this id" }, 404, open);
    }
    if (path === "/llms.txt") return new Response(llmsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8" } });

    // ---- pages for people
    if (path === "/") {
      const all = p.get("show") === "all";
      const q = textOf(p.get("q"), 200) ?? "";
      const tag = textOf(p.get("tag"), 32) ?? "";
      const [claims, stats, tags] = await Promise.all([feed.claims({ q, tag: tag || undefined, level: all ? "any" : undefined, limit: 60 }), feed.stats(), feed.tags()]);
      return html(homePage({ origin, claims, stats, tags, q, tag, all }));
    }
    if (path === "/publish") return html(publishPage(origin));
    if (path === "/about") return html(aboutPage(origin));
    const yml = path.match(/^\/c\/([0-9a-f]{64})\/prove\.yml$/);
    if (yml) {
      const detail = await feed.claim(yml[1]!);
      return detail ? new Response(workflowFor(detail.latest.spec, origin) + "\n", { headers: { "content-type": "text/yaml; charset=utf-8", "content-disposition": 'attachment; filename="prove.yml"', "x-content-type-options": "nosniff" } }) : html(notFound(origin), 404);
    }
    const c = path.match(/^\/c\/([0-9a-f]{64})$/);
    if (c) {
      const detail = await feed.claim(c[1]!);
      return detail ? html(claimPage(detail, origin)) : html(notFound(origin), 404);
    }
    if (path.startsWith("/p/")) {
      const name = decoded(path.slice(3));
      const claims = name && name.length <= 214 ? await feed.claims({ package: name, limit: 100 }) : [];
      return claims.length ? html(packagePage(name, claims, origin)) : html(notFound(origin), 404);
    }
    if (path.startsWith("/m/")) {
      const who = decoded(path.slice(3)).toLowerCase();
      const claims = who && who.length <= 120 ? await feed.claims({ requester: who, limit: 100 }) : [];
      return claims.length ? html(makerPage(who, claims, origin)) : html(notFound(origin), 404);
    }
    return path.startsWith("/v1/") ? json({ error: "not found" }, 404) : html(notFound(origin), 404);
  };
}
