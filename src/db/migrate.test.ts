import path from "node:path";
import { loadMigrations, pendingMigrations, runMigrations, type Queryable } from "./migrate.ts";

/** Records every statement; answers the applied-names query from a preset list. */
function fakeDb(applied: string[], failOn?: string) {
  const log: string[] = [];
  const db: Queryable = {
    async query(sql, params) {
      log.push(params?.length ? `${sql} ${JSON.stringify(params)}` : sql);
      if (failOn && sql === failOn) throw new Error("syntax error");
      if (sql.startsWith("SELECT name FROM schema_migrations")) return { rows: applied.map((name) => ({ name })) };
      return { rows: [] };
    },
  };
  return { db, log };
}

const m = (name: string) => ({ name, sql: `-- ${name}` });

describe("migrations", () => {
  it("loads the repo's .sql files in name order", () => {
    const names = loadMigrations(path.resolve("migrations")).map((x) => x.name);
    expect(names[0]).toBe("001_init.sql");
    expect([...names].sort()).toEqual(names);
  });

  it("skips migrations already recorded", () => {
    expect(pendingMigrations([m("001"), m("002")], new Set(["001"])).map((x) => x.name)).toEqual(["002"]);
  });

  it("applies each pending migration in its own transaction under the lock", async () => {
    const { db, log } = fakeDb(["001"]);
    expect(await runMigrations(db, [m("001"), m("002")])).toEqual(["002"]);
    const body = log.filter((line) => !line.startsWith("CREATE TABLE"));
    expect(body).toEqual([
      expect.stringContaining("pg_advisory_lock"),
      "SELECT name FROM schema_migrations",
      "BEGIN",
      "-- 002",
      expect.stringContaining('INSERT INTO schema_migrations (name) VALUES ($1) ["002"]'),
      "COMMIT",
      expect.stringContaining("pg_advisory_unlock"),
    ]);
  });

  it("rolls back a failing migration, releases the lock and names the file", async () => {
    const { db, log } = fakeDb([], "-- 002");
    await expect(runMigrations(db, [m("001"), m("002")])).rejects.toThrow("Migration 002 failed: syntax error");
    expect(log).toContain("ROLLBACK");
    expect(log[log.length - 1]).toContain("pg_advisory_unlock");
    expect(log.filter((line) => line === "COMMIT")).toHaveLength(1);
  });
});
