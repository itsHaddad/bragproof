// Builds the whole site into dist/: three pages, one script, one stylesheet, one typeface, the example log, and the
// headers file that carries the security policy. There is no server code: what is in dist/ is all there is.

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyze } from "../core/analyze.ts";
import { exampleLog } from "./example-log.ts";
import { headersFile } from "./headers.ts";
import { isPreview, page, SITE } from "./layout.ts";
import { home, method, notFound } from "./pages.ts";
import { tokensCss } from "./tokens.ts";

const CSS_PARTS = ["base.css", "site.css", "report.css", "motion.css"] as const;
const root = join(import.meta.dir, "..", "..");
const dist = join(root, process.env.OUT_DIR ?? "dist");
const origin = (process.env.SITE_ORIGIN ?? SITE.origin).replace(/\/$/, "");

async function write(path: string, content: string | Uint8Array): Promise<void> {
  const file = join(dist, path);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, content);
}

await rm(dist, { recursive: true, force: true });

// The report on the page is made from the exact bytes of the file that is served, so anyone can reproduce its id.
const log = `${exampleLog()}\n`;
const example = await analyze(log);
await write("/example-session.jsonl", log);

const DESCRIPTION = "Reads a coding agent's session log on your device and lists what the diff does not show: checks skipped, key files opened, code brought in. No upload, no score.";
await write("/index.html", page({ path: "/", title: `${SITE.name}: what the agent did that the diff does not show`, description: DESCRIPTION, tab: "read", script: true }, home(example, origin), origin));
await write("/method/index.html", page({ path: "/method/", title: `Method and limits | ${SITE.name}`, description: "The rules, how often they fire on public sessions, how precise they measured, and what a clean report does not prove.", tab: "method", script: true }, method(origin), origin));
await write("/404.html", page({ path: "/404", title: `Page not found | ${SITE.name}`, description: "No page at this address.", tab: "none", script: false }, notFound(), origin));

const built = await Bun.build({ entrypoints: [join(root, "src/ui/main.ts")], target: "browser", format: "esm", minify: true });
if (!built.success) throw new AggregateError(built.logs, "Could not build the page script");
await write("/assets/app.js", await built.outputs[0]!.text());

const sheets = await Promise.all(CSS_PARTS.map((name) => Bun.file(join(root, "src/site/css", name)).text()));
await write(SITE.stylesheet, [tokensCss(), ...sheets].join("\n"));
await write("/assets/display.woff2", new Uint8Array(await Bun.file(join(root, "node_modules/@fontsource-variable/martian-mono/files/martian-mono-latin-wdth-normal.woff2")).arrayBuffer()));
await write("/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0e1420"/><path d="M5 19V9M9 19V6M13 19v-7M17 19V8" stroke="#eef2fb" stroke-width="2" stroke-linecap="round"/><path d="M17 1.8 19.4 4.2 17 6.6 14.6 4.2Z" fill="#ff9d8f"/></svg>\n`);

const preview = isPreview(origin);
await write("/robots.txt", preview ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
if (!preview) await write("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${origin}/</loc></url>\n<url><loc>${origin}/method/</loc></url>\n</urlset>\n`);
await write("/_headers", headersFile(preview));

// Which commit this build was made from, so a measurement of a deployed address can say what it measured.
const git = (...args: string[]) => Bun.spawnSync(["git", "-C", root, ...args], { stdin: "pipe" }).stdout.toString().trim();
const commit = process.env.GITHUB_SHA ?? git("rev-parse", "HEAD");
await write("/build.txt", `${commit || "unknown"}${git("status", "--porcelain") ? "+changes" : ""}\n`);

console.log(`Built 3 pages for ${origin} (${preview ? "preview, noindex" : "public"}). Example report ${example.id.slice(0, 12)}, ${example.findings.length} findings.`);
