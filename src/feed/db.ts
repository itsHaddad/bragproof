import { Database } from "bun:sqlite";
import { type Executor, FeedStore } from "./store.ts";

export type { ClaimRow, PostRow, Query } from "./sql.ts";

/** The feed's store on a local SQLite file (":memory:" for tests). */
export class FeedDb extends FeedStore {
  constructor(path: string) {
    const db = new Database(path);
    db.run("PRAGMA journal_mode = WAL");
    const exec: Executor = {
      all: async (sql, args) => db.query(sql).all(...args) as Record<string, unknown>[],
      run: async (sql, args) => {
        db.query(sql).run(...args);
      },
    };
    super(exec);
  }
}
