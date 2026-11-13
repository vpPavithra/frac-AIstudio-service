// Unit tests for step change stamps: each kind of change stamps only its own step, a roles rebuild leaves
// competencies out of date, clearing ladders is not a change, and applyEdits marks steps checked.
import type { Frac, FracCompetency } from "../models/frac.model.ts";
import { applyEdits, newFrac } from "./frac.service.ts";
import { markChecked, stampChanges } from "./step-changes.ts";

const AT = "2026-11-12T10:00:00.000Z";
const level = { label: "L1", desc: "Does it" };
const comp = (code: string, levels: FracCompetency["levels"] = null): FracCompetency =>
  ({ code, label: code, description: "", type: "Domain", area: "", kcm: "", levels });

function frac(): Frac {
  return {
    ...newFrac("owner", { cadre: "ANM", state: "Bihar", prompt: "" }, "f1", new Date("2026-11-01")),
    postings: [{ key: "P1", label: "SC" }],
    research: { summary: "s", sourceNotes: "", sources: [], authorised: "", notAuthorised: "", stateContext: "", assumptions: "" },
    roles: [{ code: "R1", title: "Care", source: "", activities: [{ code: "R1.1", text: "Weighs", postings: { P1: "Yes" }, source: "", tier: "JD", comp: "C1@L2" }] }],
    competencies: [comp("C1", [level])],
  };
}

const stamped = (prev: Frac, next: Frac) => Object.keys(stampChanges(prev, next, AT).changedAt ?? {}).sort();

describe("stampChanges", () => {
  it("stamps nothing when nothing changed", () => {
    expect(stampChanges(frac(), frac(), AT).changedAt).toBeUndefined();
  });

  it("stamps only the step whose part changed", () => {
    const f = frac();
    expect(stamped(f, { ...f, research: { ...f.research!, summary: "new" } })).toEqual(["research"]);
    expect(stamped(f, { ...f, postings: [{ key: "P1", label: "Sub centre" }] })).toEqual(["research"]);
    const text = structuredClone(f);
    text.roles[0].activities[0].text = "Weighs newborns";
    expect(stamped(f, text)).toEqual(["roles"]);
    // A mapping change keeps existing ladders current: a ladder describes its competency, not the mappings
    const mapped = structuredClone(f);
    mapped.roles[0].activities[0].comp = "C1@L3";
    expect(stamped(f, mapped)).toEqual(["competencies", "ladders"]);
    const noLadders = { ...f, competencies: [comp("C1")] };
    expect(stamped(noLadders, { ...structuredClone(mapped), competencies: [comp("C1")] })).toEqual(["competencies"]);
    expect(stamped(f, { ...f, competencies: [{ ...comp("C1", [level]), label: "Newborn care" }] })).toEqual(["competencies"]);
    expect(stamped(f, { ...f, competencies: [comp("C1", [{ label: "L1", desc: "Does it well" }])] })).toEqual(["ladders"]);
  });

  it("leaves competencies out of date when a roles rebuild also drops mappings", () => {
    const f = frac();
    const rebuilt = structuredClone(f);
    rebuilt.roles[0].activities = [{ ...f.roles[0].activities[0], text: "New", comp: "" }];
    expect(stamped(f, rebuilt)).toEqual(["roles"]);
  });

  it("does not count cleared ladders as written", () => {
    const f = frac();
    expect(stamped(f, { ...f, competencies: [comp("C1")] })).toEqual([]);
  });

  it("keeps earlier stamps and marks a step checked", () => {
    const f = { ...frac(), changedAt: { research: "2026-11-10T00:00:00.000Z" } };
    expect(markChecked(f, "roles", AT).changedAt).toEqual({ research: "2026-11-10T00:00:00.000Z", roles: AT });
  });
});

describe("applyEdits stamps", () => {
  const now = new Date(AT);

  it("stamps the edited step", () => {
    const f = frac();
    expect(applyEdits(f, { research: { ...f.research!, summary: "edited" } }, now).changedAt).toEqual({ research: AT });
  });

  it("marks a step checked, and checking competencies clears rolesDirty", () => {
    const f = { ...frac(), rolesDirty: true };
    const next = applyEdits(f, { checked: ["competencies"] }, now);
    expect(next.changedAt).toEqual({ competencies: AT });
    expect(next.rolesDirty).toBe(false);
    expect(applyEdits(f, { checked: ["roles", "ladders"] }, now).changedAt).toEqual({ roles: AT, ladders: AT });
  });

  it("treats Mapping checked (rolesDirty false) as checking competencies", () => {
    expect(applyEdits({ ...frac(), rolesDirty: true }, { rolesDirty: false }, now).changedAt).toEqual({ competencies: AT });
  });
});

describe("brief changes", () => {
  it("stamps the brief when the position, state or instructions change, but not for research's full title", () => {
    const f = frac();
    expect(stamped(f, { ...f, cadre: "ANM (Auxiliary Nurse Midwife)" })).toEqual(["brief"]);
    expect(stamped(f, { ...f, prompt: "Focus on newborn care" })).toEqual(["brief"]);
    expect(stamped(f, { ...f, cadreFull: "Auxiliary Nurse Midwife" })).toEqual([]);
  });

  it("allows brief edits after research and marks an expert check out of date", () => {
    const f = { ...frac(), review: { findings: [] } as unknown as Frac["review"] };
    const next = applyEdits(f, { cadre: "GNM", state: "Assam" }, new Date(AT));
    expect(next.cadre).toBe("GNM");
    expect(next.changedAt).toEqual({ brief: AT });
    expect(next.reviewStale).toBe(true);
  });
});
