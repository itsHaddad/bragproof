// Text from a log can carry characters that hide, reorder or smuggle text: bidirectional controls that make
// a line read differently from what it is, zero-width characters, and Unicode "tag" characters that are
// invisible to a person and readable by a model. Before anything is shown they are replaced by a visible
// code, so what a person reads is what is there.

const HIDING = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­؜​-‏‪-‮⁠-⁩﻿￹-￻]|\udb40[\udc00-\udc7f]/g;

const code = (ch: string): string => `⟨U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟩`;

/** The text with every hiding character made visible. */
export function visible(text: string): string {
  return text.replace(HIDING, code);
}

/** One line of at most `max` characters, hiding characters made visible, for quoting as evidence. */
export function quote(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = [...flat].slice(0, max).join("");
  return visible(cut) + (cut.length < flat.length ? "…" : "");
}

const TAGS = /\udb40[\udc20-\udc7e]/g;
const ZERO_WIDTH_RUN = /[​-‍⁠﻿]{8,}/;

/** Text written in invisible tag characters, decoded to the letters it spells; empty when there is none. */
export function taggedText(text: string): string {
  const found = text.match(TAGS);
  if (!found || found.length < 4) return "";
  return found.map((ch) => String.fromCodePoint((ch.codePointAt(0) ?? 0) - 0xe0000)).join("");
}

export const hasZeroWidthRun = (text: string): boolean => ZERO_WIDTH_RUN.test(text);
export const hasBidiOverride = (text: string): boolean => /[‪-‮⁦-⁩]/.test(text);
