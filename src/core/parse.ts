// Reads a Claude Code session log (one JSON object per line) into steps and closing messages.
// The log is untrusted: any line may be broken, huge, or shaped to mislead. A bad line is counted and skipped,
// every stored string is cut to a fixed length, and nothing in the log is ever treated as an instruction.

import { NotALog, type Say, type Session, type Step, type StepKind } from "./types.ts";

export const LIMITS = { bytes: 64 * 1024 * 1024, lines: 400_000, lineChars: 4 * 1024 * 1024, steps: 50_000, field: 6_000, output: 3_000 } as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number = LIMITS.field): string => (typeof v === "string" ? v.slice(0, max) : "");

const KINDS: Record<string, StepKind> = { Bash: "shell", Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit", Read: "read", WebFetch: "fetch" };

function stepFrom(block: Json, n: number, turn: number, time: string): Step {
  const tool = str(block.name, 80);
  const input = isObject(block.input) ? block.input : {};
  const edits = Array.isArray(input.edits) ? input.edits.filter(isObject).slice(0, 200) : [];
  const added = [str(input.new_string), str(input.content), str(input.new_source), ...edits.map((e) => str(e.new_string, 2_000))].join("\n").slice(0, LIMITS.field * 2);
  const removed = [str(input.old_string), ...edits.map((e) => str(e.old_string, 2_000))].join("\n").slice(0, LIMITS.field * 2);
  return {
    n,
    turn,
    kind: KINDS[tool] ?? "other",
    tool,
    time,
    command: str(input.command),
    path: str(input.file_path, 1_000) || str(input.notebook_path, 1_000) || str(input.path, 1_000),
    url: str(input.url, 2_000),
    added: added.trim() ? added : "",
    removed: removed.trim() ? removed : "",
    failed: null,
    output: "",
    sandboxOff: input.dangerouslyDisableSandbox === true,
  };
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, LIMITS.output);
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (isObject(part) && typeof part.text === "string") text += `${part.text}\n`;
    if (text.length >= LIMITS.output) break;
  }
  return text.slice(0, LIMITS.output);
}

/** Text the person typed, as opposed to text the tool put in the person's place (tool results, notes from the program). */
function typedByPerson(row: Json, content: unknown): boolean {
  if (row.isMeta === true || row.isSidechain === true) return false;
  if (typeof content === "string") return content.trim() !== "" && !content.startsWith("<");
  if (!Array.isArray(content)) return false;
  return !content.some((b) => isObject(b) && b.type === "tool_result") && content.some((b) => isObject(b) && b.type === "text" && !str(b.text, 40).startsWith("<") && !row.sourceToolAssistantUUID);
}

export function parseSession(text: string): Session {
  if (text.length > LIMITS.bytes) throw new NotALog(`The log is larger than ${LIMITS.bytes / 1024 / 1024} MB.`);
  const steps: Step[] = [];
  const byId = new Map<string, Step>();
  const says: Say[] = [];
  const models = new Set<string>();
  const modes = new Set<string>();
  let lines = 0;
  let skipped = 0;
  let turn = 0;
  let recognised = 0;
  let cwd = "";
  let start = "";
  let end = "";
  let pending: Say | null = null;
  const closeTurn = () => {
    if (pending?.text.trim()) says.push(pending);
    pending = null;
  };
  let from = 0;
  while (from < text.length && lines < LIMITS.lines) {
    let to = text.indexOf("\n", from);
    if (to === -1) to = text.length;
    const line = text.slice(from, to).trim();
    from = to + 1;
    if (!line) continue;
    lines++;
    if (line.length > LIMITS.lineChars || line[0] !== "{") {
      skipped++;
      continue;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!isObject(row) || !isObject(row.message)) {
      if (!isObject(row)) skipped++;
      continue;
    }
    const time = str(row.timestamp, 40);
    const content = row.message.content;
    if (row.type === "assistant" || row.message.role === "assistant") {
      recognised++;
      if (time) {
        start ||= time;
        end = time;
      }
      if (typeof row.message.model === "string" && !row.message.model.startsWith("<")) models.add(row.message.model.slice(0, 60));
      if (row.isSidechain === true) continue;
      for (const block of Array.isArray(content) ? content : []) {
        if (!isObject(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          pending = { turn, afterStep: steps.length, time, text: block.text.slice(0, 20_000) };
        } else if (block.type === "tool_use" && steps.length < LIMITS.steps) {
          const step = stepFrom(block, steps.length + 1, turn, time);
          steps.push(step);
          if (typeof block.id === "string") byId.set(block.id, step);
        }
      }
    } else if (row.type === "user" || row.message.role === "user") {
      recognised++;
      cwd ||= str(row.cwd, 400);
      if (typeof row.permissionMode === "string") modes.add(row.permissionMode);
      for (const block of Array.isArray(content) ? content : []) {
        if (!isObject(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        const step = byId.get(block.tool_use_id);
        if (!step) continue;
        step.failed = block.is_error === true;
        step.output = resultText(block.content);
      }
      if (typedByPerson(row, content)) {
        closeTurn();
        turn++;
      }
    }
  }
  closeTurn();
  if (recognised === 0) throw new NotALog("No agent messages found. A Claude Code session log has one JSON object per line.");
  const askedFirst = modes.size === 0 ? null : !modes.has("bypassPermissions");
  return { steps, says, lines, skippedLines: skipped, turns: Math.max(turn, 1), models: [...models].sort(), cwd, askedFirst, start, end };
}
