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
  /** Steps the log holds beyond the limit: they were counted, not read. */
  stepsNotRead: number;
  /** True when the line limit stopped the read before the end of the log. */
  linesCut: boolean;
  turns: number;
  models: string[];
  cwd: string;
  askedFirst: boolean | null;
  start: string;
  end: string;
}

export type GroupId = "skipped" | "off" | "config" | "secrets" | "outside" | "undo" | "hidden" | "said";

/** One check the agent ran (tests, lint, types, build) and how the log says it ended. No judgement. */
export interface CheckRun {
  step: number;
  /** The whole command line, shortened. */
  command: string;
  /** How the whole command line ended; null when the log holds no result for it. */
  failed: boolean | null;
  /** False when the check was piped or followed by another command, so the line's exit state is not the check's. */
  own: boolean;
  /** The last line the command printed, shortened. */
  lastLine: string;
}

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
  input: { sha256: string; bytes: number; lines: number; skippedLines: number; stepsNotRead: number; linesCut: boolean };
  /** What each step was, one short line per step, for reading any tick on the tape. */
  labels: string[];
  /** The last checks the agent ran and how each ended, as the log records it. */
  checks: CheckRun[];
  /** How many check runs the log holds in all; `checks` keeps the last eight. */
  checksTotal: number;
  /** Commit commands in the log, and how many carried --no-verify. Whether each commit went through is not known. */
  commits: { made: number; noVerify: number };
  /** Findings and hosts beyond what the report lists. */
  findingsNotListed: number;
  hostsNotListed: number;
  session: {
    steps: number;
    turns: number;
    models: string[];
    askedFirst: boolean | null;
    start: string;
    end: string;
    /** One letter per step, in order: s command, e edit, r read, f web request, o other. Capital when the step failed. */
    track: string;
    /** The agent's last message, shortened. Quoted data. */
    closing: string;
  };
  hosts: string[];
  findings: Finding[];
  /** SHA-256 over the canonical form of everything above: the same file and rules give the same id anywhere. */
  id: string;
}

export class NotALog extends Error {}
