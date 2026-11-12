import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSettings, readSettingsFile, SettingsError } from "./settings.ts";

function tempConfig(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frac-settings-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
  return dir;
}

describe("settings", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses a secret in a committed file and names it", () => {
    const dir = tempConfig({ "service.json": { ANTHROPIC_API_KEY: "sk-x" } });
    expect(() => readSettingsFile(path.join(dir, "service.json"))).toThrow(SettingsError);
    expect(() => readSettingsFile(path.join(dir, "service.json"))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("refuses any provider's key, whatever its name, as long as it ends in _API_KEY", () => {
    const dir = tempConfig({ "service.json": { ANTHROPIC_API_KEY: "a-x", SOMEAI_API_KEY: "s-x" } });
    expect(() => readSettingsFile(path.join(dir, "service.json"))).toThrow(/ANTHROPIC_API_KEY, SOMEAI_API_KEY/);
  });

  it("rejects bad names and nested values, skips comments and nulls", () => {
    const bad = tempConfig({ "service.json": { lowerCase: 1 } });
    expect(() => readSettingsFile(path.join(bad, "service.json"))).toThrow(/invalid setting name/);
    const nested = tempConfig({ "service.json": { LIST: [1] } });
    expect(() => readSettingsFile(path.join(nested, "service.json"))).toThrow(/string, number or boolean/);
    const ok = tempConfig({ "service.json": { "// note": "x", A_B: null, C: 2 } });
    expect(readSettingsFile(path.join(ok, "service.json"))).toEqual([["C", 2]]);
  });

  it("layers env over the NODE_ENV overlay over service.json", () => {
    const dir = tempConfig({
      "service.json": { FS_TEST_A: "base", FS_TEST_B: "base", FS_TEST_C: "base" },
      "service.staging.json": { FS_TEST_B: "overlay", FS_TEST_C: "overlay" },
    });
    process.env.NODE_ENV = "staging";
    process.env.FS_TEST_C = "env";
    loadSettings(dir);
    expect([process.env.FS_TEST_A, process.env.FS_TEST_B, process.env.FS_TEST_C]).toEqual(["base", "overlay", "env"]);
  });
});
