import type { Frac } from "../../models/frac.model.ts";
import { reviewGuard } from "./prompts.ts";

const frac = (cadre: string) => ({ cadre, cadreFull: "" }) as unknown as Frac;

describe("reviewGuard: the Reviewer's rules in the Creator's prompts", () => {
  it("gives an ANM FRAC every scope rule with what to write instead, and the outdated names", () => {
    const g = reviewGuard(frac("ANM"));
    expect(g).toContain("THE EXPERT CHECK FLAGS THESE AS BEYOND ANM SCOPE");
    expect(g).toContain("- Managing complications or complicated deliveries. Write instead: Identify complications");
    expect(g).toContain("- Unspecified emergency drugs. Write instead: Name only the drugs");
    expect(g).toContain('never write "emergency drugs"');
    expect(g).toContain("OUTDATED NAMES THE EXPERT CHECK FLAGS");
  });

  it("gives a cadre with no scope rules only the outdated names", () => {
    const g = reviewGuard(frac("Data Entry Operator"));
    expect(g).not.toContain("BEYOND");
    expect(g).toContain("OUTDATED NAMES");
  });
});
