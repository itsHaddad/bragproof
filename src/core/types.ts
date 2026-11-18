// The shapes everything else passes around. A session log is untrusted text: every string here came from a
// stranger's tool output or a model, and is only ever shown as text, never run and never followed.

export type StepKind = "shell" | "edit" | "read" | "fetch" | "other";

/** One thing the agent did: a command, a file edit, a file read, a web request. */
export interface Step {
  n: number;
  turn: number;
  kind: StepKind;
  tool: string;
  time: string;
  command: string;
  path: string;
  url: string;
  /** Text the edit put into the file, and text it took out. */
  added: string;
  removed: string;
  /** null until the log shows a result for the step. */
  failed: boolean | null;
  output: string;
  sandboxOff: boolean;
}

/** The last thing the agent wrote in one turn, before the person spoke again. */
export interface Say {
  turn: number;
  afterStep: number;
  time: string;
  text: string;
}

export interface Session {
  steps: Step[];
  says: Say[];
  lines: number;
  skippedLines: number;
  turns: number;
  models: string[];
  cwd: string;
  askedFirst: boolean | null;
  start: string;
  end: string;
}

export type GroupId = "skipped" | "off" | "secrets" | "outside" | "undo" | "hidden" | "said";

export interface Finding {
  rule: string;
  group: GroupId;
  step: number;
  time: string;
  /** What the log shows, as a plain fact. */
  fact: string;
  /** The line from the log that shows it, cleaned and shortened. Quoted data. */
  evidence: string;
}

export interface Report {
  rules: string;
  input: { sha256: string; bytes: number; lines: number; skippedLines: number };
  session: { steps: number; turns: number; models: string[]; askedFirst: boolean | null; start: string; end: string };
  hosts: string[];
  findings: Finding[];
  /** SHA-256 over the canonical form of everything above: the same file and rules give the same id anywhere. */
  id: string;
}

export class NotALog extends Error {}
