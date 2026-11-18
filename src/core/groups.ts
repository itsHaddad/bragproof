// The kinds of finding, in the order they are shown. Each has a shape as well as a colour, so the tape can be read
// without colour, and one line saying what a finding of this kind does and does not mean.

import type { GroupId } from "./types.ts";

export interface Group {
  id: GroupId;
  title: string;
  /** One word for the count chips. */
  short: string;
  shape: "diamond" | "square" | "ring" | "key" | "down" | "cross" | "eye" | "quote";
  means: string;
}

export const GROUPS: Group[] = [
  { id: "skipped", title: "Checks skipped", short: "Skipped", shape: "diamond", means: "A check that normally runs was told not to. The diff looks the same either way." },
  { id: "off", title: "Checks switched off in the code", short: "Switched off", shape: "square", means: "The edit silenced a test, a lint rule or the type checker. It is in the diff, and easy to miss there." },
  { id: "config", title: "Settings and pipelines touched", short: "Settings", shape: "ring", means: "The agent edited a CI workflow, a hook file or its own settings, or ran a command outside its sandbox. Often that is the task itself. It is listed so you can look, not because a check was silenced." },
  { id: "secrets", title: "Key files opened", short: "Keys", shape: "key", means: "The agent opened a file that usually holds keys. Whatever it read was sent to the model." },
  { id: "outside", title: "Code brought in from outside", short: "Brought in", shape: "down", means: "Something was installed or run by name from a public registry, or straight from a web address." },
  { id: "undo", title: "Hard to undo", short: "Hard to undo", shape: "cross", means: "Work was thrown away or history was overwritten." },
  { id: "hidden", title: "Hidden text shown to the agent", short: "Hidden text", shape: "eye", means: "A file or page the agent read carried text you cannot see. That is how instructions are smuggled to an agent." },
  { id: "said", title: "Said, not shown", short: "Said", shape: "quote", means: "The closing message says the tests pass and the log does not show it. Tests may have run where the log cannot see." },
];

export const groupOf = (id: GroupId): Group => GROUPS.find((g) => g.id === id) ?? (GROUPS[0] as Group);
