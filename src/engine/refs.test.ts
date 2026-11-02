import { dominantPrefix, formatRefs, normalizeCode, parseRefs } from "./refs.js";

const codes = (input: string, prefix = "") => parseRefs(input, prefix).map((r) => (r.level ? `${r.code}@${r.level}` : r.code));

describe("parseRefs", () => {
  it("returns nothing for empty input", () => {
    expect(parseRefs("")).toEqual([]);
    expect(parseRefs(null)).toEqual([]);
  });

  it("reads single codes in every spelling", () => {
    expect(codes("C12")).toEqual(["C12"]);
    expect(codes("c12@L3")).toEqual(["C12@3"]);
    expect(codes("C12 L3")).toEqual(["C12@3"]);
    expect(codes("C12L3")).toEqual(["C12@3"]);
    expect(codes("ANM3@L3, ANM5")).toEqual(["ANM3@3", "ANM5"]);
    expect(codes("C4 Level 2")).toEqual(["C4@2"]);
  });

  it("takes the highest level of a level range", () => {
    expect(codes("ME50L2-L5")).toEqual(["ME50@5"]);
    expect(codes("ME50 L2–L5")).toEqual(["ME50@5"]);
  });

  it("expands code ranges and caps them at 80", () => {
    expect(codes("C3-C6")).toEqual(["C3", "C4", "C5", "C6"]);
    expect(codes("C3-6")).toEqual(["C3", "C4", "C5", "C6"]);
    expect(parseRefs("C1-C500")).toHaveLength(80);
  });

  it("never treats L as a code prefix", () => {
    expect(codes("L2-L5")).toEqual([]);
    expect(codes("L3")).toEqual([]);
  });

  it("prefixes bare numbers with the dominant prefix", () => {
    expect(codes("26, 27", "ANM")).toEqual(["ANM26", "ANM27"]);
    expect(codes("26-28", "C")).toEqual(["C26", "C27", "C28"]);
    expect(codes("26")).toEqual([]);
  });

  it("does not read codes out of the middle of words", () => {
    expect(codes("COMPETENCY12 and see C4")).toEqual(["C4"]);
  });

  it("dedupes keeping the first occurrence", () => {
    expect(codes("C3@L3, C3@L4, C03")).toEqual(["C3@3"]);
  });
});

describe("helpers", () => {
  it("normalizeCode drops spaces and leading zeros", () => {
    expect(normalizeCode(" anm 03 ")).toBe("ANM3");
    expect(normalizeCode("X-1")).toBe("X-1");
  });

  it("dominantPrefix picks the most common prefix", () => {
    expect(dominantPrefix(["ANM1", "ANM2", "B1", "anm3"])).toBe("ANM");
    expect(dominantPrefix([])).toBe("");
  });

  it("formatRefs round-trips through parseRefs", () => {
    const refs = parseRefs("C1@L3, C2");
    expect(formatRefs(refs)).toBe("C1@L3, C2");
  });
});
