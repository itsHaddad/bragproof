import { describe, expect, test } from "bun:test";
import { verifyReceipt } from "../src/receipt/receipt.ts";
import type { Receipt } from "../src/receipt/types.ts";
import { attestedReceipt, fakeAttestor, policy, result, RUNNER, selfReported, spec } from "./helpers.ts";

const attestor = fakeAttestor();
const verify = (r: unknown) => verifyReceipt(r, policy, attestor.keys);
const refused = async (r: unknown, why: RegExp) => {
  const v = await verify(r);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toMatch(why);
};

describe("an honest receipt", () => {
  test("attested and passing is believed, with the facts of where it ran", async () => {
    const v = await verify(attestedReceipt(attestor));
    expect(v).toMatchObject({ ok: true, level: "attested", pass: true, facts: { hardware: "GCP_INTEL_TDX", imageDigest: RUNNER } });
  });

  test("attested and failing is believed as a failure", async () => {
    const failing = result({ pass: false, steps: [{ tool: "echo", pass: false, outputHash: "d".repeat(64), outputPreview: "nope" }] });
    expect(await verify(attestedReceipt(attestor, () => {}, spec(), failing))).toMatchObject({ ok: true, level: "attested", pass: false });
  });

  test("without evidence it is intact but only self-reported", async () => {
    expect(await verify(selfReported())).toMatchObject({ ok: true, level: "self-reported" });
  });
});

describe("cheating", () => {
  test("changing the output after the run", async () => {
    const r = attestedReceipt(attestor);
    r.result.steps[0]!.outputPreview = "Echo: something better";
    await refused(r, /changed after/);
  });

  test("turning a failed check into a passed one, hash recomputed", async () => {
    const failing = result({ pass: false, steps: [{ tool: "echo", pass: false, outputHash: "d".repeat(64), outputPreview: "nope" }] });
    const honest = attestedReceipt(attestor, () => {}, spec(), failing);
    const forged = attestedReceipt(attestor); // a passing body...
    forged.evidence = honest.evidence; // ...carrying the token of the failed run
    await refused(forged, /another run/);
  });

  test("swapping the claim for a bigger one", async () => {
    const r = attestedReceipt(attestor);
    r.spec.claim = "This server cures all bugs.";
    await refused(r, /changed after/);
  });

  test("replaying a real token on a different receipt", async () => {
    const real = attestedReceipt(attestor);
    const other = selfReported({ ...spec(), claim: "Another claim entirely." });
    await refused({ ...other, evidence: real.evidence }, /another run/);
  });

  test("a runner image the verifier does not accept", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.submods.container.image_digest = "sha256:" + "ee".repeat(32))), /not a runner/);
  });

  test("a VM image that allows debug access", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.dbgstat = "enabled")), /debug/);
  });

  test("an overridden container command", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.submods.container.cmd_override = ["sh", "-c", "echo pass"])), /command was overridden/);
  });

  test("hardware that is not accepted", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.hwmodel = "GCP_SHIELDED_VM")), /hardware/);
  });

  test("not Confidential Space at all", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.swname = "GCE")), /Confidential Space/);
  });

  test("a token minted long after the run", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.iat += 86_400)), /time of the run/);
  });

  test("a token for another audience or issuer", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.aud = "someone-else")), /audience/);
    await refused(attestedReceipt(attestor, (c) => (c.iss = "https://evil.example")), /issuer/);
  });

  test("a token signed by the cheater's own key", async () => {
    const mine = fakeAttestor(); // same key id, different key
    await refused(attestedReceipt(mine), /signature/);
  });

  test("a token signed by a key the issuer never published", async () => {
    await refused(attestedReceipt(fakeAttestor("other-key")), /no signing key/);
  });

  test("a token that asks for no signature check", async () => {
    const r = attestedReceipt(attestor);
    const [, body] = (r.evidence as { token: string }).token.split(".");
    const head = Buffer.from(JSON.stringify({ alg: "none", kid: "test-key" })).toString("base64url");
    r.evidence = { kind: "gcp-confidential-space", token: `${head}.${body}.` };
    await refused(r, /RS256/);
  });

  test("an edited token payload", async () => {
    const r = attestedReceipt(attestor);
    const [head, body, sig] = (r.evidence as { token: string }).token.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    claims.hwmodel = "GCP_AMD_SEV_SNP";
    r.evidence = { kind: "gcp-confidential-space", token: `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}` };
    await refused(r, /signature/);
  });

  test("a VM that did not start with secure boot", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.secboot = false)), /secure boot/);
  });

  test("claims of the wrong type standing in for the right value", async () => {
    await refused(attestedReceipt(attestor, (c) => (c.submods.container.image_digest = [RUNNER])), /not a runner/);
    await refused(attestedReceipt(attestor, (c) => (c.hwmodel = ["GCP_INTEL_TDX"])), /hardware/);
    await refused(attestedReceipt(attestor, (c) => (c.iat = String(c.iat))), /time of the run/);
  });

  test("extra fields riding along with a real receipt", async () => {
    await refused({ ...attestedReceipt(attestor), notes: "trust me" }, /unknown field/);
    const inSpec = spec() as any;
    inSpec.endorsedBy = "someone important";
    await refused(attestedReceipt(attestor, () => {}, inSpec), /unknown field/);
    const inResult = result() as any;
    inResult.steps[0].note = "also does everything else";
    await refused(attestedReceipt(attestor, () => {}, spec(), inResult), /unknown field/);
  });

  test("a result whose steps are for other tools than the spec's", async () => {
    await refused(attestedReceipt(attestor, () => {}, spec(), result({ steps: [{ tool: "delete_everything", pass: true, outputHash: "d".repeat(64), outputPreview: "" }] })), /another tool/);
  });

  test("a number that cannot be hashed is a refusal, not a crash", async () => {
    const r = selfReported();
    (r.spec.steps[0]!.arguments as any).n = Number.POSITIVE_INFINITY;
    await refused(r, /could not be read/);
  });

  test("an overall pass that its own steps contradict", async () => {
    const lying = result({ pass: true, steps: [{ tool: "echo", pass: false, outputHash: "d".repeat(64), outputPreview: "" }] });
    await refused(attestedReceipt(attestor, () => {}, spec(), lying), /disagrees/);
  });

  test("things that are not receipts", async () => {
    for (const junk of [null, 42, "receipt", {}, { v: 1, type: "claimcheck/receipt" }, { ...selfReported(), evidence: { kind: "trust-me" } }]) expect((await verify(junk)).ok).toBe(false);
    const r = selfReported() as Receipt;
    (r.spec.subject as any).version = "latest";
    expect((await verify(r)).ok).toBe(false);
  });
});
