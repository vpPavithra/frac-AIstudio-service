import { MemoryServerRunRepository } from "./server-run.repository.ts";

describe("server runs", () => {
  it("records a start, closes it once on stop, and returns the latest run", async () => {
    const runs = new MemoryServerRunRepository();
    const first = await runs.start({ provider: "claude", store: "postgres", host: "h", pid: 1 });
    await runs.stop(first);
    const stoppedAt = (await runs.get(first))?.stoppedAt;
    expect(stoppedAt).toEqual(expect.any(String));
    await runs.stop(first); // a second stop keeps the first time
    expect((await runs.get(first))?.stoppedAt).toBe(stoppedAt);

    const second = await runs.start({ provider: "claude-fast", store: "postgres", host: "h", pid: 2 });
    expect(await runs.latest()).toMatchObject({ id: second, provider: "claude-fast", stoppedAt: null });
  });
});
