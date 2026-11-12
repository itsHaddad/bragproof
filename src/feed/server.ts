import type { Level } from "../receipt/receipt.ts";
import { handleMcp } from "./mcp.ts";
import { llmsTxt, renderPage } from "./page.ts";
import type { FeedService } from "./service.ts";

// Reads may be made from any web page; writes carry no such header, so a page cannot use its visitors to post.
const open = { "access-control-allow-origin": "*" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

/** The feed over HTTP. `publicOrigin` is the address the feed is reached at; set it for anything public, or
 * the address in the docs is taken from the request. `clientAddress` is the sender as the caller knows it:
 * behind a proxy, the caller must pass the address its own proxy reported, never a header a client can set. */
export function feedHandler(feed: FeedService, opts: { publicOrigin?: string } = {}) {
  return async (req: Request, clientAddress = "unknown"): Promise<Response> => {
    const url = new URL(req.url);
    const origin = opts.publicOrigin ?? url.origin;
    const path = url.pathname;
    if (req.method === "POST" && Number(req.headers.get("content-length") ?? 0) > 100_000) return json({ error: "body too large" }, 413);

    if (path === "/mcp") return req.method === "POST" ? handleMcp(feed, req, clientAddress) : json({ error: "POST only" }, 405, { allow: "POST" });
    if (path === "/v1/posts" && req.method === "GET") {
      const p = url.searchParams;
      const level = p.get("level");
      const after = p.get("after");
      const limit = p.get("limit");
      return json(
        await feed.search({
          q: p.get("q") ?? undefined,
          level: level === "any" || level === "attested" || level === "witnessed" || level === "self-reported" ? (level as Level | "any") : undefined,
          pass: p.get("pass") === "any" ? "any" : true,
          after: after !== null && /^\d{1,12}$/.test(after) ? Number(after) : undefined,
          limit: limit !== null && /^\d{1,3}$/.test(limit) ? Number(limit) : undefined,
        }),
        200,
        open,
      );
    }
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
    const one = path.match(/^\/v1\/posts\/([0-9a-f]{64})$/);
    if (one && req.method === "GET") {
      const receipt = await feed.receipt(one[1]!);
      return receipt ? json(receipt, 200, open) : json({ error: "no post with this id" }, 404, open);
    }
    if (path === "/llms.txt") return new Response(llmsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (path === "/" && req.method === "GET") {
      const all = url.searchParams.get("show") === "all";
      const posts = (await feed.search(all ? { level: "any", pass: "any", limit: 50 } : { limit: 50 })).posts;
      return new Response(renderPage(posts, origin, all), {
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" },
      });
    }
    return json({ error: "not found" }, 404);
  };
}
