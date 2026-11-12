// The layout of each standard sheet a team can upload (Roles, Competencies, Sources), shared by the
// importer (import-sheets.ts) and the downloadable templates (templates.ts) so the two cannot drift. The
// layouts are the Creator's own Excel export (excel/workbook-writer.ts), so a downloaded FRAC re-imports.

import type { SheetKind } from "../../models/frac.model.ts";

/** One column of a template: its header and what the Instructions sheet says about it. */
export interface TemplateColumn {
  header: string;
  help: string;
}

export interface SheetFormat {
  /** The sheet name in the template (the importer finds sheets by header row, not by name). */
  sheet: string;
  columns: TemplateColumn[];
  /** Example rows in the template, one per array. */
  example: string[][];
  /** Extra lines for the Instructions sheet. */
  notes: string[];
}

/** Source tiers the Creator uses (spec 3, rule 8); other values are kept as typed. */
export const SOURCE_TIERS = ["JD", "Programme guideline", "Facility standard", "Inferred – verify"] as const;

export const SHEET_FORMATS: Record<SheetKind, SheetFormat> = {
  roles: {
    sheet: "FRAC",
    columns: [
      { header: "Role", help: 'The code: "R1", "R2"… on a role row, "A1", "A2"… on each activity row under it. Codes are renumbered on import.' },
      { header: "Activity", help: "On a role row, the role title (an area of work, e.g. \"Conduct VHSND sessions\"). On an activity row, one observable activity starting with a performance verb." },
      { header: "P1: ANM at Sub-Centre (outreach)", help: 'One column per posting, at most 3, headed "P1: <where the position works>". Write Yes or No on each activity row; leave role rows blank.' },
      { header: "P2: ANM at delivery-point PHC", help: "Second posting (optional). Delete the column if there is only one posting." },
      { header: "Source", help: "The document the role or activity comes from, e.g. \"ANM job responsibilities, MoHFW\"." },
      { header: "Source tier", help: `On activity rows: ${SOURCE_TIERS.join(" | ")}.` },
    ],
    example: [
      ["R1", "Conduct VHSND sessions", "", "", "VHSND guidelines, MoHFW", ""],
      ["A1", "Conduct immunisation sessions as per the UIP schedule", "Yes", "Yes", "UIP guidelines", "Programme guideline"],
      ["A2", "Screen pregnant women for danger signs and refer", "Yes", "No", "ANM job responsibilities", "JD"],
      ["R2", "Maintain records and reports", "", "", "ANM job responsibilities", ""],
      ["A3", "Maintain the RCH register and update the RCH portal", "Yes", "Yes", "RCH portal manual", "JD"],
    ],
    notes: [
      "Rows run in order: a role row, then its activity rows, then the next role row.",
      "A role with no activity rows is kept; the Roles step writes activities for it (the other roles are not touched).",
      "A Creator download (its FRAC sheet) can be uploaded as it is.",
    ],
  },
  competencies: {
    sheet: "Competencies",
    columns: [
      { header: "Competency Code", help: 'A unique code, e.g. "ANM1". Activities are mapped to these codes.' },
      { header: "Competency Label", help: "A short noun phrase, e.g. \"Immunisation session management\"." },
      { header: "Competency Description", help: "One sentence starting with a verb." },
      { header: "Competency Type", help: "Domain, Functional or Behavioural." },
      { header: "Competency Area (PH/Digital/Data literacy)", help: "The area, e.g. Public health." },
      ...[1, 2, 3, 4, 5].flatMap((n) => [
        { header: `Competency Level ${n} Label`, help: n === 1 ? "Optional. Fill all five levels to keep this ladder; the Level ladders step then skips this competency." : `Level ${n} label (optional, see Level 1).` },
        { header: `Competency Level ${n} Description`, help: n === 1 ? 'Optional. 2–4 indicators; each after the first on a new line starting with "-".' : `Level ${n} indicators (optional).` },
      ]),
      { header: "KCM Alignment (CBC Karmayogi Competency Model)", help: 'The KCM competency name, or "Domain – department-defined".' },
    ],
    example: [
      [
        "ANM1", "Immunisation session management", "Conducts immunisation sessions as per the UIP schedule", "Domain", "Public health",
        "Identifies eligible beneficiaries", "Identifies due beneficiaries from the due list\n- Lists vaccines and cold-chain items needed",
        "Prepares a session under supervision", "Sets up the session site with a supervisor\n- Follows the vaccine checklist",
        "Conducts a session independently", "Conducts the session to protocol\n- Records doses in U-WIN",
        "Manages adverse events and drop-outs", "Manages an AEFI to protocol and refers in time\n- Tracks and recalls drop-outs",
        "Audits and mentors session practice", "Audits session records against the UIP checklist\n- Mentors new ANMs on session practice",
        "Domain – department-defined",
      ],
      ["ANM2", "Records and reporting", "Maintains registers and portal entries accurately", "Functional", "Data literacy", "", "", "", "", "", "", "", "", "", "", "Data-based decision-making"],
    ],
    notes: [
      "Competencies without a full ladder (all five level labels) get one from the Level ladders step.",
      "With a Competencies sheet, the Competencies step only maps activities to your codes; it does not write new competencies.",
      "A Creator download (its Competencies sheet) can be uploaded as it is.",
    ],
  },
  sources: {
    sheet: "Sources",
    columns: [
      { header: "Title", help: "The document title, as published." },
      { header: "Issuer", help: "Who issued it, e.g. MoHFW, NHM Bihar." },
      { header: "Year", help: 'The year of issue; write "verify" when unsure.' },
      { header: "Use", help: "What it is used for in this FRAC, e.g. \"Duties at Sub-Centre\"." },
      { header: "Tier", help: `${SOURCE_TIERS.join(" | ")}.` },
      { header: "URL", help: "Optional link to the document (http:// or https://). Shown as View source." },
    ],
    example: [
      ["Indian Public Health Standards 2022: Sub-Centre", "MoHFW", "2022", "Staffing and job descriptions", "Facility standard", "https://nhm.gov.in/"],
      ["ANM job responsibilities", "MoHFW", "verify", "Duties of the ANM", "JD", ""],
    ],
    notes: [
      "With a Sources sheet, research uses these sources and does not search the web.",
      "Never invent page or circular numbers; write \"verify\" when unsure.",
    ],
  },
};

/** What a brief document (JD or government order) should contain; served as the "brief" template. */
export const BRIEF_GUIDE = `FRAC Studio: what to upload as a job description or government order
====================================================================

Upload a PDF, Word (.docx) or text (.txt) file. Scanned PDFs without a text layer cannot be read.
Up to 3 documents per FRAC. Only the text is kept, and only the first 30,000 characters of each.

The research step reads these documents first and searches the web only once, so the more of the
following they contain, the better the FRAC and the cheaper the research:

1. Position name and the department or programme that employs it (e.g. "ANM, NHM Bihar").
2. Where the position works (the postings): Sub-Centre, PHC, CHC, outreach, ward…
3. Duties and responsibilities, as a list.
4. What the position may NOT do, or must refer onward.
5. Reporting line: who supervises the position, whom it supervises.
6. Programmes it delivers (e.g. UIP, RMNCH+A, NTEP, NP-NCD) and the registers or portals it uses.
7. State-specific schemes, languages or endemic diseases, if any.
8. The issuer, the order or circular number and the date, exactly as printed.

Example (a short JD that works well):

  Position: Auxiliary Nurse Midwife (ANM), Sub-Centre, NHM Bihar
  Reports to: Medical Officer, PHC
  Duties:
  - Conduct immunisation sessions as per the UIP schedule
  - Register pregnant women and provide antenatal check-ups
  - Screen for danger signs and refer to the PHC
  - Maintain the RCH register and update the RCH portal
  Not permitted: prescribing drugs outside standing orders
  Issued by: State Health Society, Bihar, order no. ___ dated ___
`;
