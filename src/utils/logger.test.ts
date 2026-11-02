import { describeError } from "./logger.js";

describe("describeError", () => {
  it("uses the message when there is one", () => {
    expect(describeError(new Error("LLM timed out"))).toBe("LLM timed out");
  });

  it("explains a refused Postgres connection, whose message is empty", () => {
    const refused = (address: string) => Object.assign(new Error(""), { code: "ECONNREFUSED", address, port: 5432 });
    const err = Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
    expect(describeError(err)).toBe("ECONNREFUSED: ECONNREFUSED ::1:5432; ECONNREFUSED 127.0.0.1:5432");
  });

  it("describes values that are not errors", () => {
    expect(describeError("boom")).toBe("boom");
  });
});
