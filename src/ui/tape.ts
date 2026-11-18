// The tape: every step of the session as a tick on one line, left to right in time, with a mark above each place
// a finding sits. Tick height says what kind of step it was. No text is drawn inside the picture, so nothing in it
// shrinks below a readable size on a phone; the words are in the page beside it.

import { groupOf } from "../core/groups.ts";
import type { Report } from "../core/types.ts";
import { type El, h } from "./h.ts";
import { shapePath } from "./icons.ts";

export const TAPE = { width: 360, height: 76, base: 70, columns: 120 } as const;
const HEIGHT: Record<string, number> = { s: 26, e: 18, f: 14, r: 10, o: 6 };

/** The column a step falls in. */
export function columnOf(step: number, steps: number): number {
  const columns = Math.min(TAPE.columns, Math.max(steps, 1));
  return Math.min(columns - 1, Math.max(0, Math.floor(((Math.max(step, 1) - 1) / Math.max(steps, 1)) * columns)));
}

const centre = (column: number, steps: number): number => {
  const columns = Math.min(TAPE.columns, Math.max(steps, 1));
  return Math.round(((column + 0.5) * TAPE.width * 10) / columns) / 10;
};

export const cursorAt = (step: number, steps: number): string => `translate(${centre(columnOf(step, steps), steps)} 0)`;

export function tape(report: Report, selected: number): El {
  const { steps, track } = report.session;
  const columns = Math.min(TAPE.columns, Math.max(steps, 1));
  // The tallest kind in a column stands for it; a column with a failed step is drawn with a notch.
  const tall = new Array<number>(columns).fill(0);
  const failed = new Array<boolean>(columns).fill(false);
  for (let i = 0; i < track.length; i++) {
    const c = columnOf(i + 1, steps);
    const letter = track[i] ?? "o";
    tall[c] = Math.max(tall[c] ?? 0, HEIGHT[letter.toLowerCase()] ?? 6);
    if (letter !== letter.toLowerCase()) failed[c] = true;
  }
  const ticks = tall.map((height, c) => h("rect", { class: failed[c] ? "tick tick-failed" : "tick", x: centre(c, steps) - 0.8, y: TAPE.base - height, width: 1.6, height: Math.max(height, 2), rx: 0.8 }));
  const stacked = new Map<number, number>();
  const marks = report.findings.map((f, i) => {
    const c = columnOf(f.step, steps);
    const level = stacked.get(c) ?? 0;
    stacked.set(c, level + 1);
    if (level > 2) return false;
    const x = centre(c, steps) - 4.5;
    const y = 30 - level * 11;
    return h("path", { class: i === selected ? "tape-mark is-on" : "tape-mark", "data-i": i, d: shapePath(groupOf(f.group).shape), "fill-rule": "evenodd", transform: `translate(${x} ${y}) scale(0.75)` });
  });
  const cursor = report.findings[selected];
  return h(
    "svg",
    { class: "tape", viewBox: `0 0 ${TAPE.width} ${TAPE.height}`, role: "img", "aria-label": `${steps} steps in order. ${report.findings.length} marked.` },
    h("rect", { class: "tape-base", x: 0, y: TAPE.base + 2, width: TAPE.width, height: 1 }),
    h("g", { class: "tape-ticks wipe" }, ...ticks),
    h("rect", { class: cursor ? "tape-cursor" : "tape-cursor is-off", x: -0.5, y: 2, width: 1, height: TAPE.base, transform: cursorAt(cursor?.step ?? 1, steps) }),
    h("g", { class: "tape-marks" }, ...marks),
  );
}
