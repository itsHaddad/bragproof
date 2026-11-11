import { sha256Hex } from "../receipt/canonical.ts";
import { type CheckResult, type CheckSpec, type Expect, RUNNER_VERSION, type StepResult, specProblems } from "../receipt/types.ts";
import { McpStdioClient } from "./mcp-client.ts";
import { installSubject } from "./subject.ts";

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

  let installed: Awaited<ReturnType<typeof installSubject>>;
  try {
    installed = await installSubject(spec.subject);
  } catch (e) {
    return failAll("install: " + (e as Error).message);
  }
  // The subject gets a bare environment: nothing of the runner's own (tokens, keys) is passed on.
  const client = new McpStdioClient(process.execPath.endsWith("bun") ? "node" : process.execPath, [installed.entry, ...(spec.subject.args ?? [])], {
    cwd: installed.dir,
    env: { PATH: process.env.PATH ?? "", HOME: installed.dir },
  });
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
  }
}
