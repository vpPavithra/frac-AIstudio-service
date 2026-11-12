// Unit tests for the document helpers: CSV reading, text extraction and tidying, the sheet importers'
// edge cases, and research's link matching (links only from pages the web search retrieved).
import { readCsv } from "../excel/csv-reader.ts";
import { linkFor } from "../ai/source-links.ts";
import { extractDocumentText, tidyText } from "./extract-text.ts";
import { importCompetenciesSheet, importRolesSheet, importSourcesSheet } from "./import-sheets.ts";

describe("readCsv", () => {
  it("reads quotes, doubled quotes, CRLF and a byte-order mark, and drops blank rows", () => {
    const csv = '﻿Role,Activity\r\nR1,"Screen, refer"\r\n\r\nA1,"Say ""hello"""\n';
    expect(readCsv(Buffer.from(csv), "roles.csv")).toEqual([{ name: "roles.csv", rows: [["Role", "Activity"], ["R1", "Screen, refer"], ["A1", 'Say "hello"']] }]);
  });
});

describe("brief documents", () => {
  it("tidies PDF-style spacing", () => {
    expect(tidyText("  Duties:\r\n\n\n\n-  Screen   women \t\n")).toBe("Duties:\n\n- Screen women");
  });

  it("reads text files and refuses other types or empty files", async () => {
    await expect(extractDocumentText("jd.txt", Buffer.from("Position: ANM"))).resolves.toEqual({ text: "Position: ANM", truncated: false });
    await expect(extractDocumentText("jd.doc", Buffer.from("x"))).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
    await expect(extractDocumentText("jd.txt", Buffer.from("   \n "))).rejects.toMatchObject({ code: "FILE_UNREADABLE" });
    await expect(extractDocumentText("jd.pdf", Buffer.from("not a pdf"))).rejects.toMatchObject({ code: "FILE_UNREADABLE" });
  });
});

describe("standard sheet importers", () => {
  const sheet = (rows: string[][]) => [{ name: "Sheet1", rows }];

  it("keeps at most 3 postings and warns about untitled roles", () => {
    const { roles, postings, warnings } = importRolesSheet(sheet([
      ["Role", "Activity", "P1: A", "P2: B", "P3: C", "P4: D"],
      ["R1", "", "", "", "", ""],
      ["A1", "Screen women", "Yes", "No", "y", "n"],
    ]));
    expect(postings.map((p) => p.label)).toEqual(["A", "B", "C"]);
    expect(roles[0].activities[0].postings).toEqual({ P1: "Yes", P2: "No", P3: "Yes" });
    expect(warnings).toEqual(["Only the first 3 posting columns were kept.", "1 role row(s) have no title; add one in Roles & activities."]);
  });

  it("keeps a ladder only when all five levels are filled, and the first of a repeated code", () => {
    const header = ["Competency Code", "Competency Label", ...[1, 2, 3, 4, 5].flatMap((n) => [`Competency Level ${n} Label`, `Competency Level ${n} Description`])];
    const full = ["C1", "Immunisation", ...[1, 2, 3, 4, 5].flatMap((n) => [`L${n}`, `d${n}`])];
    const partial = ["C2", "Records", "L1", "d1", "", "", "", "", "", "", "", ""];
    const { competencies, warnings } = importCompetenciesSheet(sheet([header, full, partial, ["C1", "Again"]]));
    expect(competencies.map((c) => [c.code, c.levels?.length ?? null])).toEqual([["C1", 5], ["C2", null]]);
    expect(warnings).toEqual(["Competency C1 appears more than once; the first row was kept."]);
  });

  it("finds a sources table below other rows, as in a Creator download", () => {
    const rows = [["FRAC Studio"], ...Array.from({ length: 13 }, () => ["note", "x"]), ["Title", "Issuer", "Year", "Use", "Tier", "URL"], ["IPHS", "MoHFW", "2022", "Staffing", "JD", ""]];
    expect(importSourcesSheet(sheet(rows)).sources).toEqual([{ title: "IPHS", issuer: "MoHFW", year: "2022", use: "Staffing", tier: "JD" }]);
    expect(() => importSourcesSheet(sheet([["a", "b"]]))).toThrow(expect.objectContaining({ code: "SHEET_NOT_RECOGNISED" }));
  });
});

describe("linkFor", () => {
  const pages = [
    { url: "https://nhm.gov.in/iphs-2022.pdf", title: "Indian Public Health Standards 2022 Sub-Centre" },
    { url: "https://mohfw.gov.in/anm", title: "Job responsibilities of the ANM" },
  ];

  it("matches by title, containment or most words, and never guesses", () => {
    expect(linkFor("Job responsibilities of the ANM", pages)).toBe("https://mohfw.gov.in/anm");
    expect(linkFor("Indian Public Health Standards 2022", pages)).toBe("https://nhm.gov.in/iphs-2022.pdf");
    expect(linkFor("Public Health Standards 2022 Sub-Centre (IPHS)", pages)).toBe("https://nhm.gov.in/iphs-2022.pdf");
    expect(linkFor("NTEP training modules", pages)).toBe("");
    expect(linkFor("", pages)).toBe("");
  });
});
