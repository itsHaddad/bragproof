import type { Level } from "../receipt/receipt.ts";
import { handleMcp } from "./mcp.ts";
import { llmsTxt, renderPage } from "./page.ts";
import type { FeedService } from "./service.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "access-control-allow-origin": "*" } });

/** A small per-address limit on writes, so one sender cannot flood the feed. */
function limiter(perMinute: number) {
  const seen = new Map<string, { at: number; n: number }>();
  return (who: string) => {
    const now = Date.now();
    const s = seen.get(who);
    if (!s || now - s.at > 60_000) {
      seen.set(who, { at: now, n: 1 });
      if (seen.size > 10_000) seen.clear();
      return true;
    }
    return ++s.n <= perMinute;
  };
}

export function feedHandler(feed: FeedService, opts: { publicOrigin?: string } = {}) {
  const allowWrite = limiter(20);
  return async (req: Request, clientAddress = "unknown"): Promise<Response> => {
    const url = new URL(req.url);
    const origin = opts.publicOrigin ?? url.origin;
    const path = url.pathname;
    const isWrite = req.method === "POST";
    if (isWrite && Number(req.headers.get("content-length") ?? 0) > 100_000) return json({ error: "body too large" }, 413);
    if (isWrite && !allowWrite(clientAddress)) return json({ error: "too many requests, try again in a minute" }, 429);

    if (path === "/mcp" && req.method === "POST") return handleMcp(feed, req);
    if (path === "/v1/posts" && req.method === "GET") {
      const p = url.searchParams;
      const level = p.get("level");
      const after = p.get("after");
      return json(
        feed.search({
          q: p.get("q") ?? undefined,
          level: level === "any" || level === "attested" || level === "self-reported" ? (level as Level | "any") : undefined,
          pass: p.get("pass") === "any" ? "any" : true,
          after: after !== null && /^\d+$/.test(after) ? Number(after) : undefined,
          limit: Number(p.get("limit")) || undefined,
        }),
      );
    }
    if (path === "/v1/posts" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "body is not JSON" }, 400);
      }
      const out = await feed.publish(body);
      return out.ok ? json(out, out.added ? 201 : 200) : json({ error: out.reason }, 422);
    }
    const one = path.match(/^\/v1\/posts\/([0-9a-f]{64})$/);
    if (one && req.method === "GET") {
      const receipt = feed.receipt(one[1]!);
      return receipt ? json(receipt) : json({ error: "no post with this id" }, 404);
    }
    if (path === "/llms.txt") return new Response(llmsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (path === "/" && req.method === "GET")
      return new Response(renderPage(feed.search({ level: "any", pass: "any", limit: 50 }).posts, origin), {
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" },
      });
    return json({ error: "not found" }, 404);
  };
}
