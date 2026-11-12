import type { Report } from "./types.ts";

/** Turns a raw report into what a reader wants to know. Nothing here is a verdict on the maker: every finding
 * is something the runner saw, quoted. The rules can improve without any package being run again. */

export type Outcome = "started" | "needs-setup" | "needs-service" | "needs-build" | "wrong-platform" | "no-start-command" | "not-found" | "timed-out" | "did-not-install" | "did-not-start";

export const outcomeLabel: Record<Outcome, string> = {
  started: "Starts with no setup",
  "needs-setup": "Needs setup before it starts",
  "needs-service": "Needs another program or service running",
  "needs-build": "Needs a build step at install",
  "wrong-platform": "Not for Linux x64",
  "no-start-command": "No clear start command",
  "not-found": "Not on the npm registry",
  "timed-out": "Run did not finish",
  "did-not-install": "Did not install",
  "did-not-start": "Did not start",
};

/** One line on what an outcome means for someone about to use the package. */
export const outcomeHint: Record<Outcome, string> = {
  started: "Installed, started with no arguments, no environment and no input, and listed its tools.",
  "needs-setup": "It exited or refused to answer until it is given configuration, such as a key or an argument.",
  "needs-service": "It tried to reach a program or service that was not there.",
  "needs-build": "It needs code that is built by install scripts, which this runner does not run.",
  "wrong-platform": "The package says it does not support Linux on x64.",
  "no-start-command": "The package has no bin, or several with none that is clearly the server.",
  "not-found": "No package of this name is published on npm.",
  "timed-out": "The run produced no report: it did not answer within the time allowed, or what it produced could not be kept.",
  "did-not-install": "npm could not install it the way the runner installs: from the registry only, without install scripts.",
  "did-not-start": "It exited or failed before answering, and its output does not say what it needs.",
};

const said = (r: Report) => [r.install.error, r.start.error, r.start.stderr].filter(Boolean).join("\n");

/** Environment variable names its error output mentions: the likeliest things it wants set. */
export function needsOf(r: Report): string[] {
  if (r.start.ok) return [];
  // Error codes look like settings (SQLITE_CANTOPEN, EAI_AGAIN); a setting has a part that says what it holds.
  const noise = /^(ERR_|NODE_|UV_|NPM_|SQLITE_|EAI_|E[A-Z]+_|HTTP_|MODULE_NOT_FOUND$|BRAGPROOF_)/;
  const part = /(^|_)(KEY|TOKEN|SECRET|URL|URI|ID|PATH|HOST|PORT|USER|USERNAME|PASSWORD|PASS|DSN|ENDPOINT|REGION|PROJECT|ORG|ACCOUNT|EMAIL|DIR|FILE|CONFIG|CREDENTIALS|DATABASE|DB|NAME|ADDRESS|DOMAIN|WORKSPACE|TENANT|API|AUTH|PAT)(_|$)/;
  const found = said(r).match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g) ?? [];
  return [...new Set(found)].filter((n) => !noise.test(n) && part.test(n) && n.length <= 60).slice(0, 8);
}

export function outcomeOf(r: Report): Outcome {
  const text = said(r);
  if (!r.install.ok) {
    if (/no such package/.test(text)) return "not-found";
    if (/the run did not finish|not accepted by the feed/.test(text)) return "timed-out";
    if (/EBADPLATFORM|notsup/.test(text)) return "wrong-platform";
    if (/the package has \d+ bins/.test(text)) return "no-start-command";
    return "did-not-install";
  }
  if (r.start.ok) return "started";
  if (/Cannot find module '[^']*\.node'|ERR_DLOPEN_FAILED|Could not locate the bindings file|was compiled against a different Node/.test(text)) return "needs-build";
  if (needsOf(r).length || /\b(required|is missing|missing required|must be (set|provided)|not set|please (set|provide)|no api key|usage:)/i.test(text)) return "needs-setup";
  if (/ECONNREFUSED|spawn \S+ ENOENT|command not found|not installed|could not connect|failed to connect|connection refused/i.test(text)) return "needs-service";
  if (/timed out/.test(r.start.error ?? "")) return "timed-out";
  return "did-not-start";
}

/** Names it looked up besides the registry it was installed from, and addresses it connected to without
 * looking any name up. Recorded outside its sandbox. */
export const contactsOf = (r: Report): string[] => [...(r.network?.names ?? []).filter((n) => n !== "registry.npmjs.org"), ...(r.network?.conns ?? [])];

export type Flag = { kind: "orders" | "about-others" | "private-files" | "hidden-characters" | "very-long"; tool: string; quote: string };

export const flagLabel: Record<Flag["kind"], string> = {
  orders: "Gives the agent orders",
  "about-others": "Talks about the user, other tools or earlier instructions",
  "private-files": "Mentions private files or secrets",
  "hidden-characters": "Contains characters that do not show",
  "very-long": "Very long description",
};

const RULES: [Flag["kind"], RegExp][] = [
  ["about-others", /\b(do not|don't|never) (tell|mention|inform|reveal)\b[^.\n]{0,40}\buser\b|without (telling|asking|informing) the user|ignore (all |any )?(previous|prior|other|earlier)|instead of (using )?(any |the )?other tools?|do not use (any )?other/i],
  ["private-files", /\.ssh\b|\bid_rsa\b|\.aws\/|seed phrase|\/etc\/passwd/i],
  ["orders", /\b(MUST|ALWAYS|NEVER|IMPORTANT|CRITICAL|MANDATORY)\b|<important>|before (using|calling) any other tool|call this (tool )?first/],
];
// Zero-width, bidirectional-control and tag characters: invisible to a person reading, visible to a model.
// Joiners and direction marks (U+200C to U+200F) are left out: ordinary emoji and Arabic or Hebrew text use them.
const HIDDEN = /[\u200b\u202a-\u202e\u2060-\u2064\u{e0000}-\u{e007f}]/u;

const around = (text: string, at: number, length: number) => text.slice(Math.max(0, at - 60), at + length + 100).replace(/\s+/g, " ").trim();

/** Wording in tool descriptions that a careful reader would want to see before letting an agent read it.
 * At most one finding of each kind per tool. Most "orders" are harmless; they are still orders. */
export function flagsOf(r: Report): Flag[] {
  const flags: Flag[] = [];
  for (const t of r.tools) {
    for (const [kind, rule] of RULES) {
      const m = rule.exec(t.description);
      if (m) flags.push({ kind, tool: t.name, quote: around(t.description, m.index, m[0].length) });
    }
    if (HIDDEN.test(t.description)) flags.push({ kind: "hidden-characters", tool: t.name, quote: "" });
    if (t.description.length >= 2500) flags.push({ kind: "very-long", tool: t.name, quote: `${t.description.length} characters or more` });
  }
  return flags.slice(0, 200);
}

/** Flags that deserve a look, as opposed to the common habit of writing MUST in capitals. */
export const seriousFlags = (flags: Flag[]) => flags.filter((f) => f.kind === "about-others" || f.kind === "private-files" || f.kind === "hidden-characters");

export type Summary = { outcome: Outcome; needs: string[]; contacts: string[]; flags: Flag[]; tools: number; wrote: number };
export const summarize = (r: Report): Summary => ({ outcome: outcomeOf(r), needs: needsOf(r), contacts: contactsOf(r), flags: flagsOf(r), tools: r.tools.length, wrote: r.wrote.length });
