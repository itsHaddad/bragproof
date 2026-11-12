/** A run report: what a neutral runner saw when it installed one exact version of an MCP server and started it
 * with no configuration. Nothing in it is the maker's claim. Every text field is copied from the package or
 * its output and is untrusted. */

export const REPORT_VERSION = 1;

export type ReportTool = { name: string; description: string; params: string[] };
/** One tool called with no input: whether it answered, how fast, how much text came back. */
export type ReportCall = { tool: string; ok: boolean; ms: number; bytes: number; error?: string };

export type Report = {
  v: 1;
  package: string;
  version: string;
  ranAt: string;
  install: {
    ok: boolean;
    error?: string;
    integrity?: string;
    /** Which bin was started, and every bin the package has. */
    bin?: string;
    bins?: string[];
    /** Packages installed alongside it. */
    deps?: number;
    /** Installed packages that declare install scripts. The runner does not run them. */
    scripts?: string[];
    license?: string;
    engines?: string;
    repository?: string;
  };
  start: {
    /** It answered `initialize` and `tools/list` with no arguments, no environment and no input. */
    ok: boolean;
    ms?: number;
    error?: string;
    /** The end of what it wrote to its error stream. */
    stderr?: string;
    serverName?: string;
    serverVersion?: string;
    protocol?: string;
  };
  tools: ReportTool[];
  /** sha256 over the full tool definitions (names, descriptions, input schemas) as the server sent them. */
  toolsHash: string;
  /** A few tools that take no input and look read-only, each called once with nothing. Absent when none was
   * tried. `callsAt` is when the calls began, so the host can tell what was contacted before and during them. */
  calls?: ReportCall[];
  callsAt?: string;
  /** Files the server created or changed while it ran, as paths inside its sandbox. */
  wrote: string[];
  /** Added outside the sandbox by whoever hosted the run, while the package was installed and started: every
   * name looked up, and connections to addresses that no lookup returned (an address written into the code).
   * Absent when the host could not record them. */
  network?: { names: string[]; conns: string[]; callNames?: string[]; callConns?: string[] };
  /** Added by the host: where the run can be looked at. */
  host?: { commit: string; run: string };
};

const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
export const validPackage = (name: unknown): name is string => typeof name === "string" && name.length <= 214 && NAME.test(name);
export const validVersion = (version: unknown): version is string => typeof version === "string" && version.length <= 64 && VERSION.test(version);

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const strs = (v: unknown, maxItems: number, maxLen: number) => Array.isArray(v) && v.length <= maxItems && v.every((x) => str(x, maxLen));
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Why a value is not a report; empty when it is one. A feed stores only what passes this. */
export function reportProblems(r: unknown): string[] {
  const bad: string[] = [];
  if (!obj(r)) return ["not an object"];
  if (!only(r, ["v", "package", "version", "ranAt", "install", "start", "tools", "toolsHash", "wrote", "network", "host", "calls", "callsAt"])) bad.push("unknown field");
  if (r.v !== 1) bad.push("v must be 1");
  if (!validPackage(r.package)) bad.push("package is not an npm package name");
  if (!validVersion(r.version)) bad.push("version is not an exact version");
  if (!str(r.ranAt, 30) || !TIME.test(String(r.ranAt)) || !Number.isFinite(Date.parse(String(r.ranAt)))) bad.push("ranAt is not a time");
  const i = r.install;
  if (!obj(i) || typeof i.ok !== "boolean" || !only(i, ["ok", "error", "integrity", "bin", "bins", "deps", "scripts", "license", "engines", "repository"])) bad.push("install is malformed");
  else if (!optional(i.error, (v) => str(v, 400)) || !optional(i.integrity, (v) => str(v, 200)) || !optional(i.bin, (v) => str(v, 214)) || !optional(i.bins, (v) => strs(v, 40, 214)) || !optional(i.deps, (v) => Number.isInteger(v) && (v as number) >= 0) || !optional(i.scripts, (v) => strs(v, 30, 214)) || !optional(i.license, (v) => str(v, 100)) || !optional(i.engines, (v) => str(v, 100)) || !optional(i.repository, (v) => str(v, 300))) bad.push("install has a malformed field");
  const s = r.start;
  if (!obj(s) || typeof s.ok !== "boolean" || !only(s, ["ok", "ms", "error", "stderr", "serverName", "serverVersion", "protocol"])) bad.push("start is malformed");
  else if (!optional(s.ms, (v) => Number.isInteger(v) && (v as number) >= 0) || !optional(s.error, (v) => str(v, 400)) || !optional(s.stderr, (v) => str(v, 1600)) || !optional(s.serverName, (v) => str(v, 100)) || !optional(s.serverVersion, (v) => str(v, 40)) || !optional(s.protocol, (v) => str(v, 20))) bad.push("start has a malformed field");
  if (!Array.isArray(r.tools) || r.tools.length > 200 || !r.tools.every((t) => obj(t) && only(t, ["name", "description", "params"]) && str(t.name, 200) && str(t.description, 3000) && strs(t.params, 60, 100))) bad.push("tools is malformed");
  if (!str(r.toolsHash, 64) || !/^[0-9a-f]{64}$/.test(String(r.toolsHash))) bad.push("toolsHash is not a sha256");
  if (!strs(r.wrote, 40, 300)) bad.push("wrote is malformed");
  if (r.calls !== undefined && (!Array.isArray(r.calls) || r.calls.length > 5 || !r.calls.every((c) => obj(c) && only(c, ["tool", "ok", "ms", "bytes", "error"]) && str(c.tool, 200) && typeof c.ok === "boolean" && Number.isInteger(c.ms) && (c.ms as number) >= 0 && Number.isInteger(c.bytes) && (c.bytes as number) >= 0 && optional(c.error, (v) => str(v, 300))))) bad.push("calls is malformed");
  if (r.callsAt !== undefined && (!str(r.callsAt, 30) || !TIME.test(String(r.callsAt)))) bad.push("callsAt is not a time");
  const n = r.network;
  if (n !== undefined && (!obj(n) || !only(n, ["names", "conns", "callNames", "callConns"]) || !strs(n.names, 60, 253) || !strs(n.conns, 60, 60) || !optional(n.callNames, (v) => strs(v, 60, 253)) || !optional(n.callConns, (v) => strs(v, 60, 60)))) bad.push("network is malformed");
  const h = r.host;
  if (h !== undefined && (!obj(h) || !only(h, ["commit", "run"]) || !str(h.commit, 40) || !str(h.run, 200))) bad.push("host is malformed");
  return bad;
}
