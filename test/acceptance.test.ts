// Spec 6.6 regression. Needs the real dictionaries in test/fixtures (ask Sarvesh; not committed).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadOutdatedPatterns } from "../src/config/outdated.js";
import { computeChecks } from "../src/engine/checks.js";
import { parseWorkbook } from "../src/engine/parse-workbook.js";
import type { Finding } from "../src/engine/types.js";
import { readWorkbook } from "../src/io/workbook-reader.js";

const FIXTURES = path.resolve(process.cwd(), "test/fixtures");
const GNM = "GNM COMPETENCY DICTIONARY 9 June 2025.xlsx";
const ANM = "ANM competencies 6aug2026.xlsx";
const STAFF_NURSE = "Staff Nurse competencies - India v0.1.xlsx";

const has = (file: string) => existsSync(path.join(FIXTURES, file));
const itWith = (file: string) => (has(file) ? it : it.skip);

async function review(file: string) {
  const sheets = await readWorkbook(readFileSync(path.join(FIXTURES, file)));
  const { model } = parseWorkbook(sheets, file);
  return { model, ...computeChecks(model, loadOutdatedPatterns()) };
}

const find = (findings: Finding[], title: string) => findings.find((f) => f.title.startsWith(title));

describe("acceptance fixtures (spec 6.6)", () => {
  itWith(GNM)("GNM: blockers, unmapped, incomplete ladders, bloom and syllabus verbs", async () => {
    const { findings } = await review(GNM);
    const blockers = findings.filter((f) => f.sev === "B").map((f) => f.title);
    expect(blockers.join(" ")).toMatch(/Lunacy/);
    expect(blockers.join(" ")).toMatch(/NDPS/);
    expect(blockers.join(" ")).toMatch(/Mental Health Act 1987/);

    const unmapped = find(findings, "Activities not mapped");
    expect(unmapped?.detail).toMatch(/^16 of /);
    expect(unmapped?.refs).toEqual(expect.arrayContaining(["A31", "A41"]));

    expect(find(findings, "Incomplete level ladders")?.detail).toMatch(/^12 of /);
    // "roughly 58/74" L1 labels
    const l1 = /L1 (\d+)\/(\d+)/.exec(find(findings, "Level labels")?.detail ?? "");
    expect(Number(l1?.[1])).toBeGreaterThanOrEqual(50);
    // "~92/136" activities start with "Describes"
    const syl = /^(\d+)\/(\d+)/.exec(find(findings, "Activities read like syllabus")?.detail ?? "");
    expect(Number(syl?.[1])).toBeGreaterThanOrEqual(85);
  });

  itWith(ANM)("ANM: parses role-row ranges and the 'Comptency' column", async () => {
    const { model } = await review(ANM);
    expect(model.hasFrac).toBe(true);
    expect(model.roles.some((r) => (r.refs ?? []).length > 1)).toBe(true);
    expect(model.roles.flatMap((r) => r.activities).some((a) => a.refs.length)).toBe(true);
  });

  itWith(STAFF_NURSE)("Staff Nurse: at most one minor computed finding", async () => {
    const { findings } = await review(STAFF_NURSE);
    expect(findings.filter((f) => f.sev !== "m")).toEqual([]);
    expect(findings.length).toBeLessThanOrEqual(1);
  });
});
