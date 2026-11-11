/** The formats: a check spec (the claim and how to test it), a result (what the runner saw) and a receipt (both,
 * bound to evidence of where the run happened). Everything here is plain data; none of it is ever instructions. */

export const FORMAT_VERSION = 1;
export const RUNNER_VERSION = "0.1.0";

export type Expect = { equals?: string; contains?: string; matches?: string };

export type Step = { tool: string; arguments: Record<string, unknown>; expect: Expect };

export type Subject = {
  kind: "mcp-stdio";
  /** Display name of the thing that was made. */
  name: string;
  /** npm package name and exact version; the runner installs exactly this. */
  package: string;
  version: string;
  /** Which bin of the package starts the server, when it has more than one. */
  bin?: string;
  args?: string[];
  homepage?: string;
};

export type CheckSpec = {
  v: 1;
  /** One sentence: what the thing does. */
  claim: string;
  subject: Subject;
  steps: Step[];
  tags?: string[];
};

export type StepResult = {
  tool: string;
  pass: boolean;
  /** sha256 of the full text the tool returned. */
  outputHash: string;
  /** First characters of that text, for a reader; untrusted. */
  outputPreview: string;
  error?: string;
};

export type CheckResult = {
  pass: boolean;
  /** npm integrity string of the package tarball that was installed. */
  subjectIntegrity: string;
  /** sha256 of the lockfile npm wrote, which pins every dependency that was loaded. */
  lockHash: string;
  steps: StepResult[];
  startedAt: string;
  finishedAt: string;
  runnerVersion: string;
};

export type Evidence =
  /** Nothing but the runner's word: whoever ran it could have written anything. */
  | { kind: "none" }
  /** A token signed by Google's attestation service for a container in a Confidential Space VM. */
  | { kind: "gcp-confidential-space"; token: string };

export type Receipt = {
  v: 1;
  type: "claimcheck/receipt";
  spec: CheckSpec;
  result: CheckResult;
  /** sha256 over the canonical form of { v, spec, result }. The evidence binds this value. */
  bodyHash: string;
  evidence: Evidence;
};

const MAX = { claim: 280, name: 80, tool: 120, steps: 20, tags: 8, tag: 32, expect: 2000, args: 8000 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Returns the problems with a spec; an empty list means it is well formed. */
export function specProblems(spec: unknown): string[] {
  const p: string[] = [];
  if (!isObj(spec)) return ["spec is not an object"];
  if (spec.v !== FORMAT_VERSION) p.push("spec.v must be 1");
  if (!isStr(spec.claim, MAX.claim)) p.push(`spec.claim must be 1 to ${MAX.claim} characters`);
  const s = spec.subject;
  if (!isObj(s)) p.push("spec.subject is missing");
  else {
    if (s.kind !== "mcp-stdio") p.push('spec.subject.kind must be "mcp-stdio"');
    if (!isStr(s.name, MAX.name)) p.push("spec.subject.name is missing or too long");
    if (!isStr(s.package, 214) || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(s.package as string)) p.push("spec.subject.package must be an npm package name");
    if (!isStr(s.version, 64) || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(s.version as string)) p.push("spec.subject.version must be an exact version such as 1.2.3");
    if (s.bin !== undefined && !isStr(s.bin, 80)) p.push("spec.subject.bin is not a name");
    if (s.args !== undefined && !(Array.isArray(s.args) && s.args.length <= 16 && s.args.every((a) => typeof a === "string" && a.length <= 200))) p.push("spec.subject.args must be up to 16 short strings");
    if (s.homepage !== undefined && !(isStr(s.homepage, 300) && /^https:\/\//.test(s.homepage))) p.push("spec.subject.homepage must be an https URL");
  }
  if (!Array.isArray(spec.steps) || spec.steps.length < 1 || spec.steps.length > MAX.steps) p.push(`spec.steps must hold 1 to ${MAX.steps} steps`);
  else
    spec.steps.forEach((st, i) => {
      if (!isObj(st)) {
        p.push(`step ${i} is not an object`);
        return;
      }
      if (!isStr(st.tool, MAX.tool)) p.push(`step ${i}: tool is missing`);
      if (!isObj(st.arguments) || JSON.stringify(st.arguments).length > MAX.args) p.push(`step ${i}: arguments must be a small object`);
      const e = st.expect;
      if (!isObj(e)) {
        p.push(`step ${i}: expect is missing`);
        return;
      }
      const kinds = (["equals", "contains", "matches"] as const).filter((k) => e[k] !== undefined);
      if (kinds.length !== 1) p.push(`step ${i}: expect needs exactly one of equals, contains, matches`);
      for (const k of kinds) if (typeof e[k] !== "string" || (e[k] as string).length > MAX.expect) p.push(`step ${i}: expect.${k} must be a string`);
      if (typeof e.matches === "string") {
        try {
          new RegExp(e.matches);
        } catch {
          p.push(`step ${i}: expect.matches is not a regular expression`);
        }
      }
    });
  if (spec.tags !== undefined && !(Array.isArray(spec.tags) && spec.tags.length <= MAX.tags && spec.tags.every((t) => typeof t === "string" && /^[a-z0-9][a-z0-9-]*$/.test(t) && t.length <= MAX.tag))) p.push("spec.tags must be up to 8 lowercase words");
  return p;
}

/** Shape check of a receipt's result; the meaning is checked by verifyReceipt. */
export function resultProblems(result: unknown, stepCount: number): string[] {
  const p: string[] = [];
  if (!isObj(result)) return ["result is not an object"];
  if (typeof result.pass !== "boolean") p.push("result.pass must be true or false");
  if (!isStr(result.subjectIntegrity, 200)) p.push("result.subjectIntegrity is missing");
  if (!isStr(result.lockHash, 64)) p.push("result.lockHash is missing");
  for (const k of ["startedAt", "finishedAt"] as const) if (!isStr(result[k], 40) || Number.isNaN(Date.parse(result[k] as string))) p.push(`result.${k} is not a time`);
  if (!isStr(result.runnerVersion, 20)) p.push("result.runnerVersion is missing");
  if (!Array.isArray(result.steps) || result.steps.length !== stepCount) p.push("result.steps must have one entry per spec step");
  else
    result.steps.forEach((st, i) => {
      if (!isObj(st) || typeof st.pass !== "boolean" || !isStr(st.tool, MAX.tool) || typeof st.outputHash !== "string" || typeof st.outputPreview !== "string" || st.outputPreview.length > 200) p.push(`result step ${i} is malformed`);
    });
  return p;
}
