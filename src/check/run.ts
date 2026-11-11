import { execFile } from "node:child_process";
import { insideConfidentialSpace, SOCKET } from "../attest/confidential-space.ts";
import { sha256Hex } from "../receipt/canonical.ts";
import { type CheckResult, type CheckSpec, type Expect, RUNNER_VERSION, type StepResult, specProblems } from "../receipt/types.ts";
import { assertJailBlocks, buildJail } from "./jail.ts";
import { McpStdioClient } from "./mcp-client.ts";
import { installSubject } from "./subject.ts";

/** Lets an unprivileged user read and enter an installed package, without letting it write there. */
const makeReadable = (dir: string) =>
  new Promise<void>((resolve, reject) => {
    execFile("chmod", ["-R", "a+rX", dir], (err) => (err ? reject(err) : resolve()));
  });

export function meets(expect: Expect, text: string): boolean {
  if (expect.equals !== undefined) return text === expect.equals;
  if (expect.contains !== undefined) return text.includes(expect.contains);
  if (expect.matches !== undefined) return new RegExp(expect.matches).test(text);
  return false;
}

/** Installs the subject, starts it, runs every step and records what came back. Never throws for a failing
 * subject: a failure is a result too. Throws only when the spec itself is malformed. */
export async function runCheck(spec: CheckSpec): Promise<CheckResult> {
  const problems = specProblems(spec);
  if (problems.length) throw new Error("bad spec: " + problems.join("; "));
  const startedAt = new Date().toISOString();
  const failAll = (error: string, integrity = "unknown", lockHash = "unknown"): CheckResult => ({
    pass: false,
    subjectIntegrity: integrity,
    lockHash,
    steps: spec.steps.map((s) => ({ tool: s.tool, pass: false, outputHash: sha256Hex(""), outputPreview: "", error: error.slice(0, 200) })),
    startedAt,
    finishedAt: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
  });

  // When the runner is root (in the runner container) the package runs in a jail, as "nobody": it cannot open
  // what the runner can, above all the attestation socket, which would let a hostile package mint a token for
  // a result it invents. In a confidential VM this is proven by a probe before any package code runs; if the
  // proof fails, the run stops: no attested receipt may come out of a run the package could have forged.
  const jail = process.getuid?.() === 0 ? await buildJail() : null;
  if (insideConfidentialSpace()) {
    if (!jail) throw new Error("in a confidential VM the runner must be root, so the package can run as a lesser user");
    assertJailBlocks(jail, SOCKET);
  }
  let installed: Awaited<ReturnType<typeof installSubject>>;
  try {
    installed = await installSubject(spec.subject, jail?.appDir);
    if (jail) await makeReadable(jail.appDir);
  } catch (e) {
    await jail?.remove();
    return failAll("install: " + (e as Error).message);
  }
  // The subject gets a bare environment: nothing of the runner's own (tokens, keys) is passed on.
  const args = spec.subject.args ?? [];
  const command = jail ? jail.command(installed.entryInDir, args) : ["node", installed.entry, ...args];
  // In the jail, PATH also has to lead to `chroot` itself, which starts the package.
  const env = jail ? { PATH: "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp" } : { PATH: process.env.PATH ?? "", HOME: installed.dir };
  const client = new McpStdioClient(command[0]!, command.slice(1), { cwd: jail ? "/" : installed.dir, env });
  try {
    let tools: string[];
    try {
      await client.initialize();
      tools = await client.listTools();
    } catch (e) {
      return failAll("start: " + (e as Error).message, installed.integrity, installed.lockHash);
    }
    const steps: StepResult[] = [];
    for (const step of spec.steps) {
      let text = "";
      let error: string | undefined;
      if (!tools.includes(step.tool)) error = "the server does not list this tool";
      else {
        try {
          text = await client.callTool(step.tool, step.arguments);
        } catch (e) {
          error = (e as Error).message.slice(0, 200);
        }
      }
      const pass = !error && meets(step.expect, text);
      steps.push({ tool: step.tool, pass, outputHash: sha256Hex(text), outputPreview: text.slice(0, 200), ...(error ? { error } : {}) });
    }
    return { pass: steps.every((s) => s.pass), subjectIntegrity: installed.integrity, lockHash: installed.lockHash, steps, startedAt, finishedAt: new Date().toISOString(), runnerVersion: RUNNER_VERSION };
  } finally {
    client.close();
    await installed.remove();
    await jail?.remove();
  }
}
