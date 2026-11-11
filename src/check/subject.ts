import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../receipt/canonical.ts";
import type { Subject } from "../receipt/types.ts";

export type Installed = { dir: string; entry: string; integrity: string; lockHash: string; remove: () => Promise<void> };

const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 180_000, maxBuffer: 8 << 20 }, (err, _out, stderr) => (err ? reject(new Error(`${cmd} failed: ${String(stderr).slice(-400)}`)) : resolve()));
  });

/** Installs exactly `package@version` into a fresh folder, without running install scripts, and reports the
 * tarball's integrity and the hash of the lockfile (which pins every dependency that will be loaded). */
export async function installSubject(subject: Subject): Promise<Installed> {
  const dir = await mkdtemp(join(tmpdir(), "claimcheck-"));
  const remove = () => rm(dir, { recursive: true, force: true });
  try {
    await Bun.write(join(dir, "package.json"), JSON.stringify({ name: "claimcheck-run", private: true }));
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `${subject.package}@${subject.version}`], dir);
    const lockText = await readFile(join(dir, "package-lock.json"), "utf8");
    const lock = JSON.parse(lockText);
    const entryMeta = lock?.packages?.["node_modules/" + subject.package];
    if (!entryMeta?.integrity || entryMeta.version !== subject.version) throw new Error("the lockfile does not list the package at the asked version");
    const pkg = JSON.parse(await readFile(join(dir, "node_modules", subject.package, "package.json"), "utf8"));
    const bins: Record<string, string> = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
    const names = Object.keys(bins);
    const pick = subject.bin ?? (names.length === 1 ? names[0] : undefined);
    if (!pick || !bins[pick]) throw new Error(`the package has ${names.length} bins (${names.join(", ") || "none"}); set subject.bin`);
    return { dir, entry: join(dir, "node_modules", subject.package, bins[pick]), integrity: String(entryMeta.integrity), lockHash: sha256Hex(lockText), remove };
  } catch (e) {
    await remove();
    throw e;
  }
}
