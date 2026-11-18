// The marks. Every kind of finding has its own shape, drawn in a 12-unit box, so kinds are told apart without colour.

import type { Group } from "../core/groups.ts";
import { type El, h } from "./h.ts";

const SHAPES: Record<Group["shape"], string> = {
  diamond: "M6 0.8 11.2 6 6 11.2 0.8 6Z",
  square: "M1.5 1.5H10.5V10.5H1.5Z",
  key: "M4 1.2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM5.6 6.4 10.8 11.6H8.6V9.8H7.2V8Z",
  down: "M4.2 1H7.8V6H11L6 11.4 1 6H4.2Z",
  cross: "M2.4 0.8 6 4.4 9.6 0.8 11.2 2.4 7.6 6 11.2 9.6 9.6 11.2 6 7.6 2.4 11.2 0.8 9.6 4.4 6 0.8 2.4Z",
  eye: "M6 2.2C9 2.2 11.2 6 11.2 6S9 9.8 6 9.8 0.8 6 0.8 6 3 2.2 6 2.2ZM6 4.2A1.8 1.8 0 1 0 6 7.8 1.8 1.8 0 0 0 6 4.2Z",
  quote: "M1 2H5.2V6.4L3.2 10H1.4L2.8 6.4H1ZM6.8 2H11V6.4L9 10H7.2L8.6 6.4H6.8Z",
};

/** The path of a shape, for placing on the tape. */
export const shapePath = (shape: Group["shape"]): string => SHAPES[shape];

/** A shape as a small picture beside text. */
export const mark = (shape: Group["shape"], cls = "mark"): El => h("svg", { class: cls, viewBox: "0 0 12 12", width: 14, height: 14, "aria-hidden": "true" }, h("path", { d: SHAPES[shape], "fill-rule": "evenodd" }));

const LINE: Record<string, string> = {
  file: "M6 2.5h7l5 5V21.5H6ZM13 2.5v5h5",
  paste: "M8 4.5H6v17h12v-17h-2M9 3h6v3H9ZM9 11h6M9 15h6",
  left: "M14.5 5.5 8 12l6.5 6.5",
  right: "M9.5 5.5 16 12l-6.5 6.5",
  copy: "M9 9h11v11H9ZM5 15H4V4h11v1",
  lock: "M6 11h12v9.5H6ZM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  note: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5.5M12 7.6v.4",
  rule: "M4 6h16M4 12h16M4 18h10",
};

/** A line icon, one stroke weight everywhere. */
export const icon = (name: keyof typeof LINE & string): El => h("svg", { class: "icon", viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true" }, h("path", { d: LINE[name] ?? "", fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round" }));

export const brandMark = (): El =>
  h("svg", { class: "brand-mark", viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true" }, h("path", { d: "M3 20V8M7 20V4M11 20v-9M15 20V6M19 20v-5", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }), h("path", { class: "brand-dot", d: "M15 0.5 17.5 3 15 5.5 12.5 3Z" }));
