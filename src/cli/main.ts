#!/usr/bin/env bun
import { runCheck } from "../check/run.ts";
import { FeedDb } from "../feed/db.ts";
import { feedHandler } from "../feed/server.ts";
import { FeedService } from "../feed/service.ts";
import { defaultPolicy, makeReceipt, verifyReceipt } from "../receipt/receipt.ts";
import type { CheckSpec } from "../receipt/types.ts";

const HELP = `claimcheck: claims that carry their own proof

  claimcheck run <spec.json> [--out receipt.json] [--post <feed-url>]
      Install the subject, run the check, write a receipt. Inside a confidential VM the receipt is attested.
  claimcheck verify <receipt.json | feed-url/v1/posts/id> [--runner sha256:...]
      Check a receipt yourself. Exit 0: holds and the check passed. 1: the check failed. 2: do not believe it.
  claimcheck post <receipt.json> --feed <feed-url>
  claimcheck search <words...> --feed <feed-url> [--any]
  claimcheck new --feed <feed-url> [--cursor N]
  claimcheck serve [--port 8799] [--db feed.db] [--origin https://...]

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

async function postReceipt(feed: string, receipt: unknown) {
  const res = await fetch(feed.replace(/\/$/, "") + "/v1/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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
    if (fromEnv && !rest[0]) console.log("CLAIMCHECK-RECEIPT:" + Buffer.from(JSON.stringify(receipt)).toString("base64"));
    else if (!out) console.log(JSON.stringify(receipt, null, 2));
    const feed = flag(flags, "post") ?? process.env.FEED_URL;
    if (feed) {
      const posted = await postReceipt(feed, receipt);
      console.error(`posted to ${feed}: ${posted.status} ${JSON.stringify(posted.body)}`);
    }
    console.error(`check ${result.pass ? "passed" : "failed"}; evidence: ${receipt.evidence.kind}`);
    return result.pass ? 0 : 1;
  }

  if (cmd === "verify") {
    const receipt = await readJson(need(rest[0], "verify needs a receipt file or URL"));
    const policy = defaultPolicy();
    const extra = flag(flags, "runner");
    if (extra) policy.runnerDigests.push(extra);
    const verdict = await verifyReceipt(receipt, policy);
    console.log(JSON.stringify(verdict, null, 2));
    return !verdict.ok ? 2 : verdict.pass ? 0 : 1;
  }

  if (cmd === "post") {
    const posted = await postReceipt(need(flag(flags, "feed"), "post needs --feed"), await readJson(need(rest[0], "post needs a receipt file")));
    console.log(JSON.stringify(posted.body, null, 2));
    return posted.status < 300 ? 0 : 2;
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
    const feed = new FeedService(new FeedDb(flag(flags, "db") ?? "feed.db"));
    const handle = feedHandler(feed, { publicOrigin: flag(flags, "origin") });
    const server = Bun.serve({ port, fetch: (req, srv) => handle(req, srv.requestIP(req)?.address) });
    console.error(`claimcheck feed on http://localhost:${server.port}`);
    return await new Promise<number>(() => {});
  }

  console.log(HELP);
  return cmd ? 64 : 0;
}

process.exit(await main());
