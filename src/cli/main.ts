#!/usr/bin/env bun
import { probeSubject, runCheck } from "../check/run.ts";
import { FeedDb } from "../feed/db.ts";
import { feedHandler } from "../feed/server.ts";
import { FeedService } from "../feed/service.ts";
import { defaultPolicy, makeReceipt, rank, verifyReceipt } from "../receipt/receipt.ts";
import type { CheckSpec } from "../receipt/types.ts";

const HELP = `bragproof: claims that carry their own proof

  bragproof run <spec.json> [--out receipt.json] [--post <feed-url>]
      Install the subject, run the check, write a receipt. Inside a confidential VM the receipt is attested.
  bragproof verify <receipt.json | feed-url/v1/posts/id> [--runner sha256:...] [--accept-self-reported]
      Check a receipt yourself. Exit 0: proven (witnessed or attested) and the check passed. 1: the check
      failed. 2: do not believe it. 3: weaker proof than asked for. --require attested asks for hardware
      evidence; --accept-self-reported accepts none at all.
  bragproof probe <package>@<version> [--bin name]
      Install a package and list its tools, without calling any.
  bragproof post <receipt.json> --feed <feed-url>
  bragproof search <words...> --feed <feed-url> [--any]
  bragproof new --feed <feed-url> [--cursor N]
  bragproof serve [--port 8799] [--db feed.db] [--origin https://...] [--self-reported-cap N]
      --self-reported-cap: how many unproven receipts to keep (default 1000; 0 for a public feed).

  In a runner container: CHECK_SPEC_B64 holds the spec, FEED_URL (optional) is where the receipt is posted.`;

function parse(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

const flag = (flags: Record<string, string | true>, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    console.error(what + "\n\n" + HELP);
    process.exit(64);
  }
  return value;
}

async function readJson(source: string): Promise<unknown> {
  if (/^https?:\/\//.test(source)) return (await fetch(source)).json();
  return Bun.file(source).json();
}

/** Posts a receipt to a feed. Never throws: a feed that is down must not change what the check found. */
async function postReceipt(feed: string, receipt: unknown): Promise<{ status: number; body: string }> {
  if (!/^https:\/\//.test(feed) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(feed)) return { status: 0, body: "the feed address must be https" };
  try {
    const res = await fetch(feed.replace(/\/$/, "") + "/v1/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt), signal: AbortSignal.timeout(20_000), redirect: "error" });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  } catch (e) {
    return { status: 0, body: "the feed did not answer: " + String((e as Error).message).slice(0, 200) };
  }
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parse(argv);

  if (cmd === "run") {
    const fromEnv = process.env.CHECK_SPEC_B64;
    const spec = (rest[0] ? await readJson(rest[0]) : fromEnv ? JSON.parse(Buffer.from(fromEnv, "base64").toString("utf8")) : need(undefined, "run needs a spec file")) as CheckSpec;
    const result = await runCheck(spec);
    const receipt = await makeReceipt(spec, result);
    const out = flag(flags, "out");
    if (out) await Bun.write(out, JSON.stringify(receipt, null, 2) + "\n");
    // One marked line, so a receipt can be recovered from a machine's log when that is the only way out.
    if (fromEnv && !rest[0]) console.log("BRAGPROOF-RECEIPT:" + Buffer.from(JSON.stringify(receipt)).toString("base64"));
    else if (!out) console.log(JSON.stringify(receipt, null, 2));
    const feed = flag(flags, "post") ?? process.env.FEED_URL;
    if (feed) {
      const posted = await postReceipt(feed, receipt);
      console.error(`posted to ${feed}: ${posted.status} ${posted.body}`);
    }
    console.error(`check ${result.pass ? "passed" : "failed"}; evidence: ${receipt.evidence.kind}`);
    // In a job that exists to produce a proven receipt, an unproven one is a failed job.
    if (process.env.BRAGPROOF_REQUIRE_EVIDENCE && receipt.evidence.kind === "none") return 4;
    return result.pass ? 0 : 1;
  }

  if (cmd === "verify") {
    const receipt = await readJson(need(rest[0], "verify needs a receipt file or URL"));
    const policy = defaultPolicy();
    const extra = flag(flags, "runner");
    if (extra) policy.runnerDigests.push(extra);
    const verdict = await verifyReceipt(receipt, policy);
    console.log(JSON.stringify(verdict, null, 2));
    if (!verdict.ok) return 2;
    if (!verdict.pass) return 1;
    // A mistyped or contradictory floor must stop the command, not quietly lower the bar.
    const require = flags.require;
    if (require !== undefined && require !== "attested" && require !== "witnessed") need(undefined, "--require takes attested or witnessed");
    if (require !== undefined && flags["accept-self-reported"]) need(undefined, "--require and --accept-self-reported contradict each other");
    const floor = flags["accept-self-reported"] ? 0 : require === "attested" ? 2 : 1;
    return rank(verdict.level) >= floor ? 0 : 3;
  }

  if (cmd === "probe") {
    // Lists a package's tools without calling any: the starting point for writing a spec.
    const m = need(rest[0], "probe needs <package>@<version>").match(/^((?:@[^@/]+\/)?[^@/]+)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
    if (!m) return need(undefined, "probe needs <package>@<exact version>");
    try {
      console.log("BRAGPROOF-PROBE:" + JSON.stringify({ package: m[1], version: m[2], ok: true, ...(await probeSubject({ kind: "mcp-stdio", name: m[1]!, package: m[1]!, version: m[2]!, bin: flag(flags, "bin") })) }));
    } catch (e) {
      console.log("BRAGPROOF-PROBE:" + JSON.stringify({ package: m[1], version: m[2], ok: false, error: String((e as Error).message).slice(0, 300) }));
    }
    return 0;
  }

  if (cmd === "post") {
    const posted = await postReceipt(need(flag(flags, "feed"), "post needs --feed"), await readJson(need(rest[0], "post needs a receipt file")));
    console.log(posted.body);
    return posted.status >= 200 && posted.status < 300 ? 0 : 2;
  }

  if (cmd === "search" || cmd === "new") {
    const feed = need(flag(flags, "feed"), cmd + " needs --feed").replace(/\/$/, "");
    const params = new URLSearchParams();
    if (rest.length) params.set("q", rest.join(" "));
    if (flags.any) {
      params.set("level", "any");
      params.set("pass", "any");
    }
    if (cmd === "new") params.set("after", flag(flags, "cursor") ?? "0");
    console.log(JSON.stringify(await (await fetch(`${feed}/v1/posts?${params}`)).json(), null, 2));
    return 0;
  }

  if (cmd === "serve") {
    const port = Number(flag(flags, "port") ?? process.env.PORT ?? 8799);
    const cap = flag(flags, "self-reported-cap");
    const feed = new FeedService(new FeedDb(flag(flags, "db") ?? "feed.db"), { selfReportedCap: cap !== undefined && /^\d+$/.test(cap) ? Number(cap) : undefined });
    const handle = feedHandler(feed, { publicOrigin: flag(flags, "origin") });
    const server = Bun.serve({
      port,
      maxRequestBodySize: 100_000,
      development: false,
      fetch: (req, srv) => handle(req, srv.requestIP(req)?.address),
      error: () => Response.json({ error: "the feed could not answer this request" }, { status: 500 }),
    });
    console.error(`bragproof feed on http://localhost:${server.port}`);
    return await new Promise<number>(() => {});
  }

  console.log(HELP);
  return cmd ? 64 : 0;
}

process.exit(await main());
