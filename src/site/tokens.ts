// Colour tokens, written once and turned into the three blocks the stylesheet needs (light, dark by device, dark by
// choice), so the two dark copies cannot drift. The palette comes from the subject: a carbon-copy duplicate book.
// Paper and ink, the blue of the carbon, a red pencil for what the inspector marks, and at night the page turns
// into the carbon sheet itself with a highlighter for the accent.

export const LIGHT = {
  bg: "#f3f5f8",
  surface: "#ffffff",
  "surface-2": "#e8ecf2",
  text: "#0e1420",
  muted: "#4a5466",
  line: "rgb(14 20 32 / 0.12)",
  "field-line": "#667085",
  accent: "#1f3fcc",
  "on-accent": "#ffffff",
  "accent-soft": "#e2e8fd",
  mark: "#b42318",
  "mark-soft": "#fde9e6",
  good: "#0f7a4d",
  warn: "#8a5a00",
  danger: "#b42318",
  focus: "#1f3fcc",
  "shadow-float": "0 1px 2px rgb(14 20 32 / 0.06), 0 12px 32px -8px rgb(14 20 32 / 0.18)",
} as const;

export const DARK: Record<keyof typeof LIGHT, string> = {
  bg: "#090d18",
  surface: "#10162a",
  "surface-2": "#1a223a",
  text: "#eef2fb",
  muted: "#a6b0c6",
  line: "rgb(238 242 251 / 0.13)",
  "field-line": "#7f8aa5",
  accent: "#f3e45c",
  "on-accent": "#15160a",
  "accent-soft": "#2f2d14",
  mark: "#ff9d8f",
  "mark-soft": "#3a1814",
  good: "#5fd3a0",
  warn: "#ffd98a",
  danger: "#ff9d8f",
  focus: "#f3e45c",
  "shadow-float": "0 1px 2px rgb(0 0 0 / 0.5), 0 16px 40px -8px rgb(0 0 0 / 0.7)",
};

const block = (set: Record<string, string>): string => Object.entries(set).map(([k, v]) => `--${k}: ${v};`).join(" ");

export function tokensCss(): string {
  return [
    `:root { color-scheme: light dark; ${block(LIGHT)} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block(DARK)} } }`,
    `:root[data-theme="dark"] { color-scheme: dark; ${block(DARK)} }`,
    `:root[data-theme="light"] { color-scheme: light; }`,
  ].join("\n");
}
