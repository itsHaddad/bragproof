#!/usr/bin/env bun
/** The other side: an agent that needs a tool, asks the feed, trusts nothing until it has verified the receipt
 * itself, and then uses the exact package the receipt names.
 *
 *   bun examples/consumer.ts <feed-url> <words...> [--accept-self-reported] */
import { startSubject } from "../src/check/run.ts";
import { verifyReceipt } from "../src/receipt/receipt.ts";
import type { Receipt } from "../src/receipt/types.ts";

const argv = process.argv.slice(2);
const acceptSelf = argv.includes("--accept-self-reported");
const [feed, ...words] = argv.filter((a) => !a.startsWith("--"));
if (!feed || !words.length) {
  console.error("usage: consumer.ts <feed-url> <words...>");
  process.exit(64);
}
const call = async (name: string, args: object) => {
  const res = await fetch(feed + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return JSON.parse(((await res.json()) as any).result.content[0].text);
};

console.log(`1. asking the feed for: ${words.join(" ")}`);
const found = await call("search", { q: words.join(" "), level: acceptSelf ? "any" : "witnessed" });
if (!found.posts.length) {
  console.log("   nothing found");
  process.exit(1);
}
const post = found.posts[0];
console.log(`   found: "${post.claim}" (${post.package}@${post.version}, ${post.level})`);

console.log("2. fetching the receipt and verifying it here, not taking the feed's word");
const receipt = (await call("get_receipt", { id: post.id })).receipt as Receipt;
const verdict = await verifyReceipt(receipt);
console.log("   " + JSON.stringify(verdict).slice(0, 300));
if (!verdict.ok || !verdict.pass || (verdict.level === "self-reported" && !acceptSelf)) {
  console.log("   not good enough to act on; stopping");
  process.exit(2);
}

console.log("3. installing the same package version and comparing its tarball with the receipt's");
const started = await startSubject(receipt.spec.subject);
try {
  if (started.installed.integrity !== receipt.result.subjectIntegrity) {
    console.log("   the package on the registry is not the one in the receipt; stopping");
    process.exit(2);
  }
  console.log("   same tarball: " + started.installed.integrity.slice(0, 24) + "... (its dependencies are resolved afresh and may differ)");
  console.log("4. using it");
  await started.client.initialize();
  const step = receipt.spec.steps[0]!;
  console.log(`   ${step.tool}(${JSON.stringify(step.arguments)}) -> ${JSON.stringify((await started.client.callTool(step.tool, step.arguments)).slice(0, 200))}`);
} finally {
  await started.stop();
}
