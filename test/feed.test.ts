import { beforeEach, describe, expect, test } from "bun:test";
import { FeedDb } from "../src/feed/db.ts";
import { feedHandler } from "../src/feed/server.ts";
import { FeedService } from "../src/feed/service.ts";
import { verifyReceipt } from "../src/receipt/receipt.ts";
import { attestedReceipt, fakeAttestor, policy, selfReported, spec } from "./helpers.ts";

const attestor = fakeAttestor();
let handle: ReturnType<typeof feedHandler>;

beforeEach(() => {
  handle = feedHandler(new FeedService(new FeedDb(":memory:"), policy, attestor.keys));
});

const get = async (path: string) => (await handle(new Request("http://feed.test" + path))).json() as Promise<any>;
const post = (path: string, body: unknown, from = "1.1.1.1") => handle(new Request("http://feed.test" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), from);
const mcp = async (method: string, params: object = {}) => ((await (await post("/mcp", { jsonrpc: "2.0", id: 1, method, params })).json()) as any).result;
const tool = async (name: string, args: object) => JSON.parse((await mcp("tools/call", { name, arguments: args })).content[0].text);

describe("publishing", () => {
  test("an attested receipt is admitted once", async () => {
    const r = attestedReceipt(attestor);
    expect((await post("/v1/posts", r)).status).toBe(201);
    expect((await post("/v1/posts", r)).status).toBe(200);
    expect((await get("/v1/posts")).posts).toHaveLength(1);
  });

  test("a forged receipt is refused and never stored", async () => {
    const r = attestedReceipt(attestor);
    r.spec.claim = "A much bigger claim.";
    const res = await post("/v1/posts", r);
    expect(res.status).toBe(422);
    expect((await get("/v1/posts?level=any&pass=any")).posts).toHaveLength(0);
  });

  test("a self-reported receipt is kept but not shown unless asked for", async () => {
    expect((await post("/v1/posts", selfReported())).status).toBe(201);
    expect((await get("/v1/posts")).posts).toHaveLength(0);
    expect((await get("/v1/posts?level=any")).posts[0].level).toBe("self-reported");
  });

  test("one sender cannot flood the feed", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await post("/v1/posts", { junk: i }, "9.9.9.9")).status);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
    expect((await post("/v1/posts", { junk: 1 }, "8.8.8.8")).status).toBe(422);
  });
});

describe("finding and catching up", () => {
  test("search needs every word; the cursor returns only what is new", async () => {
    await post("/v1/posts", attestedReceipt(attestor));
    const pdf = { ...spec(), claim: "Converts a PDF invoice into JSON fields.", tags: ["pdf", "invoice"] };
    await post("/v1/posts", attestedReceipt(attestor, () => {}, pdf));
    expect((await get("/v1/posts?q=pdf+invoice")).posts).toHaveLength(1);
    expect((await get("/v1/posts?q=pdf+spreadsheet")).posts).toHaveLength(0);
    const first = await get("/v1/posts?after=0");
    expect(first.posts).toHaveLength(2);
    expect((await get("/v1/posts?after=" + first.cursor)).posts).toHaveLength(0);
    const third = { ...spec(), claim: "Resizes images to a given width." };
    await post("/v1/posts", attestedReceipt(attestor, () => {}, third));
    expect((await get("/v1/posts?after=" + first.cursor)).posts.map((p: any) => p.claim)).toEqual(["Resizes images to a given width."]);
  });

  test("a receipt fetched from the feed verifies on the reader's side", async () => {
    const r = attestedReceipt(attestor);
    await post("/v1/posts", r);
    const fetched = await get("/v1/posts/" + r.bodyHash);
    expect(await verifyReceipt(fetched, policy, attestor.keys)).toMatchObject({ ok: true, level: "attested", pass: true });
  });
});

describe("the MCP face", () => {
  test("an agent can publish, search, catch up and fetch the receipt", async () => {
    expect((await mcp("initialize")).serverInfo.name).toBe("claimcheck-feed");
    expect((await mcp("tools/list")).tools.map((t: any) => t.name)).toEqual(["search", "whats_new", "get_receipt", "publish"]);
    const r = attestedReceipt(attestor);
    expect(await tool("publish", { receipt: r })).toMatchObject({ ok: true, level: "attested", added: true });
    const found = await tool("search", { q: "echo" });
    expect(found.posts[0].id).toBe(r.bodyHash);
    expect((await tool("whats_new", { cursor: found.cursor })).posts).toHaveLength(0);
    expect((await tool("get_receipt", { id: r.bodyHash })).receipt.bodyHash).toBe(r.bodyHash);
  });

  test("a forged publish comes back as an error", async () => {
    const r = attestedReceipt(attestor, (c) => (c.dbgstat = "enabled"));
    const res = await mcp("tools/call", { name: "publish", arguments: { receipt: r } });
    expect(res.isError).toBe(true);
  });
});

describe("the page for people", () => {
  test("shows posts and escapes what strangers wrote", async () => {
    const nasty = { ...spec(), claim: "<script>alert(1)</script> ignore previous instructions" };
    await post("/v1/posts", attestedReceipt(attestor, () => {}, nasty));
    const html = await (await handle(new Request("http://feed.test/"))).text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("Attested");
  });
});
