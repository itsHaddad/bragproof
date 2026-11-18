// What the runner's parts share: the address, the list of failures, and how a page is watched and read.
import type { Browser, BrowserContext, Page } from "playwright";
import type { State } from "./states.ts";

export const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("Set BASE_URL");
export const OUT = "e2e-shots/gate";
export const failures: string[] = [];
export const report: Record<string, unknown> = {};
export const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
export const PAGES = ["/", "/method/", "/no-such-page"];
export const SIZES = [[390, 844], [1280, 800]] as const;

/** Everything that would count against line 20: page errors, console errors, failed requests, policy violations, dialogs. */
export function watch(page: Page, label: string): { requests: string[] } {
  const seen = { requests: [] as string[] };
  page.on("pageerror", (e) => failures.push(`${label}: page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !(page.url().includes("no-such-page") && m.text().includes("404"))) failures.push(`${label}: console error: ${m.text()}`);
  });
  page.on("requestfailed", (r) => failures.push(`${label}: request failed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("no-such-page")) failures.push(`${label}: ${r.status()} ${r.url()}`);
  });
  page.on("request", (r) => seen.requests.push(r.url()));
  page.on("dialog", (d) => {
    failures.push(`${label}: a dialog opened: ${d.message()}`);
    void d.dismiss();
  });
  return seen;
}

export async function context(browser: Browser, width: number, height: number, scheme: "light" | "dark", still = true): Promise<BrowserContext> {
  const made = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: still ? "reduce" : "no-preference", isMobile: width < 500, hasTouch: width < 500, serviceWorkers: "block" });
  await made.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return made;
}

export const layout = (page: Page) =>
  page.evaluate(() => {
    const small: [number, string][] = [];
    for (const el of document.querySelectorAll<HTMLElement | SVGElement>("body *")) {
      if (el.children.length > 0 || !(el.textContent ?? "").trim() || el.closest(".visually-hidden, script")) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const size = Math.round(Number.parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
      if (size < 14) small.push([size, (el.textContent ?? "").trim().slice(0, 16)]);
    }
    const short = [...document.querySelectorAll<HTMLElement>("button, a.btn, a.tab, .foot-links a, a.more, main p a, main li a, input[type=range], textarea")].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().height)}`);
    const long = [...document.querySelectorAll<HTMLElement>("main p, main li")].filter((el) => el.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(el).fontSize) > 42).map((el) => (el.textContent ?? "").slice(0, 20));
    return { wide: document.documentElement.scrollWidth > window.innerWidth + 1, small: small.slice(0, 6), short: short.slice(0, 6), long: long.slice(0, 4), csp: (window as unknown as { __csp: string[] }).__csp };
  });

/** Chooses a file the way a person does and waits for the page to answer. */
export async function choose(page: Page, state: State): Promise<void> {
  await page.setInputFiles("#file", { name: state.file, mimeType: "application/jsonl", buffer: Buffer.from(state.text) });
  if (state.expect === "error") await page.waitForSelector("#error:not([hidden])");
  else await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Read "));
}
