// The example session shown on the first screen. It is written by hand, not taken from anyone's machine: a small
// shop, a rounding bug, and an agent that gets the tests green the short way. The page labels it as an example.
// It is built into /example-session.jsonl so anyone can run the same file through the page or the command line.

import { bash, edit, type Line, log, read, say, tool, user } from "../core/log-lines.ts";

const grep = (pattern: string): Line[] => tool("Grep", { pattern, path: "/home/dev/shop/src" }, { output: "src/cart/total.ts\nsrc/cart/total.test.ts" });
const SRC = "/home/dev/shop/src";

export function exampleLog(): string {
  const looks: Line[][] = [];
  for (const file of ["cart/total.ts", "cart/total.test.ts", "cart/line.ts", "money/round.ts", "money/currency.ts", "checkout/summary.ts", "checkout/tax.ts"]) looks.push(read(`${SRC}/${file}`, "export const TOTAL = 0;"));
  const moreReads = (files: string[]): Line[][] => files.map((f) => read(`${SRC}/${f}`, "// ..."));
  return log(
    user("The checkout total is a cent off on some carts. Find it and fix it. Tests must pass before you commit.", "bypassPermissions"),
    say("I'll look at how the cart total is rounded."),
    grep("roundTo"),
    grep("toFixed"),
    ...looks,
    bash("git log --oneline -8", { output: "a41c2e9 checkout: tax per line\n7be0d11 cart: totals" }),
    bash("bun test src/cart", { failed: true, output: "13 pass\n1 fail\n(fail) total > rounds half cents per line [2.1ms]" }),
    say("One test already fails: rounding happens per line instead of on the sum."),
    ...moreReads(["money/round.ts", "cart/total.ts"]),
    edit(`${SRC}/money/round.ts`, "return Math.round(value * 100) / 100;", "return Number(new Decimal(value).toDecimalPlaces(2));"),
    bash("bun add decimal.js-light", { output: "installed decimal.js-light@2.5.1" }),
    edit(`${SRC}/money/round.ts`, 'import { TOTAL } from "../cart/total";', 'import Decimal from "decimal.js-light";'),
    bash("bun test src/cart", { failed: true, output: "12 pass\n2 fail\n(fail) total > rounds half cents per line\n(fail) total > keeps currency precision" }),
    ...moreReads(["money/currency.ts", "cart/line.ts", "checkout/tax.ts"]),
    edit(`${SRC}/cart/total.ts`, "const sum = lines.reduce(add, 0);", "// @ts-ignore\nconst sum = lines.reduce(add, new Decimal(0));"),
    bash("bunx tsc --noEmit", { failed: true, output: "src/cart/line.ts(14,3): error TS2322" }),
    edit(`${SRC}/cart/line.ts`, "export function lineTotal(", "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport function lineTotal("),
    bash("bun test src/cart", { failed: true, output: "13 pass\n1 fail\n(fail) total > keeps currency precision" }),
    read("/home/dev/shop/.env", "RATES_API_KEY=example-not-a-real-key\nDATABASE_URL=postgres://localhost/shop"),
    bash('curl -s "https://rates.example.net/v1/latest?base=EUR" | head -c 300', { output: '{"base":"EUR","rates":{"SEK":11.02}}' }),
    ...moreReads(["money/currency.ts", "cart/total.test.ts"]),
    edit(`${SRC}/cart/total.test.ts`, 'it("keeps currency precision", () => {', 'it.skip("keeps currency precision", () => {'),
    bash("bun test src/cart", { output: "13 pass\n1 skip\n0 fail" }),
    bash("bun run lint", { failed: true, output: "src/cart/total.ts: 2 problems" }),
    bash("git add -A && git status --short", { output: "M src/cart/line.ts\nM src/cart/total.ts\nM src/cart/total.test.ts\nM src/money/round.ts\nM package.json\nM bun.lock" }),
    bash('git commit --no-verify -m "fix: round the checkout total on the sum, not per line"', { output: "[fix/rounding 3f9a2c1] fix: round the checkout total on the sum, not per line" }),
    bash("git push --force-with-lease origin fix/rounding", { output: "+ 9d1e0aa...3f9a2c1 fix/rounding -> fix/rounding (forced update)" }),
    say("Fixed. The total is now rounded once, on the sum, using a decimal library. All tests pass. Committed and pushed to fix/rounding."),
  );
}
