// Builds session logs line by line, in the shape Claude Code writes them.

let counter = 0;
const id = () => `toolu_${String(++counter).padStart(4, "0")}`;
const at = () => `2026-11-18T10:${String(Math.floor(counter / 60) % 60).padStart(2, "0")}:${String(counter % 60).padStart(2, "0")}.000Z`;

export type Line = Record<string, unknown>;

export const user = (text: string, mode = "default"): Line[] => [{ type: "user", cwd: "/home/dev/shop", permissionMode: mode, timestamp: at(), message: { role: "user", content: text } }];

export const say = (text: string): Line[] => [{ type: "assistant", timestamp: at(), message: { role: "assistant", model: "claude-example-1", content: [{ type: "text", text }] } }];

export function tool(name: string, input: Record<string, unknown>, result: { failed?: boolean; output?: string } = {}): Line[] {
  const use = id();
  return [
    { type: "assistant", timestamp: at(), message: { role: "assistant", model: "claude-example-1", content: [{ type: "tool_use", id: use, name, input }] } },
    { type: "user", timestamp: at(), sourceToolAssistantUUID: "x", message: { role: "user", content: [{ type: "tool_result", tool_use_id: use, is_error: result.failed === true, content: result.output ?? "" }] } },
  ];
}

export const bash = (command: string, result: { failed?: boolean; output?: string } = {}): Line[] => tool("Bash", { command }, result);
export const edit = (file_path: string, old_string: string, new_string: string): Line[] => tool("Edit", { file_path, old_string, new_string });
export const write = (file_path: string, content: string): Line[] => tool("Write", { file_path, content });
export const read = (file_path: string, output = ""): Line[] => tool("Read", { file_path }, { output });

export const log = (...parts: Line[][]): string => parts.flat().map((l) => JSON.stringify(l)).join("\n");
