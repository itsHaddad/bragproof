import type { Executor } from "../src/feed/store.ts";

/** The part of Cloudflare D1 the feed uses. */
export type D1 = { prepare(sql: string): { bind(...args: unknown[]): { all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> } } };

export const d1Executor = (db: D1): Executor => ({
  all: async (sql, args) => (await db.prepare(sql).bind(...args).all<Record<string, unknown>>()).results,
  run: async (sql, args) => {
    await db.prepare(sql).bind(...args).run();
  },
});
