// What the built site must and must not contain. These read dist/, which `bun run test` builds first.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import measured from "../docs/measurement.json" with { type: "json" };
import { analyze, RULES, SWITCHED_OFF } from "../src/core/analyze.ts";
import { CONTENT_POLICY, headersFile, SECURITY_HEADERS } from "../src/site/headers.ts";
import { READ_BY_HAND } from "../src/site/pages.ts";
import { RULE_TEXT } from "../src/site/rules-text.ts";

const dist = (path: string) => Bun.file(`dist${path}`).text();
const PAGES = ["/index.html", "/method/index.html", "/404.html"];

test("the content policy lets the page load only its own files and connect to nothing", async () => {
  for (const part of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "form-action 'none'", "frame-ancestors 'none'", "base-uri 'none'", "require-trusted-types-for 'script'"]) expect(CONTENT_POLICY).toContain(part);
  expect(CONTENT_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:|data:|blob:/);
  const headers = await dist("/_headers");
  for (const [name, value] of SECURITY_HEADERS) expect(headers).toContain(`  ${name}: ${value}`);
  expect(headers.startsWith("/*\n")).toBe(true);
});

test("a preview build tells search engines to stay away; the public build does not", () => {
  expect(headersFile(true)).toContain("X-Robots-Tag: noindex, nofollow");
  expect(headersFile(false)).not.toContain("X-Robots-Tag");
  const out = Bun.spawnSync(["bun", "src/site/build.ts"], { env: { ...process.env, SITE_ORIGIN: "https://some-preview.someone.workers.dev", OUT_DIR: "dist-test-preview" } });
  expect(out.exitCode).toBe(0);
  expect(out.stdout.toString()).toContain("preview, noindex");
});

test("a preview build is marked noindex in its headers, its pages and its robots file", async () => {
  const at = (path: string) => Bun.file(`dist-test-preview${path}`).text();
  expect(await at("/_headers")).toContain("X-Robots-Tag: noindex, nofollow");
  expect(await at("/robots.txt")).toBe("User-agent: *\nDisallow: /\n");
  expect(await at("/index.html")).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(await Bun.file("dist-test-preview/sitemap.xml").exists()).toBe(false);
});

test("pages carry no inline script, no inline style and nothing from another host", async () => {
  for (const path of PAGES) {
    const html = await dist(path);
    expect(/\sstyle=|<style|\son[a-z]+=|javascript:/i.test(html)).toBe(false);
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    for (const tag of scripts) expect(tag === '<script type="module" src="/assets/app.js">' || tag === '<script type="application/json" id="example-report">').toBe(true);
    const hosts = [...html.matchAll(/(?:src|href|action)="(https?:)?\/\/([^/"]+)/g)].map((m) => m[2]);
    // Links out go to the source repository only; the page's own address appears in its canonical link.
    for (const host of hosts) expect(["github.com", "bragproof.smaverk.com"]).toContain(host ?? "");
    // Nothing is loaded from another host: every script, stylesheet, typeface and picture address starts with "/".
    expect(/<(?:script|img|source|video|audio)[^>]+src="(?!\/[^/])/i.test(html)).toBe(false);
    expect(/<link rel="(?:stylesheet|preload|icon)"[^>]+href="(?!\/[^/])/i.test(html)).toBe(false);
    expect(/<img|<iframe|<form|<object|<embed/i.test(html)).toBe(false);
  }
  expect(/url\(\s*["']?(https?:)?\/\/|@import/.test(await dist("/assets/site.css"))).toBe(false);
});

test("the page script has no way to send, store or inject", async () => {
  const js = await dist("/assets/app.js");
  for (const banned of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "trustedTypes", "createPolicy", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "importScripts", "serviceWorker"]) expect(js.includes(banned) ? banned : "").toBe("");
  expect(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(js)).toBe(false);
});

test("the example on the first screen is what the reader really gives for the example file", async () => {
  const html = await dist("/index.html");
  const stored = JSON.parse(/<script type="application\/json" id="example-report">(.*?)<\/script>/s.exec(html)?.[1] ?? "{}");
  const fresh = await analyze(await dist("/example-session.jsonl"));
  expect(stored).toEqual(fresh);
  expect(html).toContain(fresh.id);
  expect(fresh.findings.map((f) => f.rule)).toEqual(["installed-package", "lint-off", "secret-read", "test-skipped", "commit-no-verify", "force-push"]);
  // Every rule the example shows was seen in real sessions: nothing on the first screen is unmeasured.
  for (const f of fresh.findings) expect(Object.keys(measured.rules)).toContain(f.rule);
  // It opens on the finding that sits against "All tests pass": the skipped test.
  expect(/class="row is-on"[^>]*data-i="3"/.test(html)).toBe(true);
  expect(html).toContain("A made-up session");
  expect(html).toContain("Example session");
});

test("every rule that can report is described on the method page, and the switched-off rule is said to be off", async () => {
  const described = new Set(RULE_TEXT.map((r) => r.id));
  const emitted = new Set<string>();
  for await (const file of new Glob("src/core/rules-*.ts").scan(".")) for (const m of (await Bun.file(file).text()).matchAll(/(?:\["([a-z-]+)", "(?:skipped|off|config|secrets|outside|undo|hidden)"|add\("([a-z-]+)"|rule: "([a-z-]+)"|"((?:ran|installed)-package)")/g)) emitted.add(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  expect(emitted.size).toBeGreaterThan(20);
  for (const rule of emitted) expect(described.has(rule) ? "" : rule).toBe("");
  for (const rule of Object.keys(measured.rules)) expect(described.has(rule) || SWITCHED_OFF.has(rule) ? "" : rule).toBe("");
  const method = await dist("/method/index.html");
  expect(method).toContain("switched off");
  expect(method).toContain(RULES);
});

test("numbers on the pages are the ones in the measurement file", async () => {
  const home = await dist("/index.html");
  const method = await dist("/method/index.html");
  expect(home).toContain(`How often it showed up in ${measured.read} public sessions`);
  expect(home).toContain("Other people&#39;s rates will differ.".replace("&#39;", "'"));
  expect(method).toContain("How much the rules miss was not measured.");
  expect(method).toContain("records directly");
  expect(home).toContain("its rules recognise");
  for (const page of [home, method]) expect(/beyond doubt|How often agents do this/.test(page)).toBe(false);
  // The neutral rules are counted in their own row, apart from "skipped" and "switched off".
  expect(home).toContain("Settings and pipelines touched");
  expect(measured.groups.config.sessions).toBeGreaterThan(0);
  expect(home).toContain(`${measured.anyShown.sessions} of them (${measured.anyShown.percent.toFixed(1)}%)`);
  expect(home).toContain(`${measured.notInDiff.sessions} (${measured.notInDiff.percent.toFixed(1)}%)`);
  expect(method).toContain(`${measured.k1.sessions} of the ${measured.read} (${measured.k1.percent.toFixed(1)}%)`);
  expect(method).toContain(`${READ_BY_HAND.primary.held} of ${READ_BY_HAND.primary.read}`);
  expect(method).toContain(`${READ_BY_HAND.said.heldAtMost} of ${READ_BY_HAND.said.read}`);
  expect(method).toContain(measured.commit.slice(0, 7));
});

test("the home page says what it has to in under 240 words, not counting the report itself", async () => {
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = /<main[^>]*>([\s\S]*)<\/main>/.exec(await dist("/index.html"))?.[1] ?? "";
    for (const el of document.querySelectorAll("#panel, #ledger, #fingerprint, table, script, #paste")) el.remove();
    const words = (document.body.textContent ?? "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    expect(words.length).toBeGreaterThan(80);
    expect(words.length).toBeLessThanOrEqual(240);
  } finally {
    await GlobalRegistrator.unregister();
  }
});

test("no wording that promises more than the page can know", async () => {
  for (const path of PAGES) {
    const text = (await dist(path)).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    expect(/\b(never|forever|guarantee[sd]?|100% (safe|secure)|trust score|verified safe|certif(y|ied))\b/i.exec(text)?.[0] ?? "").toBe("");
  }
});

test("no source file grows past 250 lines: one module per area", async () => {
  for (const pattern of ["src/**/*.ts", "scripts/**/*.ts", "e2e/**/*.ts"]) {
    for await (const file of new Glob(pattern).scan(".")) {
      const lines = (await Bun.file(file).text()).split("\n").length;
      expect(`${file}: ${lines <= 250 ? "ok" : `${lines} lines`}`).toBe(`${file}: ok`);
    }
  }
});

test("the worker configs have no server code, no bindings and the preview has no public route", async () => {
  const strip = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  const preview = strip(await Bun.file("wrangler.preview.jsonc").text());
  const live = strip(await Bun.file("wrangler.jsonc").text());
  for (const config of [preview, live]) {
    expect(config.main).toBeUndefined();
    for (const binding of ["d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "services", "vars", "ai", "queues"]) expect(config[binding]).toBeUndefined();
  }
  expect(preview.routes).toBeUndefined();
  expect(preview.workers_dev).toBe(true);
  expect(preview.name).not.toBe(live.name);
});
