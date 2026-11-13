// Unit tests for research source links: only real pages are kept (searched, or on a research or link domain
// and answering), and a check never reaches an internal address.
// Uses the domains in config/service.json (RESEARCH_SEARCH_DOMAINS, SOURCE_LINK_DOMAINS).
import { jest } from "@jest/globals";
import { linkSources, onDomains, probeLink, titleMatch, webLink } from "./source-links.ts";

const source = (title: string, url = "") => ({ title, issuer: "MoHFW", year: "2022", use: "JD", tier: "JD", url });

describe("webLink", () => {
  it("accepts public http(s) addresses and refuses internal or odd ones", () => {
    expect(webLink("https://nhm.gov.in/a.pdf")?.href).toBe("https://nhm.gov.in/a.pdf");
    for (const bad of ["", "verify", "ftp://nhm.gov.in/a", "javascript:alert(1)", "http://localhost:3000/x", "http://127.0.0.1/x",
      "http://[::1]/x", "http://intranet/x", "http://db.internal/x", "https://user:pw@nhm.gov.in/a"]) {
      expect(webLink(bad)).toBeNull();
    }
  });

  it("matches a host on a domain or under it", () => {
    expect(onDomains("nhm.gov.in", ["nhm.gov.in"])).toBe(true);
    expect(onDomains("www.nhm.gov.in", ["nhm.gov.in"])).toBe(true);
    expect(onDomains("evilnhm.gov.in", ["nhm.gov.in"])).toBe(false);
    expect(onDomains("example.com", [])).toBe(true);
  });
});

describe("titleMatch", () => {
  it("scores the shared words, ignoring case, punctuation and filler words", () => {
    expect(titleMatch("Indian Public Health Standards 2022", "indian public health standards (2022)")).toBe(1);
    expect(titleMatch("Indian Public Health Standards 2022", "Indian Public Health Standards : National Health Mission")).toBeGreaterThan(0.6);
    expect(titleMatch("Guidelines for ASHA", "ASHA Guidelines")).toBe(1);
    expect(titleMatch("IPHS", "Indian Public Health Standards 2022")).toBe(0);
    expect(titleMatch("", "IPHS")).toBe(0);
  });
});

describe("linkSources", () => {
  const pages = [{ url: "https://nhm.gov.in/iphs-2022.pdf", title: "Indian Public Health Standards 2022" }];

  it("keeps a searched page without a request, and falls back to the page whose title matches", async () => {
    const probe = jest.fn(async (url: string) => url);
    const out = await linkSources([source("IPHS 2022: Indian Public Health Standards", "https://nhm.gov.in/iphs-2022.pdf"),
      source("Indian Public Health Standards 2022")], pages, probe);
    expect(out.map((s) => s.url)).toEqual(["https://nhm.gov.in/iphs-2022.pdf", "https://nhm.gov.in/iphs-2022.pdf"]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("ignores a searched page whose title matches the source by 60% or less, even when the model gave it", async () => {
    const probe = jest.fn(async (url: string) => url);
    const out = await linkSources([source("IPHS", "https://nhm.gov.in/iphs-2022.pdf"), source("Public Health Standards for Sub-Centres 2012")],
      pages, probe);
    expect(out.every((s) => !("url" in s))).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("checks an address the model gave on a research domain, and drops it when it does not answer", async () => {
    const probe = jest.fn(async (url: string) => (url.includes("live") ? url : null));
    const out = await linkSources([source("A", "https://mohfw.gov.in/live.pdf"), source("B", "https://mohfw.gov.in/dead.pdf")], [], probe);
    expect(out[0].url).toBe("https://mohfw.gov.in/live.pdf");
    expect(out[1]).not.toHaveProperty("url");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("never checks an address off the research domains or an internal one", async () => {
    const probe = jest.fn(async (url: string) => url);
    const out = await linkSources([source("A", "https://example.com/jd.pdf"), source("B", "http://169.254.169.254/latest")], [], probe);
    expect(out.every((s) => !("url" in s))).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("checks an address on a link domain that is not searched (SOURCE_LINK_DOMAINS)", async () => {
    const probe = jest.fn(async (url: string) => url);
    const out = await linkSources([source("IPHS 2022", "https://nhsrcindia.org/iphs-2022"), source("Labour Care Guide", "https://www.who.int/lcg")], [], probe);
    expect(out.map((s) => s.url)).toEqual(["https://nhsrcindia.org/iphs-2022", "https://www.who.int/lcg"]);
  });
});

describe("probeLink", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const reply = (status: number, location?: string) => new Response(null, { status, headers: location ? { location } : {} });

  it("follows redirects to the final page, and retries a refused HEAD with GET", async () => {
    const fetch = jest.fn<typeof global.fetch>()
      .mockResolvedValueOnce(reply(302, "/docs/asha.pdf"))
      .mockResolvedValueOnce(reply(405))
      .mockResolvedValueOnce(reply(200));
    global.fetch = fetch;
    await expect(probeLink("https://nhm.gov.in/asha")).resolves.toBe("https://nhm.gov.in/docs/asha.pdf");
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["HEAD", "HEAD", "GET"]);
  });

  it("refuses a missing page, a redirect to an internal address and a network failure", async () => {
    global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(reply(404));
    await expect(probeLink("https://nhm.gov.in/nope")).resolves.toBeNull();
    global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(reply(301, "http://127.0.0.1/admin"));
    await expect(probeLink("https://nhm.gov.in/x")).resolves.toBeNull();
    global.fetch = jest.fn<typeof global.fetch>().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(probeLink("https://nhm.gov.in/x")).resolves.toBeNull();
  });
});
