// Small in-memory workbooks for unit tests. Real dictionaries live in test/fixtures (not in git).
import type { SheetData } from "../../src/services/review-engine/parse-workbook.ts";
import type { Level } from "../../src/models/frac.model.ts";
import type { ModelCompetency, ReviewModel } from "../../src/models/review.model.ts";

export const COMP_HEADERS = [
  "Competency Code",
  "Competency Label",
  "Competency Description",
  "Competency Type",
  "Competency Area",
  ...[1, 2, 3, 4, 5].flatMap((n) => [`Competency Level ${n} Label`, `Competency Level ${n} Description`]),
];

export function goodLevels(topic: string): Level[] {
  return [
    { label: `Identifies ${topic} needs`, desc: `Identifies cases\n- Records findings` },
    { label: `Performs ${topic} under supervision`, desc: `Performs steps\n- Seeks help` },
    { label: `Manages ${topic} independently`, desc: `Manages cases\n- Refers danger signs` },
    { label: `Handles complex ${topic}`, desc: `Handles complications\n- Coordinates referral` },
    { label: `Audits and mentors ${topic}`, desc: `Audits records\n- Mentors peers` },
  ];
}

export function comp(code: string, type: string, levels: Level[] = goodLevels(code)): ModelCompetency {
  return { code, label: `${code} label`, description: `Conducts ${code}`, type, area: "PH", levels };
}

export function model(over: Partial<ReviewModel> = {}): ReviewModel {
  return {
    title: "Test",
    hasFrac: true,
    hasMapping: true,
    postings: ["P1"],
    postingLabels: ["ANM at Sub-Centre"],
    roles: [
      {
        code: "R1",
        title: "Conduct VHSND sessions",
        activities: [
          { code: "A1", text: "Conduct immunisation session", postings: { P1: "Yes" }, refs: [{ code: "C1", level: 3 }] },
          { code: "A2", text: "Screen pregnant women", postings: { P1: "Yes" }, refs: [{ code: "C2", level: 3 }] },
        ],
      },
      {
        code: "R2",
        title: "Maintain records",
        activities: [
          { code: "A3", text: "Maintain RCH register", postings: { P1: "Yes" }, refs: [{ code: "C3", level: 3 }] },
          { code: "A4", text: "Refer danger signs", postings: { P1: "Yes" }, refs: [{ code: "C1", level: 4 }] },
        ],
      },
    ],
    competencies: [comp("C1", "Domain"), comp("C2", "Functional"), comp("C3", "Behavioural")],
    ...over,
  };
}

export function compRow(c: ModelCompetency): string[] {
  return [c.code, c.label, c.description, c.type, c.area, ...c.levels.flatMap((l) => [l.label, l.desc])];
}

export function workbook(): SheetData[] {
  return [
    {
      name: "FRAC",
      rows: [
        ["ANM competency framework"],
        ["Role", "Activity", "P1: ANM at Sub-Centre", "P2: ANM at PHC", "Comptency", "Source", "Source tier"],
        ["R1", "Conduct VHSND sessions", "", "", "C1-C2", "IPHS 2022", ""],
        ["A1", "Conduct immunisation session", "Yes", "No", "C1@L3", "JD", "JD"],
        ["A2", "Screen pregnant women", "Yes", "Yes", "2", "JD", "JD"],
        ["", "", "", "", "", "", ""],
        ["R2", "Maintain records", "", "", "", "", ""],
        ["A3", "Maintain RCH register", "Yes", "", "C3 L4", "", ""],
      ],
    },
    { name: "Competencies (H)", rows: [COMP_HEADERS, ["C9", "हिंदी"]] },
    {
      name: "Competencies",
      rows: [COMP_HEADERS, compRow(comp("C1", "Domain")), compRow(comp("C2", "Functional")), ["", "blank code row"], compRow(comp("C3", "Behavioural"))],
    },
  ];
}
