// SOURCE LINKS for research (review decisions, Nov 2026): the View button on each source opens the page or
// document itself. runResearch (research.step.ts) calls linkSources on the model's sources before researchPatch.
// A link is kept only when it is real: a page the web search returned whose title matches the source's by more
// than SOURCE_LINK_MIN_MATCH (60%; a weaker match is ignored), or an address the model gave on one of
// the research or link domains (AI.researchSearchDomains, SOURCE_LINKS.domains) that answers a quick request.
// Reads SOURCE_LINKS and AI.researchSearchDomains.
import { AI, SOURCE_LINKS } from "../../config/constants.ts";
import type { FracSource } from "../../models/frac.model.ts";
import type { Citation } from "../../providers/text/types.ts";

const MAX_REDIRECTS = 5;
/** A server that exists but refuses automated checks: the page is kept, since the address is on a trusted domain. */
const REFUSES_CHECKS = new Set([401, 403, 429]);
const USER_AGENT = "Mozilla/5.0 (compatible; FRAC-Studio link check)";

/** Follows a link and returns the page's final address, or null when it does not answer. Injected in tests. */
export type LinkProbe = (url: string) => Promise<string | null>;

/** Words that say nothing about which document a title names. */
const FILLER = new Set(["the", "and", "for", "with", "from"]);
/** Lower-case words of 3+ letters, for matching a source title to a retrieved page's title. */
const titleWords = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FILLER.has(w)));

/** How closely two titles match, 0 to 1: twice the shared words over the words in both (a site name on the page title costs little). */
export function titleMatch(a: string, b: string): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return 0;
  return (2 * [...x].filter((w) => y.has(w)).length) / (x.size + y.size);
}

/** A searched page's title matches the source's title by more than SOURCE_LINKS.minTitleMatch. */
const matches = (title: string, page: Citation) => titleMatch(title, page.title) > SOURCE_LINKS.minTitleMatch;

/** The retrieved page that matches a source's title best, or "" when none matches by more than SOURCE_LINKS.minTitleMatch. */
export function linkFor(title: string, citations: Citation[]): string {
  let best = { url: "", score: SOURCE_LINKS.minTitleMatch };
  for (const c of citations) {
    const score = titleMatch(title, c.title);
    if (score > best.score) best = { url: c.url, score };
  }
  return best.url;
}

/**
 * The address as a URL when it is a public web link: http(s), no user name or password, and a host name
 * (no IP address, localhost or internal name), so a check never reaches the service's own network. Else null.
 */
export function webLink(address: string): URL | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const internal = host === "localhost" || /\.(localhost|local|internal)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".");
  return /^https?:$/.test(url.protocol) && !url.username && !url.password && !internal ? url : null;
}

/** The host is one of the domains, or under one. No domains configured means any host. */
export function onDomains(host: string, domains: readonly string[]): boolean {
  return !domains.length || domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** HEAD first; a server that does not allow HEAD gets a GET whose body is dropped unread. */
async function request(url: string, signal: AbortSignal): Promise<Response> {
  const init = { redirect: "manual" as const, signal, headers: { "user-agent": USER_AGENT } };
  const head = await fetch(url, { ...init, method: "HEAD" });
  if (head.status !== 405 && head.status !== 501) return head;
  const get = await fetch(url, { ...init, method: "GET" });
  await get.body?.cancel();
  return get;
}

/**
 * The default LinkProbe: follows up to MAX_REDIRECTS redirects by hand (each target must pass webLink) within
 * SOURCE_LINKS.checkTimeoutMs in total, and returns the final address when the server answers.
 */
export async function probeLink(url: string): Promise<string | null> {
  const signal = AbortSignal.timeout(SOURCE_LINKS.checkTimeoutMs);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await request(current, signal);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = webLink(new URL(location, current).href);
        if (!next) return null;
        current = next.href;
        continue;
      }
      return res.ok || REFUSES_CHECKS.has(res.status) ? current : null;
    }
  } catch {
    // Timeout, DNS failure, refused connection or TLS error: not a link to show
  }
  return null;
}

/**
 * Each source with a link the team can open, or without `url` when none is real. Tries the model's address,
 * then the retrieved page whose title matches. A page the search returned is kept only when its title matches
 * the source's by more than SOURCE_LINKS.minTitleMatch, else ignored; any other address must be on a research or
 * link domain and answer the probe. At most SOURCE_LINKS.maxChecks requests per research run, made in parallel.
 */
export async function linkSources(sources: FracSource[], citations: Citation[], probe: LinkProbe = probeLink): Promise<FracSource[]> {
  const retrieved = new Set(citations.map((c) => c.url));
  const domains = [...AI.researchSearchDomains, ...SOURCE_LINKS.domains];
  let checks = 0;
  const check = async (address: string, title: string): Promise<string | null> => {
    const url = webLink(address);
    if (!url) return null;
    if (retrieved.has(address)) return citations.some((c) => c.url === address && matches(title, c)) ? url.href : null;
    if (!onDomains(url.hostname, domains)) return null;
    if (checks >= SOURCE_LINKS.maxChecks) return null;
    checks++;
    return probe(url.href);
  };
  return Promise.all(sources.map(async ({ url: given, ...source }) => {
    const candidates = [...new Set([(given ?? "").trim(), linkFor(source.title, citations)].filter(Boolean))];
    for (const address of candidates) {
      const url = await check(address, source.title);
      if (url) return { ...source, url };
    }
    return source;
  }));
}
