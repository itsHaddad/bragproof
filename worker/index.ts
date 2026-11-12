import { feedHandler } from "../src/feed/server.ts";
import { FeedService } from "../src/feed/service.ts";
import { FeedStore } from "../src/feed/store.ts";
import { type D1, d1Executor } from "./d1.ts";

/** The public feed as a Cloudflare Worker. Only proven receipts are kept: unproven ones cost nothing to make. */
type Env = { DB: D1; PUBLIC_ORIGIN?: string };

let handler: ReturnType<typeof feedHandler> | null = null;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    handler ??= feedHandler(new FeedService(new FeedStore(d1Executor(env.DB)), { selfReportedCap: 0 }), { publicOrigin: env.PUBLIC_ORIGIN });
    // Cloudflare sets this header itself; a client cannot forge it on a request that reaches the Worker.
    const sender = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (req.method === "POST" && !(Number(req.headers.get("content-length") ?? "x") <= 100_000)) return Response.json({ error: "body too large, or its length was not stated" }, { status: 413 });
    try {
      return await handler(req, sender);
    } catch {
      return Response.json({ error: "the feed could not answer this request" }, { status: 500 });
    }
  },
};
