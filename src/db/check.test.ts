import { checkDatabase } from "./check.ts";

describe("checkDatabase", () => {
  it("passes when the database answers", async () => {
    await expect(checkDatabase({ query: async () => ({ rows: [{ "?column?": 1 }] }) }, "db:5432")).resolves.toBeUndefined();
  });

  it("names the target, the cause and both ways forward when it does not", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const failing = { query: async () => Promise.reject(refused) };
    await expect(checkDatabase(failing, "localhost:5432/frac_studio")).rejects.toThrow(
      "Cannot reach Postgres at localhost:5432/frac_studio (connect ECONNREFUSED 127.0.0.1:5432). Set POSTGRES_* in .env, or run without a database with FRAC_STUDIO_STORE=memory.",
    );
  });
});
