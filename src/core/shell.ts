// A small reader for shell commands: enough to tell `git commit --no-verify` from a commit message that
// mentions it. It splits a command line into simple commands and words, and remembers which words were
// quoted. It never runs anything. Where it cannot be sure it says less, not more.

export interface Word {
  text: string;
  quoted: boolean;
}

export interface Simple {
  /** NAME=value words in front of the command. */
  env: Record<string, string>;
  words: Word[];
  /** What joined this command to the next one: "&&", "||", ";", "|" or "". */
  next: string;
  raw: string;
}

const OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "\n"] as const;
const WRAPPERS = new Set(["sudo", "time", "nice", "nohup", "command", "exec", "env", "timeout", "xargs", "then", "do", "else", "!", "{", "("]);

/** Removes here-document bodies: they are data for the command, not commands. */
function withoutHeredocs(line: string): string {
  const out: string[] = [];
  let until = "";
  for (const row of line.split("\n")) {
    if (until) {
      if (row.trim() === until) until = "";
      continue;
    }
    out.push(row);
    const mark = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(row);
    if (mark) until = mark[2] ?? "";
  }
  return out.join("\n");
}

/** The simple commands of a command line, in order. Command substitutions are read as part of the line. */
export function simples(line: string): Simple[] {
  const text = withoutHeredocs(line.slice(0, 20_000));
  const found: Simple[] = [];
  let words: Word[] = [];
  let word = "";
  let quoted = false;
  let open = false;
  let start = 0;
  const endWord = () => {
    if (open) words.push({ text: word, quoted });
    word = "";
    quoted = false;
    open = false;
  };
  const endSimple = (next: string, at: number) => {
    endWord();
    if (words.length > 0) found.push(toSimple(words, next, text.slice(start, at).trim()));
    words = [];
    start = at + next.length;
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === "\\" && i + 1 < text.length) {
      if (text[i + 1] !== "\n") {
        word += text[i + 1];
        open = true;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const close = closing(text, i, ch);
      word += text.slice(i + 1, close);
      quoted = true;
      open = true;
      i = close + 1;
      continue;
    }
    if (ch === "#" && !open) {
      const eol = text.indexOf("\n", i);
      i = eol === -1 ? text.length : eol;
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") {
      endSimple("", i);
      i += 2;
      start = i;
      continue;
    }
    if (ch === ")" || ch === "`") {
      endSimple("", i);
      i += 1;
      start = i;
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op) {
      endSimple(op === "\n" ? ";" : op, i);
      i += op.length;
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      i += 1;
      continue;
    }
    word += ch;
    open = true;
    i += 1;
  }
  endSimple("", text.length);
  return found;
}

function closing(text: string, from: number, mark: string): number {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "\\" && mark === '"') i++;
    else if (text[i] === mark) return i;
  }
  return text.length;
}

function toSimple(all: Word[], next: string, raw: string): Simple {
  const env: Record<string, string> = {};
  let at = 0;
  for (;;) {
    const w = all[at];
    if (!w) break;
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(w.text);
    if (assign) {
      env[assign[1] ?? ""] = assign[2] ?? "";
      at++;
    } else if (!w.quoted && WRAPPERS.has(w.text)) {
      at++;
      // `timeout 30 cmd`, `nice -n 5 cmd`: step over the wrapper's own options and numbers.
      while (all[at] && !all[at]?.quoted && /^(-\S*|\d+[smhd]?)$/.test(all[at]?.text ?? "")) at++;
    } else break;
  }
  return { env, words: all.slice(at), next, raw };
}

/** The command name without its folder: "/usr/bin/git" is "git". */
export const name = (s: Simple): string => (s.words[0]?.text ?? "").replace(/^.*\//, "");

/** The words after the command name that the shell would pass as they are (quoted or not). */
export const args = (s: Simple): string[] => s.words.slice(1).map((w) => w.text);

/** True when one of the option words is `long`, or a bundle of short options containing the letter `short` ("-nm" has "n"). */
export function hasFlag(s: Simple, long: string, short = ""): boolean {
  for (const w of s.words.slice(1)) {
    if (w.text === "--") return false;
    if (w.text === long || w.text.startsWith(`${long}=`)) return true;
    if (short && /^-[A-Za-z]+$/.test(w.text) && w.text.includes(short)) return true;
  }
  return false;
}

/** For git: the subcommand and what follows it, past options like `-C dir` and `-c name=value`. */
export function git(s: Simple): { sub: string; rest: Word[]; config: string[] } | null {
  if (name(s) !== "git") return null;
  const config: string[] = [];
  let at = 1;
  for (;;) {
    const w = s.words[at]?.text ?? "";
    if (w === "-C" || w === "--git-dir" || w === "--work-tree") at += 2;
    else if (w === "-c") {
      config.push(s.words[at + 1]?.text ?? "");
      at += 2;
    } else if (w.startsWith("-") && w.length > 1) at += 1;
    else break;
  }
  return { sub: s.words[at]?.text ?? "", rest: s.words.slice(at + 1), config };
}
