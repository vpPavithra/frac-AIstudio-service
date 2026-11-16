import ExcelJS from "exceljs";
import { assertZipSafe, summarizeZip, withParseTimeout } from "./zip-guard.ts";

async function xlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("FRAC").addRows([["Role", "Activity"], ["R1", "Outreach"]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A copy of `zip` whose first central-directory entry claims `size` unpacked bytes (a crafted "zip bomb" header). */
function claimSize(zip: Buffer, size: number): Buffer {
  const copy = Buffer.from(zip);
  const at = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  copy.writeUInt32LE(size, at + 24);
  return copy;
}

describe("zip guard", () => {
  it("reads the entry count and unpacked size of a real workbook, and lets it through", async () => {
    const file = await xlsx();
    const summary = summarizeZip(file);
    expect(summary?.entries).toBeGreaterThan(3);
    expect(summary?.uncompressedBytes).toBeGreaterThan(file.length / 2);
    expect(() => assertZipSafe(file, "roles.xlsx")).not.toThrow();
  });

  it("refuses a file whose parts claim to unpack past the limit", async () => {
    const bomb = claimSize(await xlsx(), 0xfffffffe);
    expect(() => assertZipSafe(bomb, "bomb.xlsx")).toThrow(expect.objectContaining({ status: 400, code: "FILE_TOO_COMPLEX" }));
  });

  it("refuses a ZIP64 entry, which Office files never need", async () => {
    const zip64 = claimSize(await xlsx(), 0xffffffff);
    expect(() => assertZipSafe(zip64, "z64.docx")).toThrow(expect.objectContaining({ code: "FILE_TOO_COMPLEX" }));
  });

  it("refuses more entries than allowed", async () => {
    const file = await xlsx();
    const copy = Buffer.from(file);
    const eocd = copy.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    copy.writeUInt16LE(5000, eocd + 10);
    expect(() => assertZipSafe(copy, "many.xlsx")).toThrow(expect.objectContaining({ code: "FILE_TOO_COMPLEX" }));
  });

  it("leaves a file that is not a zip to the parser", () => {
    expect(summarizeZip(Buffer.from("just text, not a zip"))).toBeNull();
    expect(() => assertZipSafe(Buffer.from("plain"), "jd.docx")).not.toThrow();
  });

  it("times out a parse that takes too long, and passes a quick one through", async () => {
    await expect(withParseTimeout(new Promise(() => undefined), "slow.pdf", 20)).rejects.toMatchObject({ code: "FILE_TOO_COMPLEX" });
    await expect(withParseTimeout(Promise.resolve("ok"), "quick.pdf", 1000)).resolves.toBe("ok");
  });
});
