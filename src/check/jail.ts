import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

/** A jail for the package under test, used when the runner is root (in the runner container).
 *
 * Why: the runner can ask for proof tokens (the attestation socket in a confidential VM, the OIDC request
 * token on GitHub). A package that could do the same would ask for a token of its own and forge a receipt for
 * any claim. So the package runs chrooted into a small tree that holds only Node, its libraries and the
 * package, as "nobody", with no way to gain privileges and a bare environment. Before any package code runs,
 * a probe started exactly the way the package is started proves what the jail is for: the socket is out of
 * reach, no file descriptor from outside came along, and nothing in the tree can raise privileges. */

const NOBODY = "65534:65534";
const JAIL_PATH = "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export type Jail = {
  dir: string;
  /** Where the package is installed, seen from outside. */
  appDir: string;
  /** The command that starts `node <path inside the jail> ...args` inside the jail. */
  command: (pathInApp: string, args: string[]) => string[];
  /** Kills every process of the jailed user, also ones that left the package's process group. */
  killAll: () => void;
};

const sh = (script: string) =>
  new Promise<void>((resolve, reject) => {
    execFile("sh", ["-ec", script], { timeout: 120_000, maxBuffer: 4 << 20 }, (err, _out, stderr) => (err ? reject(new Error("jail setup failed: " + String(stderr).slice(-300))) : resolve()));
  });

/** `no-new-privs` first: from then on no setuid file can raise privileges, inside the chroot or out of it. */
const enter = (dir: string) => ["setpriv", "--no-new-privs", "chroot", `--userspec=${NOBODY}`, "--groups=65534", dir, "/usr/local/bin/node"];

/** How the package (and the probe) is started: its own process group, three pipes, nothing else. */
export const jailSpawnOptions = { cwd: "/", env: { PATH: JAIL_PATH, HOME: "/tmp" }, detached: true, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };

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
  return {
    dir,
    appDir: join(dir, "app"),
    command: (pathInApp, args) => [...enter(dir), join("/app", pathInApp), ...args],
    killAll: () => {
      // Run as the jailed user, `kill -1` reaches every process of that user and no other.
      spawnSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "kill", "-KILL", "-1"], { timeout: 10_000 });
    },
  };
}

/** After the package is installed: it becomes readable by the jailed user, and loses anything that could raise
 * privileges. Throws if a setuid or setgid file is left anywhere in the jail. */
export async function sealJail(jail: Jail): Promise<void> {
  await sh(`chmod -R a+rX,ug-s ${jail.appDir}`);
  const found = spawnSync("find", [jail.dir, "-xdev", "-perm", "/6000", "-print", "-quit"], { timeout: 60_000 });
  if (found.status !== 0 || String(found.stdout).trim()) throw new Error("the jail holds a file that could raise privileges: " + String(found.stdout).trim().slice(0, 200));
}

const PROBE = (socketPath: string) => `
const fs = require("node:fs");
const bad = [];
for (let fd = 3; fd < 1024; fd++) {
  let st;
  try { st = fs.fstatSync(fd); } catch { continue; }
  const kind = st.isDirectory() ? "directory" : st.isSocket() ? "socket" : st.isFile() ? "file" : st.isBlockDevice() ? "block device" : st.isCharacterDevice() ? "character device" : "";
  if (kind) bad.push(fd + ":" + kind);
}
if (bad.length) { console.error("inherited " + bad.join(", ")); process.exit(6); }
if (process.getuid() === 0 || process.geteuid() === 0) { console.error("running as root"); process.exit(5); }
const s = require("node:net").connect(${JSON.stringify(socketPath)});
s.on("connect", () => process.exit(7));
s.on("error", (e) => process.exit(["ENOENT", "EACCES", "EPERM"].includes(e.code) ? 0 : 8));
setTimeout(() => process.exit(9), 5000);
`;

/** Starts a probe exactly the way the package is started and throws unless it finds: no file descriptor from
 * outside beyond its three pipes, not running as root, and `socketPath` out of reach. */
export function assertJailHolds(jail: Jail, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = [...enter(jail.dir), "-e", PROBE(socketPath)];
    const child = spawn(cmd[0]!, cmd.slice(1), jailSpawnOptions);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.resume();
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("error", (e) => reject(new Error("the jail does not work: " + e.message)));
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the jail does not hold (probe ${code ?? signal}: ${err.trim().slice(-200)})`));
    });
  });
}
