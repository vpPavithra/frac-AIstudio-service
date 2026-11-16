import { sslOption } from "./db.ts";

describe("sslOption", () => {
  it("is off unless POSTGRES_SSL is true, and verifies the certificate unless told not to", () => {
    expect(sslOption({})).toBeUndefined();
    expect(sslOption({ POSTGRES_SSL: "false" })).toBeUndefined();
    expect(sslOption({ POSTGRES_SSL: "true" })).toEqual({ rejectUnauthorized: true });
    expect(sslOption({ POSTGRES_SSL: "true", POSTGRES_SSL_REJECT_UNAUTHORIZED: "false" })).toEqual({ rejectUnauthorized: false });
  });
});
