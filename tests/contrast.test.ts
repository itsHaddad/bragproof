// Text must reach 4.5:1 and control borders 3:1 against what they sit on, in both themes.
import { expect, test } from "bun:test";
import { DARK, LIGHT } from "../src/site/tokens.ts";

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as Rgb;
const lum = ([r, g, b]: Rgb): number => {
  const f = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const TEXT_PAIRS: [string, string][] = [
  ["text", "bg"], ["text", "surface"], ["text", "surface-2"], ["text", "accent-soft"],
  ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"],
  ["accent", "bg"], ["accent", "surface"], ["on-accent", "accent"],
  ["mark", "surface"], ["mark", "surface-2"], ["mark", "bg"], ["danger", "bg"], ["danger", "surface"],
];
const EDGE_PAIRS: [string, string][] = [["field-line", "surface"], ["field-line", "bg"], ["accent", "surface"], ["focus", "bg"], ["focus", "surface"]];

for (const [name, set] of [["light", LIGHT], ["dark", DARK]] as const) {
  const colour = (key: string) => (set as Record<string, string>)[key] ?? "";
  test(`${name}: text reaches 4.5:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) expect(`${fg} on ${bg}: ${ratio(colour(fg), colour(bg)) >= 4.5 ? "ok" : ratio(colour(fg), colour(bg)).toFixed(2)}`).toBe(`${fg} on ${bg}: ok`);
  });
  test(`${name}: control borders and focus rings reach 3:1`, () => {
    for (const [fg, bg] of EDGE_PAIRS) expect(`${fg} on ${bg}: ${ratio(colour(fg), colour(bg)) >= 3 ? "ok" : ratio(colour(fg), colour(bg)).toFixed(2)}`).toBe(`${fg} on ${bg}: ok`);
  });
}

test("both themes define the same tokens", () => {
  expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
});
