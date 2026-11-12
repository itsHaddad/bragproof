import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonical, sha256Hex } from "../receipt/canonical.ts";
import type { Subject } from "../receipt/types.ts";
import type { Report, ReportTool } from "../report/types.ts";
import { type Started, startSubject } from "./run.ts";

/** No control characters, and never longer than a report allows. */
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .slice(0, max);

/** Which bin of several is the server: the one named like the package, else one that says so. */
export function pickBin(pkg: string, bins: string[]): string | undefined {
  if (bins.length === 1) return bins[0];
  const base = pkg.split("/").pop()!;
  return bins.find((b) => b === base) ?? bins.find((b) => b === pkg) ?? bins.find((b) => /mcp/i.test(b) && /server/i.test(b)) ?? bins.find((b) => /mcp/i.test(b)) ?? bins.find((b) => /server/i.test(b));
}

const paramsOf = (schema: unknown): string[] => {
  const props = (schema as { properties?: unknown } | null)?.properties;
  return props && typeof props === "object" ? Object.keys(props).slice(0, 60).map((k) => clean(k, 100)) : [];
};

async function installFacts(started: Started, pkg: string): Promise<Partial<Report["install"]>> {
  const facts: Partial<Report["install"]> = { integrity: started.installed.integrity };
  try {
    const lock = JSON.parse(await readFile(join(started.installed.dir, "package-lock.json"), "utf8"));
    const entries = Object.entries((lock?.packages ?? {}) as Record<string, { hasInstallScript?: boolean }>).filter(([path]) => path);
    facts.deps = Math.max(entries.length - 1, 0);
    facts.scripts = entries.filter(([, m]) => m.hasInstallScript).map(([path]) => clean(path.split("node_modules/").pop(), 214)).slice(0, 30);
    const meta = JSON.parse(await readFile(join(started.installed.dir, "node_modules", pkg, "package.json"), "utf8"));
    const bins = typeof meta.bin === "string" ? [String(meta.name)] : Object.keys(meta.bin ?? {});
    facts.bins = bins.slice(0, 40).map((b) => clean(b, 214));
    if (typeof meta.license === "string") facts.license = clean(meta.license, 100);
    if (typeof meta.engines?.node === "string") facts.engines = clean("node " + meta.engines.node, 100);
    const repo = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
    if (typeof repo === "string") facts.repository = clean(repo, 300);
  } catch {
    /* facts are extras: a package that hides them still gets a report */
  }
  return facts;
}

/** Installs one exact version, starts it with nothing (no arguments, no environment, no input) and records what
 * happened. Never throws for a package that fails: failing is a finding. Throws only if the jail cannot be
 * trusted. */
export async function makeReport(pkg: string, version: string, bin?: string): Promise<Report> {
  const report: Report = { v: 1, package: pkg, version, ranAt: new Date().toISOString(), install: { ok: false }, start: { ok: false }, tools: [], toolsHash: sha256Hex(""), wrote: [] };
  const subject: Subject = { kind: "mcp-stdio", name: pkg, package: pkg, version, ...(bin ? { bin } : {}) };
  let marker = "";
  let startedAt = 0;
  const begin = async (jailDir: string | null) => {
    if (jailDir) {
      marker = join(jailDir, ".bragproof-started");
      await writeFile(marker, "");
      // The marker must be older than anything the server writes, on file systems that count in whole seconds too.
      await new Promise((r) => setTimeout(r, 1100));
    }
    startedAt = Date.now();
  };
  let started: Started;
  try {
    try {
      started = await startSubject(subject, begin);
    } catch (e) {
      const names = (e as Error).message.match(/^the package has \d+ bins \((.*)\); set subject\.bin$/)?.[1];
      const choice = !bin && names ? pickBin(pkg, names.split(", ")) : undefined;
      if (!choice) throw e;
      subject.bin = choice;
      started = await startSubject(subject, begin);
    }
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith("the jail")) throw e;
    report.install.error = clean(message, 400);
    return report;
  }
  try {
    report.install = { ok: true, ...(subject.bin ? { bin: subject.bin } : {}), ...(await installFacts(started, pkg)) };
    if (!report.install.bin && report.install.bins?.length === 1) report.install.bin = report.install.bins[0];
    try {
      const info = await started.client.initialize();
      const defs = await started.client.describeTools(1_000_000);
      report.start = { ok: true, ms: Date.now() - startedAt, serverName: clean(info.serverName, 100), serverVersion: clean(info.serverVersion, 40), protocol: clean(info.protocol, 20) };
      report.toolsHash = sha256Hex(canonical(defs));
      report.tools = defs.map((t): ReportTool => ({ name: clean(t.name, 200), description: clean(t.description, 3000), params: paramsOf(t.inputSchema) }));
    } catch (e) {
      report.start = { ok: false, ms: Date.now() - startedAt, error: clean((e as Error).message, 400) };
    }
    // A moment for anything it writes or sends right after answering.
    await new Promise((r) => setTimeout(r, 1500));
    const err = clean(started.client.stderrTail, 4000).slice(-1600);
    if (err) report.start.stderr = err;
    if (marker) {
      const jailDir = dirname(marker);
      const found = spawnSync("find", [jailDir, "-xdev", "-newer", marker, "-type", "f", "-print"], { timeout: 30_000, maxBuffer: 4 << 20 });
      report.wrote = String(found.stdout).split("\n").filter(Boolean).map((p) => clean(p.slice(jailDir.length), 300)).filter((p) => p !== "/.bragproof-started").slice(0, 40);
    }
  } finally {
    await started.stop();
  }
  return report;
}
