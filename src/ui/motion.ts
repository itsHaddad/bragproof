// Webdesign motion helpers. Plain TypeScript, no dependency, about 1 KB minified. Pair with motion.css.
// Every helper does nothing harmful when scripts are late or motion is reduced: the page is already readable.

export const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Lets [data-reveal] elements build when they scroll into view. Only elements still below the screen are made to wait
 * (class "wait"); anything already visible is left alone, so a late script never makes the page blink.
 */
export function reveals(root: ParentNode = document): void {
  if (reduced() || !("IntersectionObserver" in globalThis)) return;
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("wait");
        seen.unobserve(entry.target);
      }
    },
    { threshold: 0.25 },
  );
  for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
    if (el.getBoundingClientRect().top < innerHeight * 0.9) continue;
    // Order of the building children, read by CSS as --n. Set through the style object, which a strict content policy allows.
    for (const [n, child] of [...el.querySelectorAll<HTMLElement | SVGElement>("[data-pop]")].entries()) child.style.setProperty("--n", String(n));
    el.classList.add("wait");
    seen.observe(el);
  }
}

/** Counts a number up to its final value. The final text is in the HTML already, so nothing shifts and nothing is lost without scripts. */
export function countUp(el: HTMLElement, ms = 900): void {
  const final = el.textContent ?? "";
  const match = /-?\d+(?:[.,]\d+)?/.exec(final);
  if (!match || reduced()) return;
  const raw = match[0];
  const decimals = (raw.split(/[.,]/)[1] ?? "").length;
  const comma = raw.includes(",");
  const target = Number(raw.replace(",", "."));
  el.style.fontVariantNumeric = "tabular-nums";
  const start = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 4;
    const shown = (target * eased).toFixed(decimals);
    el.textContent = final.replace(raw, comma ? shown.replace(".", ",") : shown);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = final;
  };
  requestAnimationFrame(frame);
}

/** Swaps content inside a view transition where the browser has them; otherwise swaps at once. Keep `swap` synchronous. */
export function swapView(swap: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (reduced() || typeof doc.startViewTransition !== "function") swap();
  else doc.startViewTransition(swap);
}

/** Restarts a one-shot CSS animation class (for example .nudge on an invalid field, .screen-in on a new screen). */
export function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  // Reading a layout value makes the browser notice the class was gone.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** An interactive hero or demo: calls `draw` with a 0..1 value from a range input, buttons or arrow keys. No drag-only control. */
export function scrub(input: HTMLInputElement, draw: (value: number) => void): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const update = () => draw((Number(input.value) - min) / (max - min || 1));
  input.addEventListener("input", update);
  update();
}
