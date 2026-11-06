import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFracSizes } from "./frac-sizes.ts";
import { SettingsError } from "./settings.ts";

function tempSizes(body: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "frac-sizes-")), "frac-sizes.json");
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

describe("frac sizes config", () => {
  it("reads the committed table with every size the portal offers", () => {
    const sizes = loadFracSizes();
    expect(Object.keys(sizes)).toEqual(["compact", "standard", "full"]);
    expect(sizes.compact).toMatchObject({ roles: 7, acts: 5, comps: 18 });
  });

  it("uses edited numbers without a code change", () => {
    const row = { roles: 9, acts: 4, comps: 20, ranges: "8–10 roles" };
    const file = tempSizes({ compact: row, standard: row, full: row });
    expect(loadFracSizes(file).compact.roles).toBe(9);
  });

  it("refuses a missing size or a count that is not a positive whole number", () => {
    const row = { roles: 7, acts: 5, comps: 18, ranges: "6–8 roles" };
    expect(() => loadFracSizes(tempSizes({ compact: row, standard: row }))).toThrow(SettingsError);
    expect(() => loadFracSizes(tempSizes({ compact: row, standard: row, full: { ...row, comps: 0 } }))).toThrow(/"full"/);
  });
});
