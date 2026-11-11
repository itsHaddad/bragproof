import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** A minimal MCP client over stdio (newline-delimited JSON-RPC): initialize, list tools, call a tool. */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = "";
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed: Error | null = null;

  constructor(command: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
    this.child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.resume();
    const fail = (why: string) => {
      this.closed = new Error(why);
      for (const w of this.waiting.values()) w.reject(this.closed);
      this.waiting.clear();
    };
    this.child.on("error", (e) => fail("server did not start: " + e.message));
    this.child.on("exit", (code) => fail("server exited with code " + code));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl = this.buffer.indexOf("\n");
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      nl = this.buffer.indexOf("\n");
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // a server that logs to stdout: not a message
      }
      const w = typeof msg?.id === "number" ? this.waiting.get(msg.id) : undefined;
      if (!w) continue;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(String(msg.error.message ?? "request failed")));
      else w.resolve(msg.result);
    }
  }

  private send(msg: object) {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  request(method: string, params: object, timeoutMs = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claimcheck", version: "0.1.0" } });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.request("tools/list", cursor ? { cursor } : {});
      for (const t of res?.tools ?? []) if (typeof t?.name === "string") names.push(t.name);
      cursor = typeof res?.nextCursor === "string" ? res.nextCursor : undefined;
      if (!cursor) break;
    }
    return names;
  }

  /** Calls a tool and returns its text content joined; a tool-level error is thrown. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args });
    const text = (Array.isArray(res?.content) ? res.content : [])
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
    if (res?.isError) throw new Error("tool reported an error: " + text.slice(0, 200));
    return text;
  }

  close() {
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
