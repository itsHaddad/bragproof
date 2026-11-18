// The frame every page shares: head, header with its two tabs, footer.

import { toHtml } from "../ui/h.ts";
import { brandMark, icon } from "../ui/icons.ts";
import { DARK, LIGHT } from "./tokens.ts";

export const SITE = { name: "Bragproof", origin: "https://bragproof.smaverk.com", repo: "https://github.com/itsHaddad/bragproof", stylesheet: "/assets/site.css" } as const;

export const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const isPreview = (origin: string): boolean => new URL(origin).hostname !== new URL(SITE.origin).hostname;

/** A file in the source repository. A preview links to the branch it was built from, the public site to main. */
export const sourceLink = (origin: string, file: string): string => `${SITE.repo}/${file ? "blob" : "tree"}/${isPreview(origin) ? "rethink-2026-11" : "main"}${file ? `/${file}` : ""}`;

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** Which tab is the current one. */
  tab: "read" | "method" | "none";
  script: boolean;
}

const tab = (href: string, name: Parameters<typeof icon>[0], label: string, current: boolean): string => `<li><a class="tab" href="${href}"${current ? ' aria-current="page"' : ""}>${toHtml(icon(name))}<span>${label}</span></a></li>`;

export function page(meta: PageMeta, body: string, origin: string): string {
  const url = `${origin}${meta.path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT.bg}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK.bg}">
${isPreview(origin) || meta.tab === "none" ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/display.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${SITE.stylesheet}">
${meta.script ? '<script type="module" src="/assets/app.js"></script>' : ""}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top"><div class="page">
<a class="brand vt-brand" href="/">${toHtml(brandMark())}<span>${SITE.name}</span></a>
<nav aria-label="Pages"><ul class="tabs">${tab("/", "file", "Read a log", meta.tab === "read")}${tab("/method/", "rule", "Method", meta.tab === "method")}</ul></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="foot"><div class="page">
<p>${SITE.name} reads a log and shows what is in it. It gives no score and no verdict, and a clean report is not proof of a clean session.</p>
<div>
<ul class="foot-links"><li><a href="/">Read a log</a></li><li><a href="/method/">Method and limits</a></li><li><a href="${sourceLink(origin, "")}">Source code</a></li><li><a href="${sourceLink(origin, "SECURITY.md")}">Security notes</a></li></ul>
<p>MIT licence. The example session is written by hand. The public-session figures come from SWE-chat, used under ODC-BY.</p>
</div>
</div></footer>
</body>
</html>
`;
}
