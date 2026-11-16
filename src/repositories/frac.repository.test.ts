import { LIMITS } from "../config/constants.ts";
import type { Frac } from "../models/frac.model.ts";
import { MemoryFracRepository } from "./frac.repository.ts";

const frac = { id: "f1", ownerId: "o", step: 2 } as Frac;

describe("MemoryFracRepository versions", () => {
  it("keeps only the newest LIMITS.maxVersionsPerFrac versions of a FRAC", async () => {
    const repo = new MemoryFracRepository();
    await repo.snapshot({ ...frac, id: "other" }, "Other FRAC");
    for (let i = 1; i <= LIMITS.maxVersionsPerFrac + 5; i++) await repo.snapshot(frac, `v${i}`);
    const versions = await repo.versions("f1");
    expect(versions).toHaveLength(LIMITS.maxVersionsPerFrac);
    expect(versions[0].reason).toBe(`v${LIMITS.maxVersionsPerFrac + 5}`);
    expect(versions.at(-1)?.reason).toBe("v6");
    // Another FRAC's versions are untouched
    expect(await repo.versions("other")).toHaveLength(1);
  });

  it("deletes a FRAC with its versions", async () => {
    const repo = new MemoryFracRepository();
    await repo.insert(frac);
    await repo.snapshot(frac, "v1");
    await repo.delete("f1");
    expect(await repo.get("f1")).toBeNull();
    expect(await repo.versions("f1")).toHaveLength(0);
  });
});
