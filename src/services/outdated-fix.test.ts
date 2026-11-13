// Unit tests for "Replace with …" on outdated-name findings: the swap reaches every text the check reads, keeps
// hits the check would skip, and refuses patterns that need content added. Uses config/outdated.json.
import { loadOutdatedPatterns } from "../config/outdated.ts";
import type { Frac } from "../models/frac.model.ts";
import { newFrac } from "./frac.service.ts";
import { outdatedTitle, replaceable, replacementFor, replaceOutdated } from "./outdated-fix.ts";

const patterns = loadOutdatedPatterns();
const byId = (id: string) => {
  const p = patterns.find((x) => x.id === id);
  if (!p) throw new Error(`No outdated pattern ${id}`);
  return p;
};

function frac(): Frac {
  return {
    ...newFrac("owner", { cadre: "ANM", state: "Uttar Pradesh", prompt: "" }, "f1", new Date("2026-11-13")),
    roles: [{ code: "R1", title: "Outreach", source: "", activities: [
      { code: "A1", text: "Mobilise mothers for the VHND", postings: {}, source: "", tier: "", comp: "" },
    ] }],
    competencies: [{
      code: "ANM1", label: "Sub Centre and VHND micro-planning", description: "Prepares the VHND/UHND micro-plan",
      type: "Functional", area: "", kcm: "", levels: [{ label: "Lists Village Health and Nutrition Day sites", desc: "- Plans a VHND" }],
    }],
  };
}

describe("replaceOutdated", () => {
  it("replaces the outdated name in activities and competency names, descriptions and ladders", () => {
    const vhnd = byId("vhnd");
    expect(outdatedTitle(vhnd)).toBe("Outdated reference: VHND / Village Health and Nutrition Day");
    const { frac: out, replaced } = replaceOutdated(frac(), vhnd);
    expect(replaced).toBe(5);
    expect(out.roles[0].activities[0].text).toBe("Mobilise mothers for the VHSND");
    expect(out.competencies[0]).toMatchObject({ label: "Sub Centre and VHSND micro-planning", description: "Prepares the VHSND/UHND micro-plan" });
    expect(out.competencies[0].levels).toEqual([{ label: "Lists VHSND sites", desc: "- Plans a VHSND" }]);
  });

  it("writes the current name without its year note, and leaves a FRAC without hits unchanged", () => {
    expect(replacementFor(byId("tt"))).toBe("Td");
    expect(replaceOutdated(frac(), byId("rntcp")).replaced).toBe(0);
  });

  it("does not offer a swap for findings that need content added", () => {
    expect(patterns.filter((p) => !replaceable(p)).every((p) => p.onlyIfAbsent || p.fix)).toBe(true);
    const partograph = patterns.find((p) => p.onlyIfAbsent);
    if (partograph) expect(replaceable(partograph)).toBe(false);
  });
});
