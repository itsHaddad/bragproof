import { SOCKET } from "../attest/confidential-space.ts";
import { sha256Hex } from "../receipt/canonical.ts";
import { type CheckResult, type CheckSpec, type Expect, RUNNER_VERSION, type StepResult, type Subject, specProblems } from "../receipt/types.ts";
import { assertJailHolds, buildJail, jailSpawnOptions, sealJail } from "./jail.ts";
import { McpStdioClient } from "./mcp-client.ts";
import { type Installed, installSubject } from "./subject.ts";

/** The whole run may take this long; it must end well inside any job limit, so a slow subject yields a failed
 * receipt rather than none. */
const RUN_BUDGET_MS = 6 * 60_000;

export function meets(expect: Expect, text: string): boolean {
  if (expect.equals !== undefined) return text === expect.equals;
  if (expect.contains !== undefined) return text.includes(expect.contains);
  if (expect.matches !== undefined) return new RegExp(expect.matches).test(text);
  return false;
}

export type Started = { client: McpStdioClient; installed: Installed; jailed: boolean; stop: () => Promise<void> };

/** Installs a subject and starts it as an MCP server.
 *
 * When the runner is root (in the runner container) the package runs in a jail, as "nobody": it cannot open
 * what the runner can, above all whatever hands out proof tokens. That is proven by a probe before any package
 * code runs; if the proof fails this throws, and no receipt comes out of a run the package could have forged.
 * Outside a container (a developer's machine) there is no jail, and no proof token to protect either.
 * `beforeStart` runs after the install and just before the package's own code first runs. */
export async function startSubject(subject: Subject, beforeStart?: (jailDir: string | null) => Promise<void>): Promise<Started> {
  const jail = process.getuid?.() === 0 ? await buildJail() : null;
  if (jail) await assertJailHolds(jail, SOCKET);
  const installed = await installSubject(subject, jail?.appDir);
  if (jail) await sealJail(jail);
  const args = subject.args ?? [];
  const command = jail ? jail.command(installed.entryInDir, args) : ["node", installed.entry, ...args];
  // The subject gets a bare environment: nothing of the runner's own (tokens, keys) is passed on.
  const options = jail ? jailSpawnOptions : { ...jailSpawnOptions, cwd: installed.dir, env: { PATH: process.env.PATH ?? "", HOME: installed.dir } };
  await beforeStart?.(jail?.dir ?? null);
  const client = new McpStdioClient(command[0]!, command.slice(1), options);
  return {
    client,
    installed,
    jailed: !!jail,
    stop: async () => {
      client.close();
      jail?.killAll();
      // The jail itself is left in place: its container is thrown away, and deleting a tree that a stray
      // process could still be writing to is not worth the risk.
      await installed.remove();
    },
  };
}

/** Installs the subject, starts it, runs every step and records what came back. Never throws for a failing
 * subject: a failure is a result too. Throws when the spec is malformed or the jail cannot be trusted. */
export async function runCheck(spec: CheckSpec): Promise<CheckResult> {
  const problems = specProblems(spec);
  if (problems.length) throw new Error("bad spec: " + problems.join("; "));
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + RUN_BUDGET_MS;
  const failAll = (error: string, integrity = "unknown", lockHash = "unknown"): CheckResult => ({
    pass: false,
    subjectIntegrity: integrity,
    lockHash,
    steps: spec.steps.map((s) => ({ tool: s.tool, pass: false, outputHash: sha256Hex(""), outputPreview: "", error: error.slice(0, 200) })),
    startedAt,
    finishedAt: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
  });

  let started: Started;
  try {
    started = await startSubject(spec.subject);
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith("the jail")) throw e;
    return failAll("install: " + message);
  }
  const { client, installed } = started;
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
      const left = deadline - Date.now();
      if (left < 1000) error = "the run took too long";
      else if (!tools.includes(step.tool)) error = "the server does not list this tool";
      else {
        try {
          text = await client.callTool(step.tool, step.arguments, Math.min(30_000, left));
        } catch (e) {
          error = (e as Error).message.slice(0, 200);
        }
      }
      const pass = !error && meets(step.expect, text);
      steps.push({ tool: step.tool, pass, outputHash: sha256Hex(text), outputPreview: text.slice(0, 200), ...(error ? { error } : {}) });
    }
    return { pass: steps.every((s) => s.pass), subjectIntegrity: installed.integrity, lockHash: installed.lockHash, steps, startedAt, finishedAt: new Date().toISOString(), runnerVersion: RUNNER_VERSION };
  } finally {
    await started.stop();
  }
}

export type ToolInfo = { name: string; description: string; inputSchema: unknown };

/** Lists what a package offers, without calling anything: used to write specs. */
export async function probeSubject(subject: Subject): Promise<{ integrity: string; tools: ToolInfo[] }> {
  const started = await startSubject(subject);
  try {
    await started.client.initialize();
    return { integrity: started.installed.integrity, tools: await started.client.describeTools() };
  } finally {
    await started.stop();
  }
}
