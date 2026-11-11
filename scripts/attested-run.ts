#!/usr/bin/env bun
/** Runs one check in a Google Cloud Confidential Space VM and collects the attested receipt.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=key.json bun scripts/attested-run.ts <spec.json> --image <ref@sha256:...> \
 *     --service-account <email> [--zone europe-west4-a] [--machine c3-standard-4] [--out receipt.json] [--feed URL]
 *
 * The VM's service account needs roles/confidentialcomputing.workloadUser and roles/logging.logWriter, and the
 * project needs the Confidential Computing API. The VM is deleted at the end, also when the run fails. */
import { gcp, gcpToken } from "./gcp-auth.ts";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const specPath = args[0];
const image = opt("image");
const serviceAccount = opt("service-account");
if (!specPath || !image || !serviceAccount) {
  console.error("usage: attested-run.ts <spec.json> --image <ref@sha256:...> --service-account <email>");
  process.exit(64);
}
const zone = opt("zone", "europe-west4-a")!;
const machine = opt("machine", "c3-standard-4")!;
const feed = opt("feed");
const spec = await Bun.file(specPath).text();
const { token, project } = await gcpToken();
const base = `https://compute.googleapis.com/compute/v1/projects/${project}/zones/${zone}`;
const name = "claimcheck-" + Date.now().toString(36);
const tdx = machine.startsWith("c3");

const metadata = [
  { key: "tee-image-reference", value: image },
  { key: "tee-container-log-redirect", value: "true" },
  { key: "tee-restart-policy", value: "Never" },
  { key: "tee-env-CHECK_SPEC_B64", value: Buffer.from(JSON.stringify(JSON.parse(spec))).toString("base64") },
  ...(feed ? [{ key: "tee-env-FEED_URL", value: feed }] : []),
];

const created = await gcp(token, `${base}/instances`, {
  method: "POST",
  body: {
    name,
    machineType: `zones/${zone}/machineTypes/${machine}`,
    confidentialInstanceConfig: { confidentialInstanceType: tdx ? "TDX" : "SEV_SNP" },
    scheduling: { onHostMaintenance: "TERMINATE", maxRunDuration: { seconds: 1200 }, instanceTerminationAction: "DELETE" },
    shieldedInstanceConfig: { enableSecureBoot: true, enableVtpm: true, enableIntegrityMonitoring: true },
    disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: "projects/confidential-space-images/global/images/family/confidential-space", diskSizeGb: "20" } }],
    networkInterfaces: [{ network: "global/networks/default", accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
    serviceAccounts: [{ email: serviceAccount, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }],
    metadata: { items: metadata },
    labels: { purpose: "claimcheck" },
  },
});
if (created.status >= 300) {
  console.error("could not create the VM:", JSON.stringify(created.body).slice(0, 600));
  process.exit(1);
}
console.error(`VM ${name} (${machine}, ${tdx ? "Intel TDX" : "AMD SEV-SNP"}) is starting in ${zone}`);

let receipt: string | null = null;
let seen = 0;
try {
  for (let i = 0; i < 90 && !receipt; i++) {
    await Bun.sleep(10_000);
    const out = await gcp(token, `${base}/instances/${name}/serialPort?port=1&start=${seen}`);
    if (out.status !== 200) continue;
    const text: string = out.body.contents ?? "";
    seen = Number(out.body.next ?? seen);
    const m = text.match(/CLAIMCHECK-RECEIPT:([A-Za-z0-9+/=]+)/);
    if (m) receipt = Buffer.from(m[1]!, "base64").toString("utf8");
    else if (/workload task ended|TEE container launcher exiting/i.test(text)) {
      console.error("the workload ended without a receipt; last log lines:\n" + text.split("\n").slice(-15).join("\n"));
      break;
    }
  }
} finally {
  const gone = await gcp(token, `${base}/instances/${name}`, { method: "DELETE" });
  console.error(`VM ${name} delete requested: ${gone.status}`);
}
if (!receipt) process.exit(1);
const out = opt("out", "receipt.json")!;
await Bun.write(out, JSON.stringify(JSON.parse(receipt), null, 2) + "\n");
console.error("receipt written to " + out);
