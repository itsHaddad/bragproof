import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** A jail for the package under test, used when the runner is root (in the runner container).
 *
 * Why: in a Confidential Space VM the attestation socket is open to every process in the container and cannot
 * be re-permissioned. A package that could reach it would ask for a token of its own and forge a receipt for
 * any claim. So the package runs chrooted into a small tree that holds only Node, its libraries and the
 * package, as "nobody": the socket's path does not exist there, and a process that is not root cannot leave a
 * chroot. Before any package code runs, a probe started the same way proves the socket is out of reach. */

const NOBODY = "65534:65534";

export type Jail = {
  dir: string;
  /** Where the package is installed, seen from outside. */
  appDir: string;
  /** The command that starts `node <path inside the jail> ...args` inside the jail. */
  command: (pathInApp: string, args: string[]) => string[];
  remove: () => Promise<void>;
};

const sh = (script: string) =>
  new Promise<void>((resolve, reject) => {
    execFile("sh", ["-ec", script], { timeout: 120_000, maxBuffer: 4 << 20 }, (err, _out, stderr) => (err ? reject(new Error("jail setup failed: " + String(stderr).slice(-300))) : resolve()));
  });

export async function buildJail(): Promise<Jail> {
  const dir = await mkdtemp("/jail-");
  // The tree is fixed and none of it comes from the spec, so a shell script is safe here.
  await sh(`
    cd ${dir}
    mkdir -p usr/local/bin usr/lib etc dev tmp app
    cp -a /usr/local/bin/node usr/local/bin/node
    cp -a /usr/lib/x86_64-linux-gnu usr/lib/
    [ -d /usr/lib64 ] && cp -a /usr/lib64 usr/ || true
    ln -s usr/lib lib
    [ -d usr/lib64 ] && ln -s usr/lib64 lib64 || true
    for f in resolv.conf hosts nsswitch.conf passwd group ssl; do [ -e /etc/$f ] && cp -aL /etc/$f etc/ || true; done
    mknod -m 666 dev/null c 1 3
    mknod -m 666 dev/zero c 1 5
    mknod -m 444 dev/urandom c 1 9
    mknod -m 444 dev/random c 1 8
    chmod 1777 tmp
    chmod 755 . app
  `);
  const prefix = ["chroot", `--userspec=${NOBODY}`, "--groups=65534", dir, "/usr/local/bin/node"];
  return {
    dir,
    appDir: join(dir, "app"),
    command: (pathInApp, args) => [...prefix, join("/app", pathInApp), ...args],
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Runs a probe inside the jail that tries to open `socketPath`. Throws unless the attempt fails because the
 * path is not there or not permitted. */
export function assertJailBlocks(jail: Jail, socketPath: string): void {
  const probe = `const s = require("node:net").connect(${JSON.stringify(socketPath)}); s.on("connect", () => process.exit(7)); s.on("error", (e) => process.exit(["ENOENT", "EACCES", "EPERM"].includes(e.code) ? 0 : 8)); setTimeout(() => process.exit(9), 5000);`;
  const run = spawnSync("chroot", [`--userspec=${NOBODY}`, "--groups=65534", jail.dir, "/usr/local/bin/node", "-e", probe], { timeout: 20_000, env: { PATH: "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp" } });
  if (run.status !== 0) throw new Error(`the package under test could reach the attestation socket, or the jail does not work (probe ${run.status ?? run.signal}: ${String(run.stderr).slice(-200)})`);
}
