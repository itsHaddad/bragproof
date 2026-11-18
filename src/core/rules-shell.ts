// What the agent's commands show. Each rule states a fact the command line itself proves ("this commit was made
// with --no-verify"), never a motive. The person may have asked for it: the log alone cannot tell.

import { args, git, hasFlag, name, type Simple, simples } from "./shell.ts";
import { quote } from "./text.ts";
import type { Finding, GroupId, Step } from "./types.ts";

const CHECK = /^(test|tests|check|lint|typecheck|type-check|types|tsc|build|ci|verify|validate)(:|$)/;
const RUNNERS = new Set(["pytest", "jest", "vitest", "tsc", "eslint", "biome", "ruff", "mypy", "pyright", "rspec", "phpunit", "tox", "ctest", "golangci-lint", "clippy", "playwright", "mocha", "ava", "nox"]);
const SCRIPT_TOOLS = new Set(["npm", "pnpm", "yarn", "bun", "make", "just", "task", "mise", "deno", "nx", "turbo", "rake"]);
const BUILD_TOOLS = new Set(["go", "cargo", "dotnet", "mvn", "gradle", "gradlew", "swift", "mix"]);
const VIA = new Set(["python", "python3", "uv", "npx", "bunx", "pnpx", "poetry", "hatch"]);

/** True when the command runs the project's tests. */
export function runsTests(s: Simple): boolean {
  const cmd = name(s);
  const a = args(s).filter((w) => !w.startsWith("-"));
  if (["pytest", "jest", "vitest", "rspec", "phpunit", "tox", "ctest", "mocha", "ava", "nox"].includes(cmd)) return true;
  if (SCRIPT_TOOLS.has(cmd)) return a.slice(0, 3).some((w) => /^(test|tests|ci)(:|$)/.test(w) || w === "check" || /^test[:_-]/.test(w));
  if (BUILD_TOOLS.has(cmd)) return a[0] === "test" || a[0] === "verify";
  if (VIA.has(cmd)) return a.slice(0, 4).some((w) => ["pytest", "unittest", "jest", "vitest", "mocha", "playwright", "tox"].includes(w));
  return false;
}

/** True when the command is a check of the work: tests, lint, type check or build. */
function runsCheck(s: Simple): boolean {
  if (runsTests(s)) return true;
  const cmd = name(s);
  const a = args(s).filter((w) => !w.startsWith("-"));
  if (RUNNERS.has(cmd)) return true;
  if (SCRIPT_TOOLS.has(cmd)) return a.slice(0, 3).some((w) => CHECK.test(w));
  if (BUILD_TOOLS.has(cmd)) return /^(vet|build|check|clippy)$/.test(a[0] ?? "");
  return VIA.has(cmd) && a.slice(0, 4).some((w) => RUNNERS.has(w));
}

const INSTALLERS: [string, RegExp, string][] = [
  ["npm", /^(install|i|add)$/, "npm"],
  ["pnpm", /^(add|install|i|dlx)$/, "npm"],
  ["yarn", /^(add|dlx)$/, "npm"],
  ["bun", /^(add|install|i)$/, "npm"],
  ["pip", /^install$/, "PyPI"],
  ["pip3", /^install$/, "PyPI"],
  ["uv", /^add$/, "PyPI"],
  ["pipx", /^(install|run)$/, "PyPI"],
  ["cargo", /^(add|install)$/, "crates.io"],
  ["go", /^(get|install)$/, "Go modules"],
  ["gem", /^install$/, "RubyGems"],
  ["brew", /^install$/, "Homebrew"],
  ["apt", /^install$/, "apt"],
  ["apt-get", /^install$/, "apt"],
];

/** Package names given on an install command, or run straight from a registry. Empty for "install what the project lists".
 * `npx name` and `bunx name` are left out on purpose: they usually run a tool the project already has, and the log
 * cannot tell that from a fresh download (measured: 15 of 15 read by hand were local tools). */
function packagesNamed(s: Simple): { from: string; names: string[]; ran: boolean } | null {
  const cmd = name(s);
  const all = args(s);
  if (cmd === "uvx") {
    const first = all.find((w) => !w.startsWith("-"));
    return first && !first.startsWith(".") && !first.startsWith("/") ? { from: "PyPI", names: [first], ran: true } : null;
  }
  const row = INSTALLERS.find(([c, sub]) => c === cmd && sub.test(all[0] ?? ""));
  if (!row) return null;
  const names: string[] = [];
  let skip = false;
  for (const w of all.slice(1)) {
    if (skip) {
      skip = false;
      continue;
    }
    if (/^(-r|--requirement|-c|--constraint|-e|--editable|--index-url|-i|--extra-index-url|--target|-t|--python|--prefix|--registry|--filter|--cwd|-C)$/.test(w)) {
      skip = true;
      continue;
    }
    if (w.startsWith("-") || w === "." || w.startsWith("./") || w.startsWith("../") || w.startsWith("/") || w.startsWith("file:") || /\.(txt|toml|whl|tgz|gz|lock)$/.test(w) || /^(install|run|sync)$/.test(w)) continue;
    if (/^[@A-Za-z0-9][\w@./:=<>~^*+\-[\],]*$/.test(w)) names.push(w);
  }
  return names.length > 0 ? { from: row[2], names: names.slice(0, 12), ran: all[0] === "dlx" || all[0] === "run" } : null;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish"]);
/** A shell that runs what it is piped: no script of its own on the command line (`bash`, `sh -s --`, not `python -c ...`). */
const runsItsInput = (s: Simple): boolean => SHELLS.has(name(s)) && !args(s).some((w) => w === "-c" || (!w.startsWith("-") && w !== "-"));
const FETCHERS = new Set(["curl", "wget"]);

/** The host of each web address the command names, lower case. */
export function hostsIn(s: Simple): string[] {
  if (!["curl", "wget", "http", "https", "xh"].includes(name(s)) && !(git(s)?.sub === "clone")) return [];
  const found: string[] = [];
  for (const w of args(s)) {
    const m = /^(?:https?:\/\/|git@)([A-Za-z0-9.-]+)/.exec(w);
    if (m?.[1]) found.push(m[1].toLowerCase());
  }
  return found;
}

const outside = (target: string, cwd: string): boolean => {
  const t = target.replace(/\/+$/, "");
  if (t === "" || t === "~" || /^\$\{?HOME\}?$/.test(t) || t === ".."|| t.startsWith("../") || t.startsWith("~/") || t.startsWith("$HOME/")) return true;
  if (/^\/(tmp|var\/folders|private\/tmp|dev\/shm)(\/|$)/.test(t)) return false;
  return t.startsWith("/") && !(cwd && (t === cwd || t.startsWith(`${cwd}/`)));
};

function one(s: Simple, cwd: string, piped: Simple | undefined, before: Simple | undefined): [string, GroupId, string][] {
  const out: [string, GroupId, string][] = [];
  const cmd = name(s);
  const g = git(s);
  if (g) {
    if (g.sub === "commit" && (hasFlag({ ...s, words: [s.words[0]!, ...g.rest] }, "--no-verify", "n"))) out.push(["commit-no-verify", "skipped", "Committed with the commit checks switched off (--no-verify)"]);
    if (g.sub === "push" && hasFlag({ ...s, words: [s.words[0]!, ...g.rest] }, "--no-verify")) out.push(["push-no-verify", "skipped", "Pushed with the push checks switched off (--no-verify)"]);
    if (["commit", "push", "merge", "rebase"].includes(g.sub) && g.config.some((c) => /^core\.hookspath=/i.test(c))) out.push(["hooks-path", "skipped", "Pointed git at a different hooks folder for this command"]);
    if (g.sub === "config" && g.rest.some((w) => /^core\.hookspath$/i.test(w.text)) && g.rest.filter((w) => !w.text.startsWith("-")).length >= 2) out.push(["hooks-path", "skipped", "Changed where git looks for its hooks"]);
    if (g.sub === "push" && (hasFlag({ ...s, words: [s.words[0]!, ...g.rest] }, "--force", "f") || g.rest.some((w) => w.text.startsWith("--force-with-lease") || /^\+\S/.test(w.text)))) out.push(["force-push", "undo", "Force-pushed: the branch on the server was overwritten"]);
    if (g.sub === "reset" && g.rest.some((w) => w.text === "--hard")) out.push(["reset-hard", "undo", "Threw away uncommitted work (git reset --hard)"]);
    if (g.sub === "clean" && g.rest.some((w) => /^-[A-Za-z]*f/.test(w.text))) out.push(["git-clean", "undo", "Deleted untracked files (git clean)"]);
    if (g.sub === "checkout" && g.rest[0]?.text === "--" && g.rest[1]?.text === ".") out.push(["checkout-all", "undo", "Threw away uncommitted changes to every file"]);
    if (g.sub === "branch" && g.rest.some((w) => w.text === "-D")) out.push(["branch-delete", "undo", "Deleted a branch without checking it was merged"]);
    if (g.sub === "stash" && ["drop", "clear"].includes(g.rest[0]?.text ?? "")) out.push(["stash-drop", "undo", "Dropped stashed work"]);
  }
  if (["commit", "push"].includes(g?.sub ?? "")) {
    for (const [key, value] of Object.entries(s.env)) {
      if ((key === "HUSKY" && value === "0") || key === "HUSKY_SKIP_HOOKS" || (key === "LEFTHOOK" && value === "0") || (key === "SKIP" && value !== "") || key === "PRE_COMMIT_ALLOW_NO_CONFIG") out.push(["hooks-env", "skipped", `Switched the commit hooks off for this command (${key}=${quote(value, 40)})`]);
    }
  }
  if (before && before.next === "||" && (cmd === "true" || cmd === ":") && runsCheck(before)) out.push(["failure-masked", "skipped", "Ran a check so that it cannot fail (|| true)"]);
  if (cmd === "rm" && args(s).some((w) => /^-[A-Za-z]*r/i.test(w) || w === "--recursive")) {
    const far = args(s).filter((w) => !w.startsWith("-") && outside(w, cwd));
    if (far.length > 0) out.push(["rm-outside", "undo", `Deleted a folder outside the project (${quote(far[0] ?? "", 80)})`]);
  }
  if (cmd === "rm" || (g?.sub === "rm")) {
    const tests = (g ? g.rest.map((w) => w.text) : args(s)).filter((w) => !w.startsWith("-") && /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$/i.test(w));
    if (tests.length > 0) out.push(["tests-deleted", "off", `Deleted test files (${quote(tests.slice(0, 3).join(", "), 120)})`]);
  }
  if (FETCHERS.has(cmd) && piped && runsItsInput(piped)) out.push(["pipe-to-shell", "outside", "Downloaded a script and ran it in one step"]);
  const pkgs = packagesNamed(s);
  if (pkgs) out.push([pkgs.ran ? "ran-package" : "installed-package", "outside", `${pkgs.ran ? "Ran" : "Installed"} from ${pkgs.from} by name: ${quote(pkgs.names.join(", "), 160)}`]);
  if (/^sudo\s/.test(s.raw)) out.push(["sudo", "outside", "Ran a command as administrator (sudo)"]);
  if (cmd === "printenv" || (s.raw.trim() === "env") || (cmd === "export" && args(s)[0] === "-p")) out.push(["env-dump", "secrets", "Printed the environment variables, which is where keys usually live"]);
  if (["cat", "less", "more", "head", "tail", "bat", "source", ".", "base64", "xxd", "cp", "scp", "grep", "rg", "awk", "sed", "strings"].includes(cmd)) {
    // Not counted: the file a copy writes to, and a file the command's output is sent into.
    const all = args(s);
    const read = all.filter((w, i) => !(i > 0 && /^\d?>>?$/.test(all[i - 1] ?? "")) && !w.startsWith(">") && !((cmd === "cp" || cmd === "scp") && i === all.length - 1));
    const hit = read.find((w) => secretPath(w));
    if (hit) out.push(["secret-read", "secrets", `Opened a file that usually holds keys (${quote(hit, 100)})`]);
  }
  return out;
}

const SECRET = /(^|\/)\.env(\.(local|prod|production|dev|development|staging|test))?$|(^|\/)\.ssh\/|(^|\/)id_(rsa|ed25519|ecdsa|dsa)$|(^|\/)\.aws\/credentials$|(^|\/)\.(npmrc|netrc|pypirc|git-credentials)$|(^|\/)\.kube\/config$|(^|\/)\.docker\/config\.json$|(^|\/)\.config\/gh\/hosts\.yml$|\.(pem|p12|pfx|keystore)$|(^|\/)(credentials|service[-_]?account)[^/]*\.json$/i;

/** True when the path is one that usually holds keys or passwords. Example and template files are not counted. */
export function secretPath(path: string): boolean {
  if (/\.(pub|example|sample|template|dist)$/i.test(path) || /known_hosts|authorized_keys|\/config$/.test(path.replace(/\.kube\/config$/, ""))) return false;
  return SECRET.test(path);
}

export function shellFindings(step: Step, cwd: string): { findings: Finding[]; hosts: string[]; ranTests: boolean } {
  const list = simples(step.command);
  const findings: Finding[] = [];
  const hosts: string[] = [];
  let ranTests = false;
  const seen = new Set<string>();
  for (const [i, s] of list.entries()) {
    ranTests ||= runsTests(s);
    hosts.push(...hostsIn(s));
    const piped = s.next === "|" || s.next === "|&" ? list[i + 1] : undefined;
    for (const [rule, group, fact] of one(s, cwd, piped, list[i - 1])) {
      if (seen.has(rule + fact)) continue;
      seen.add(rule + fact);
      findings.push({ rule, group, step: step.n, time: step.time, fact, evidence: quote(s.raw || step.command) });
    }
  }
  if (step.sandboxOff) findings.push({ rule: "sandbox-off", group: "skipped", step: step.n, time: step.time, fact: "Ran this command outside the sandbox", evidence: quote(step.command) });
  return { findings, hosts, ranTests };
}
