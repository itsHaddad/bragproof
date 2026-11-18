// The measurements a browser tab on a laptop cannot make, and the ones that are counted rather than judged.
import type { Browser } from "playwright";
import { BASE, check, choose, context, OUT, report, SIZES, watch } from "./shared.ts";
import { gateStates } from "./states.ts";

/** Largest paint and layout shift on a phone profile, and the bytes on the wire for the first view. */
export async function paintAndTransfer(browser: Browser): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const path of ["/", "/method/"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, `paint ${path}`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    // A mid-range phone on a slow connection: four times slower processor, 1.6 Mbit/s down, 150 ms delay.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const wire: Record<string, number> = {};
    const kinds = new Map<string, string>();
    const hosts = new Set<string>();
    cdp.on("Network.responseReceived", (e) => {
      kinds.set(e.requestId, e.type);
      hosts.add(new URL(e.response.url).host);
    });
    cdp.on("Network.loadingFinished", (e) => {
      const kind = kinds.get(e.requestId) ?? "Other";
      wire[kind] = (wire[kind] ?? 0) + e.encodedDataLength;
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp: number; __cls: number };
      w.__lcp = 0;
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) w.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE + path, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    if (path === "/") {
      // Through an interaction too: stepping to the next finding and reading a log must not shift the page on its own.
      await page.click("[data-step='1']");
      await page.waitForTimeout(600);
    }
    const { lcp, cls } = await page.evaluate(() => ({ lcp: Math.round((window as unknown as { __lcp: number }).__lcp), cls: Math.round((window as unknown as { __cls: number }).__cls * 1000) / 1000 }));
    const code = (wire.Document ?? 0) + (wire.Stylesheet ?? 0) + (wire.Script ?? 0);
    const font = wire.Font ?? 0;
    rows.push({ path, lcpMs: lcp, layoutShift: cls, pagesStylesScriptsBytes: code, typefaceBytes: font, byKind: wire, hosts: [...hosts] });
    check(lcp > 0 && lcp < 2500, `paint ${path}: largest paint ${lcp} ms on the phone profile (under 2500)`);
    check(cls < 0.05, `paint ${path}: layout shift ${cls} (under 0.05)`);
    check(code < 120_000, `transfer ${path}: pages + styles + scripts ${code} bytes on the wire (under 120000)`);
    check(font > 0 && font < 60_000, `transfer ${path}: typeface ${font} bytes, one file (under 60000)`);
    check(hosts.size === 1 && hosts.has(new URL(BASE).host), `transfer ${path}: every request went to this address only ${JSON.stringify([...hosts])}`);
    await ctx.close();
  }
  report.paintAndTransfer = rows;
}

/** Lines 1 and 2: at 390 px the working panel is at least 60% inside the first screen and so is the whole primary button. */
export async function firstScreen(browser: Browser): Promise<void> {
  const ctx = await context(browser, 390, 844, "light", false);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const first = await page.evaluate(() => {
    const visual = document.querySelector(".panel-main")?.getBoundingClientRect();
    const tape = document.querySelector("svg.tape")?.getBoundingClientRect();
    const button = document.querySelector("#choose")?.getBoundingClientRect();
    const inside = visual ? Math.max(0, Math.min(visual.bottom, window.innerHeight) - Math.max(visual.top, 0)) / visual.height : 0;
    return { inside: Math.round(inside * 100), tapeBottom: Math.round(tape?.bottom ?? 9999), buttonBottom: Math.round(button?.bottom ?? 9999), buttonHeight: Math.round(button?.height ?? 0), primaries: document.querySelectorAll("main .btn-primary").length };
  });
  check(first.inside >= 60 && first.tapeBottom <= 844, `first screen: ${first.inside}% of the working panel and the whole tape (bottom ${first.tapeBottom}) inside 844 px`);
  check(first.buttonBottom <= 844 && first.buttonHeight >= 44, `first screen: the primary button (bottom ${first.buttonBottom}, ${first.buttonHeight} px high) is inside 844 px`);
  check(first.primaries === 1, `first screen: one primary button in the view (${first.primaries})`);
  const marks = await page.evaluate(() => [...document.querySelectorAll(".tape-mark")].map((el) => Math.round(el.getBoundingClientRect().width * 10) / 10));
  check(marks.length > 0 && Math.min(...marks) >= 10, `first screen: tape marks are at least 10 px wide at 390 (${Math.min(...marks)})`);
  const short = await page.evaluate(() => (document.querySelector(".where-short")?.getBoundingClientRect().top ?? 9999) < (document.querySelector(".panel-main")?.getBoundingClientRect().top ?? 0));
  check(short, "first screen: \"Read on this device, sent nowhere\" sits between the buttons and the panel");
  await page.goto(`${BASE}/method/`, { waitUntil: "load" });
  const rules = await page.evaluate(() => {
    const wrap = document.querySelector(".rules-wrap") as HTMLElement;
    const cells = [...document.querySelectorAll(".rules-full td")].map((el) => el.getBoundingClientRect().right);
    return { inner: wrap.scrollWidth - wrap.clientWidth, right: Math.round(Math.max(...cells)), view: window.innerWidth };
  });
  // With motion on: scrolled to, the long table must come out of waiting although it is taller than the screen.
  await page.evaluate(() => document.querySelector("#h-rules")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(900);
  const shown = await page.evaluate(() => ({ waiting: document.querySelector(".rules-wrap")?.classList.contains("wait"), opacity: getComputedStyle(document.querySelector(".rules-wrap") as Element).opacity }));
  check(shown.waiting === false && Number(shown.opacity) > 0.95, `method at 390: the rules table shows once scrolled to ${JSON.stringify(shown)}`);
  check(rules.inner <= 1 && rules.right <= rules.view, `method at 390: the rules table fits with no inner sideways scroll (overflow ${rules.inner}, right edge ${rules.right} of ${rules.view})`);
  report.firstScreen = first;
  await ctx.close();
}

/** Line 16: the whole path with the keyboard. Every stop shows a focus ring and is on screen. */
export async function keyboard(browser: Browser): Promise<void> {
  const ctx = await context(browser, 390, 844, "light");
  const page = await ctx.newPage();
  watch(page, "keyboard");
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForSelector("html.js");
  const stops: string[] = [];
  const bad: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { name: el.id || el.className || el.tagName, ring: style.outlineStyle !== "none" || style.boxShadow !== "none", onScreen: box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.width > 0 };
    });
    if (!at) continue;
    stops.push(at.name);
    if (!at.ring || !at.onScreen) bad.push(`${at.name} ring=${at.ring} onScreen=${at.onScreen}`);
  }
  check(stops[0] === "skip", `keyboard: the first stop is the skip link (${stops[0]})`);
  for (const need of ["choose", "paste-open", "scrub", "copy-id"]) check(stops.includes(need), `keyboard: Tab reaches #${need}`);
  check(stops.some((s) => s.startsWith("row")), "keyboard: Tab reaches the rows of the ledger");
  check(!stops.includes("file"), "keyboard: the hidden file input is not a stop of its own");
  check(bad.length === 0, `keyboard: every stop shows a focus ring and is on screen ${JSON.stringify(bad.slice(0, 5))}`);
  // Arrow keys on the range move through findings; Enter on a row picks it; Space on the paste button opens the field.
  await page.focus("#scrub");
  await page.keyboard.press("ArrowRight");
  const moved = await page.evaluate(() => ({ value: (document.querySelector("#scrub") as HTMLInputElement).value, text: document.querySelector("#readout")?.textContent ?? "" }));
  check(moved.text.includes(`Step ${moved.value} of 34`) && moved.text.includes("No rule matched this step"), `keyboard: the right arrow on the slider reads the next step, finding or not (step ${moved.value})`);
  await page.focus(".row[data-i='4']");
  await page.keyboard.press("Enter");
  check((await page.textContent(".readout-count")) === "5 of 6" && (await page.getAttribute(".row[data-i='4']", "aria-pressed")) === "true", "keyboard: Enter on a row shows that finding");
  await page.focus("button.count[data-group='undo']");
  await page.keyboard.press("Enter");
  check((await page.textContent(".readout-count")) === "6 of 6", "keyboard: Enter on a count goes to the first finding of that kind");
  const box = await page.locator("#tape").boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.02, box.y + box.height * 0.8);
  check(((await page.textContent("#readout")) ?? "").includes("Step 1 of 34"), "tape: pressing a tick reads that step");
  await page.focus("#paste-open");
  await page.keyboard.press("Space");
  check((await page.evaluate(() => document.activeElement?.id)) === "paste-text", "keyboard: Space opens the paste field and moves to it");
  const labelled = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("input:not([type=file]), textarea")].filter((el) => !el.getAttribute("aria-label") && !document.querySelector(`label[for="${el.id}"]`)).length);
  check(labelled === 0, "keyboard: every field has a label");
  await ctx.close();
}

/** Lines 8, 11 and 22: the load moment exists, eases out, leaves text readable within a second; two frames of it are kept. */
export async function motion(browser: Browser): Promise<void> {
  for (const [width, height] of SIZES) {
    const ctx = await context(browser, width, height, "dark", false);
    const page = await ctx.newPage();
    watch(page, `motion ${width}`);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector("h1");
    await page.waitForTimeout(200);
    const early = await page.evaluate(() => ({ running: document.getAnimations().filter((a) => a.playState === "running").length, bad: document.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k))).filter((p) => !["offset", "easing", "composite", "computedOffset", "opacity", "transform", "clipPath", "scale", "strokeDashoffset", "fill", "backgroundColor", "borderColor", "color"].includes(p)) }));
    await page.screenshot({ path: `${OUT}/motion-${width}-during-load.jpg`, type: "jpeg", quality: 70 });
    check(early.running >= 4, `motion ${width}: the load moment is running at 200 ms (${early.running} animations)`);
    check(early.bad.length === 0, `motion ${width}: only transform, opacity, clip-path and colour are animated ${JSON.stringify([...new Set(early.bad)])}`);
    await page.waitForTimeout(800);
    const readable = await page.evaluate(() => ["h1", ".lead", "#choose"].map((s) => Number(getComputedStyle(document.querySelector(s) as Element).opacity)));
    check(readable.every((o) => o > 0.95), `motion ${width}: headline, lead and primary button are readable 1 s after the page starts ${JSON.stringify(readable)}`);
    await page.waitForTimeout(700);
    const settled = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    check(settled === 0, `motion ${width}: everything has settled by 1.7 s (${settled} still running)`);
    await page.screenshot({ path: `${OUT}/motion-${width}-after-load.jpg`, type: "jpeg", quality: 70 });
    await page.click("[data-step='1']");
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${OUT}/motion-${width}-mid-step.jpg`, type: "jpeg", quality: 70 });
    await choose(page, gateStates().find((s) => s.name === "full")!);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/motion-${width}-mid-read.jpg`, type: "jpeg", quality: 70 });
    await ctx.close();
  }
}

/** Lines 3, 4, 6 and 25: type scale, radii, shadows and the shared left edge, measured. */
export async function system(browser: Browser): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const [width, height] of SIZES) {
    const ctx = await context(browser, width, height, "light");
    const page = await ctx.newPage();
    for (const path of ["/", "/method/", "/no-such-page"]) {
      await page.goto(BASE + path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(() => {
        const px = (el: Element | null, prop: string) => Number.parseFloat(getComputedStyle(el as Element).getPropertyValue(prop));
        const h1 = document.querySelector("h1");
        const radii = new Set<string>();
        const shadows = new Set<string>();
        for (const el of document.querySelectorAll("body *")) {
          const s = getComputedStyle(el);
          if (s.borderTopLeftRadius !== "0px" && !el.closest("svg")) radii.add(s.borderTopLeftRadius);
          if (s.boxShadow !== "none") shadows.add(s.boxShadow);
        }
        const lefts = [".brand", "main h1", "main h2", ".foot p"].map((s) => Math.round(document.querySelector(s)?.getBoundingClientRect().left ?? -1)).filter((x) => x >= 0);
        return { h1: px(h1, "font-size"), body: px(document.body, "font-size"), track: px(h1, "letter-spacing") / px(h1, "font-size"), face: getComputedStyle(h1 as Element).fontFamily.split(",")[0], radii: [...radii], shadows: [...shadows], lefts, fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family) };
      });
      rows.push({ width, path, ...m });
      check(m.h1 / m.body >= (width < 500 ? 2 : 3), `type ${width} ${path}: h1 ${m.h1} px is ${(m.h1 / m.body).toFixed(2)}x body`);
      check(m.track <= 0 && m.track >= -0.04, `type ${width} ${path}: h1 tracking ${m.track.toFixed(3)}em`);
      check(m.face?.includes("Martian Mono") === true && m.fontsLoaded.length === 1, `type ${width} ${path}: display face is the one self-hosted file (${m.fontsLoaded.join(", ")})`);
      check(m.radii.length <= 3, `system ${width} ${path}: at most three radii ${JSON.stringify(m.radii)}`);
      check(m.shadows.length === 0, `system ${width} ${path}: no shadow at rest ${JSON.stringify(m.shadows)}`);
      check(new Set(m.lefts).size === 1, `grid ${width} ${path}: header, headings and footer share one left edge ${JSON.stringify(m.lefts)}`);
    }
    await ctx.close();
  }
  report.system = rows;
}
