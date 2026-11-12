import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** A minimal MCP client over stdio (newline-delimited JSON-RPC): initialize, list tools, call a tool. */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = "";
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed: Error | null = null;
  private errTail = "";

  constructor(command: string, args: string[], options: { cwd: string; env: Record<string, string>; detached: boolean; stdio: ["pipe", "pipe", "pipe"] }) {
    this.child = spawn(command, args, options);
    // Writing to a subject that has just exited must not take the runner down with it.
    this.child.stdin.on("error", () => {});
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    // The end of what the subject wrote to its error stream: when it will not start, this says why.
    this.child.stderr.on("data", (chunk: string) => {
      this.errTail = (this.errTail + chunk).slice(-4000);
    });
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
    if (this.buffer.length > 4_000_000) {
      // A subject that floods its output without ever ending a line is stopped, not buffered for ever.
      this.buffer = "";
      this.close();
      return;
    }
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

  /** What the subject last wrote to its error stream. Untrusted text. */
  get stderrTail(): string {
    return this.errTail;
  }

  async initialize(): Promise<{ serverName: string; serverVersion: string; protocol: string }> {
    const res = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bragproof", version: "0.1.0" } });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return { serverName: String(res?.serverInfo?.name ?? "").slice(0, 100), serverVersion: String(res?.serverInfo?.version ?? "").slice(0, 40), protocol: String(res?.protocolVersion ?? "").slice(0, 20) };
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

  /** The tools with their descriptions and input schemas, as the server states them. */
  async describeTools(descriptionLimit = 600): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
    const res = await this.request("tools/list", {});
    return (Array.isArray(res?.tools) ? res.tools : []).slice(0, 200).map((t: any) => ({ name: String(t?.name ?? ""), description: String(t?.description ?? "").slice(0, descriptionLimit), inputSchema: t?.inputSchema ?? null }));
  }

  /** Calls a tool and returns its text content joined; a tool-level error is thrown. */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    const text = (Array.isArray(res?.content) ? res.content : [])
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
    if (res?.isError) throw new Error("tool reported an error: " + text.slice(0, 200));
    return text;
  }

  close() {
    // The subject leads its own process group, so anything it forked goes with it.
    try {
      if (this.child.pid) process.kill(-this.child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
