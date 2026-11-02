// Synthetic stand-ins for the real dictionaries in spec 6.1 / 6.6. Every defect is planted at a known
// count so the tests can assert exact numbers. Not clinical content: do not use as a reference FRAC.
import type { SheetData } from "../../src/engine/parse-workbook.js";

const TOPICS = [
  "antenatal assessment",
  "newborn resuscitation",
  "wound dressing",
  "medication administration",
  "infection prevention",
  "vital signs monitoring",
  "fluid balance",
  "patient counselling",
  "bio-medical waste handling",
  "postnatal care",
];

const topic = (i: number) => `${TOPICS[i % TOPICS.length]} (${i})`;

function levelCols(): string[] {
  return [1, 2, 3, 4, 5].flatMap((n) => [`Competency Level ${n} Label`, `Competency Level ${n} Description`]);
}

/** Five distinct, measurable levels; the overrides plant defects. */
function ladder(t: string, over: { l1?: string; l5?: string; l3desc?: string } = {}): string[] {
  return [
    over.l1 ?? `Identifies ${t} needs`,
    `Identifies cases needing ${t}\n- Records findings in the register`,
    `Assists with ${t} under supervision`,
    `Prepares equipment for ${t}\n- Follows the checklist with a supervisor`,
    `Performs ${t} independently`,
    over.l3desc ?? `Performs ${t} to protocol\n- Refers danger signs`,
    `Manages complex ${t}`,
    `Manages complications of ${t}\n- Coordinates referral`,
    over.l5 ?? `Audits and mentors ${t} practice`,
    `Audits ${t} records\n- Mentors junior staff on ${t}`,
  ];
}

const typeOf = (i: number) => (i % 10 === 9 ? "Behavioural" : i % 10 >= 7 ? "Functional" : "Domain");

// ---------------------------------------------------------------------------------------------
// GNM-style: mirrors the spec 6.6 regression numbers.
//   74 competencies, 58 L1 labels "Understands …", 12 incomplete ladders (ME63–ME74 have no L5),
//   136 activities, 92 start with "Describes", 16 unmapped (A31–A41, A120–A124),
//   repealed laws: Lunacy Act 1912, NDPS 1965, Mental Health Act 1987.
//   Mapping cells mix "ME50L2-L5", "ME3@L3", "ME7 L4" and bare numbers; a Hindi sheet must be skipped;
//   the competency description column comes after the level columns (spec gap 8).
// ---------------------------------------------------------------------------------------------
export const GNM_COUNTS = {
  competencies: 74,
  l1Banned: 58,
  incomplete: 12,
  activities: 136,
  syllabus: 92,
  unmapped: 16,
  roles: 17,
} as const;

const GNM_UNMAPPED = new Set([...range(31, 41), ...range(120, 124)]);
const LAW_IN_L3: Record<number, string> = {
  5: "Applies the Lunacy Act 1912 when admitting a patient\n- Records the admission",
  6: "Stores drugs as per the NDPS act of 1965\n- Maintains the drug register",
  7: "Applies Mental Health Act 1987 provisions on consent\n- Documents consent",
};

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, k) => from + k);
}

function gnmMapping(j: number): string {
  if (GNM_UNMAPPED.has(j)) return "";
  const k = ((j - 1) % GNM_COUNTS.competencies) + 1;
  return [`ME${k}L2-L5`, `ME${k}@L3`, `ME${k} L4`, `${k}`][j % 4];
}

export function gnmSample(): SheetData[] {
  const compHeaders = ["Competency Code", "Competency Label", "Competency Type", "Competency Area", ...levelCols(), "Competency Description"];
  const compRows = range(1, GNM_COUNTS.competencies).map((i) => {
    const t = topic(i);
    const levels = ladder(t, {
      l1: i <= GNM_COUNTS.l1Banned ? `Understands ${t}` : undefined,
      l5: i > GNM_COUNTS.competencies - GNM_COUNTS.incomplete ? "" : undefined,
      l3desc: LAW_IN_L3[i],
    });
    return [`ME${i}`, `${t} competency`, typeOf(i), "Clinical", ...levels, `Delivers ${t} safely`];
  });

  const fracRows: string[][] = [];
  for (let r = 1; r <= GNM_COUNTS.roles; r++) {
    fracRows.push([`R${r}`, `Ward nursing area ${r}`, "", "", "", "INC syllabus"]);
    for (let a = 1; a <= GNM_COUNTS.activities / GNM_COUNTS.roles; a++) {
      const j = (r - 1) * 8 + a;
      const verb = j <= GNM_COUNTS.syllabus ? "Describes" : "Conducts";
      fracRows.push([`A${j}`, `${verb} ${topic(j)}`, "Yes", j % 3 ? "Yes" : "No", gnmMapping(j), "INC syllabus"]);
    }
  }

  return [
    {
      name: "Competency Dictionary",
      rows: [["GNM COMPETENCY DICTIONARY"], ["Version 9 June 2025 (sample)"], compHeaders, ...compRows],
    },
    { name: "Competency Dictionary (H)", rows: [compHeaders, ["X1", "हिंदी प्रति"]] },
    {
      name: "FRAC",
      rows: [["GNM FRAC"], ["Role", "Activity", "Ward", "OPD", "Competency mapping", "Source"], ...fracRows],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// ANM-style: "Comptency" typo header, role-row code ranges, bare numbers and multi-ref cells.
//   6 roles × 4 activities, 24 competencies C1–C24, ladders clean.
// ---------------------------------------------------------------------------------------------
export function anmSample(): SheetData[] {
  const comps = range(1, 24).map((i) => [`C${i}`, `${topic(i)} competency`, `Delivers ${topic(i)}`, typeOf(i), "PH", ...ladder(topic(i))]);
  const fracRows: string[][] = [];
  for (let r = 1; r <= 6; r++) {
    const first = (r - 1) * 4 + 1;
    fracRows.push([`R${r}`, `Conduct sub-centre work area ${r}`, "", "", `C${first}-C${first + 3}`]);
    const cells = [`C${first}`, `${first + 1}`, `C${first + 2}@L3, C${first + 3}`, `C${first + 3} L4`];
    cells.forEach((cellText, a) => {
      fracRows.push([`A${first + a}`, `Conduct ${topic(first + a)} at outreach`, "Yes", a % 2 ? "Yes" : "No", cellText]);
    });
  }
  return [
    {
      name: "FRAC",
      rows: [["Role", "Activity", "Sub-Centre", "PHC", "Comptency"], ...fracRows],
    },
    {
      name: "Competencies",
      rows: [["Competency Code", "Competency Label", "Competency Description", "Competency Type", "Competency Area", ...levelCols()], ...comps],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Staff-Nurse-style: a clean dictionary. Computed checks must give at most one minor finding.
//   5 roles × 4 activities, 10 competencies (D/F/B mix), every competency used, postings filled.
// ---------------------------------------------------------------------------------------------
export function staffNurseSample(): SheetData[] {
  const types = ["Domain", "Domain", "Domain", "Domain", "Domain", "Domain", "Functional", "Functional", "Behavioural", "Behavioural"];
  const comps = range(1, 10).map((i) => [`SN${i}`, `${topic(i)} competency`, `Delivers ${topic(i)}`, types[i - 1], "Clinical", ...ladder(topic(i))]);
  const verbs = ["Monitor", "Administer", "Maintain", "Refer"];
  const fracRows: string[][] = [];
  for (let r = 1; r <= 5; r++) {
    fracRows.push([`R${r}`, `Provide ward care area ${r}`, "", "", "", "IPHS 2022", "Facility standard"]);
    for (let a = 1; a <= 4; a++) {
      const j = (r - 1) * 4 + a;
      fracRows.push([`A${j}`, `${verbs[a - 1]} ${topic(j)}`, "Yes", "Yes", `SN${((j - 1) % 10) + 1}@L3`, "IPHS 2022", "Facility standard"]);
    }
  }
  return [
    {
      name: "FRAC",
      rows: [["Role", "Activity", "P1: Staff Nurse at DH ward", "P2: Staff Nurse at CHC", "Tentative Competency Label", "Source", "Source tier"], ...fracRows],
    },
    {
      name: "Competencies",
      rows: [["Competency Code", "Competency Label", "Competency Description", "Competency Type", "Competency Area", ...levelCols()], ...comps],
    },
  ];
}

export const SAMPLES = {
  "sample-GNM-dictionary.xlsx": gnmSample,
  "sample-ANM-competencies.xlsx": anmSample,
  "sample-Staff-Nurse-competencies.xlsx": staffNurseSample,
} as const;
