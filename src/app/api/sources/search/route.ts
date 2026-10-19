import { NextRequest, NextResponse } from "next/server";
import type { SearchSource } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_QUERIES = 2;
const MAX_QUERY_LENGTH = 115;
const USER_AGENT = "OpenCheck/0.1 (open-source academic similarity checker)";

function asText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      Number.isSafeInteger(Number(code)) && Number(code) <= 0x10ffff
        ? String.fromCodePoint(Number(code))
        : "",
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      Number.isSafeInteger(parseInt(code, 16)) && parseInt(code, 16) <= 0x10ffff
        ? String.fromCodePoint(parseInt(code, 16))
        : "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function asString(value: unknown): string {
  if (typeof value === "string") return asText(value);
  if (Array.isArray(value)) return asText(value[0]);
  return "";
}

function source(
  provider: string,
  id: string,
  title: unknown,
  content: unknown,
  url: unknown,
  published?: unknown,
  evidenceType?: SearchSource["evidenceType"],
): SearchSource | null {
  const safeTitle = asString(title);
  const safeUrl = asString(url);
  if (!safeTitle || !safeUrl || !/^https?:\/\//i.test(safeUrl)) return null;
  return {
    id: `${provider}:${id || safeUrl}`,
    title: safeTitle,
    text: asText(content) || safeTitle,
    url: safeUrl,
    provider,
    evidenceType: evidenceType ?? (provider === "Brave Search" ? "snippet" : content ? "abstract" : "title"),
    ...(typeof published === "string" && published ? { published } : {}),
  };
}

async function fetchText(url: URL, headers: HeadersInit = {}, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...headers },
    signal: signal ?? AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url: URL, headers: HeadersInit = {}, signal?: AbortSignal) {
  return JSON.parse(await fetchText(url, headers, signal)) as Record<string, unknown>;
}

function getList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function dateFromParts(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("date-parts" in value)) return;
  const parts = getList(value["date-parts"])[0];
  if (!parts) return;
  const year = parts["0"];
  return typeof year === "number" ? String(year) : undefined;
}

function decodeXml(value: string): string {
  return asText(value);
}

function atomEntries(xml: string): SearchSource[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].flatMap((entry) => {
    const body = entry[1];
    const field = (name: string) =>
      body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
    const link = body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const item = source(
      "arXiv",
      field("id"),
      field("title"),
      field("summary"),
      link || field("id"),
      field("published").slice(0, 4),
    );
    return item ? [item] : [];
  });
}

function pubmedEntries(xml: string): SearchSource[] {
  return [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)].flatMap((entry) => {
    const body = entry[1];
    const id = body.match(/<PMID[^>]*>([^<]+)<\/PMID>/i)?.[1] ?? "";
    const title = body.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/i)?.[1] ?? "";
    const year = body.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/i)?.[1];
    const abstract = [
      ...body.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/gi),
    ]
      .map((part) => decodeXml(part[1]))
      .join(" ");
    const item = source(
      "PubMed",
      id,
      title,
      abstract,
      id ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(id)}/` : "",
      year,
    );
    return item ? [item] : [];
  });
}

async function searchOpenAlex(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", "5");
  const data = await fetchJson(url, {}, signal);
  return getList(data.results).flatMap((item) => {
    const index = item.abstract_inverted_index;
    let abstract = "";
    if (typeof index === "object" && index !== null) {
      const words = new Map<number, string>();
      for (const [word, positions] of Object.entries(index)) {
        if (Array.isArray(positions)) {
          for (const position of positions) {
            if (typeof position === "number") words.set(position, word);
          }
        }
      }
      abstract = [...words.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, word]) => word)
        .join(" ");
    }
    const title = asString(item.title);
    const itemUrl = asString(item.doi) || asString(item.id);
    const id = asString(item.id);
    const result = source(
      "OpenAlex",
      id,
      title,
      abstract || title,
      itemUrl,
      typeof item.publication_year === "number" ? String(item.publication_year) : undefined,
      abstract ? "abstract" : "title",
    );
    return result ? [result] : [];
  });
}

async function searchCrossref(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", "5");
  const data = await fetchJson(url, {}, signal);
  const message = data.message as Record<string, unknown> | undefined;
  return getList(message?.items).flatMap((item) => {
    const doi = asString(item.DOI);
    const title = asString(item.title);
    const result = source(
      "Crossref",
      doi,
      title,
      item.abstract,
      doi ? `https://doi.org/${encodeURIComponent(doi)}` : item.URL,
      dateFromParts(item.published),
    );
    return result ? [result] : [];
  });
}

async function searchEuropePmc(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "5");
  const data = await fetchJson(url, {}, signal);
  const resultList = data.resultList as Record<string, unknown> | undefined;
  return getList(resultList?.result).flatMap((item) => {
    const doi = asString(item.doi);
    const pmid = asString(item.pmid);
    const id = doi || pmid || asString(item.id);
    const url = doi
      ? `https://doi.org/${encodeURIComponent(doi)}`
      : pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
        : `https://europepmc.org/article/${encodeURIComponent(asString(item.source) || "MED")}/${encodeURIComponent(asString(item.id))}`;
    const result = source("Europe PMC", id, item.title, item.abstractText, url, asString(item.firstPublicationDate).slice(0, 4));
    return result ? [result] : [];
  });
}

async function searchSemanticScholar(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,abstract,year,url,paperId");
  const data = await fetchJson(url, {}, signal);
  return getList(data.data).flatMap((item) => {
    const result = source(
      "Semantic Scholar",
      asString(item.paperId),
      item.title,
      item.abstract,
      item.url,
      typeof item.year === "number" ? String(item.year) : undefined,
    );
    return result ? [result] : [];
  });
}

async function searchArxiv(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("max_results", "5");
  return atomEntries(await fetchText(url, {}, signal));
}

async function searchPubmed(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", query);
  searchUrl.searchParams.set("retmax", "5");
  searchUrl.searchParams.set("retmode", "json");
  const search = await fetchJson(searchUrl, {}, signal);
  const esearch = search.esearchresult as Record<string, unknown> | undefined;
  const ids = Array.isArray(esearch?.idlist)
    ? esearch.idlist.filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return [];
  const fetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  fetchUrl.searchParams.set("db", "pubmed");
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("retmode", "xml");
  return pubmedEntries(await fetchText(fetchUrl, {}, signal));
}

async function searchBrave(
  query: string,
  key: string,
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  const data = await fetchJson(url, { "X-Subscription-Token": key }, signal);
  const web = data.web as Record<string, unknown> | undefined;
  return getList(web?.results).flatMap((item) => {
    const result = source(
      "Brave Search",
      asString(item.url),
      item.title,
      item.description,
      item.url,
      undefined,
      "snippet",
    );
    return result ? [result] : [];
  });
}

const ACADEMIC_PROVIDERS: Array<[string, (query: string, signal?: AbortSignal) => Promise<SearchSource[]>]> = [
  ["OpenAlex", searchOpenAlex],
  ["Crossref", searchCrossref],
  ["Europe PMC", searchEuropePmc],
  ["Semantic Scholar", searchSemanticScholar],
  ["arXiv", searchArxiv],
  ["PubMed", searchPubmed],
];

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "Search requests must use application/json." },
      { status: 415 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) {
    return NextResponse.json({ error: "Search requests must be 4 KB or smaller." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("queries" in payload) ||
    !Array.isArray(payload.queries) ||
    payload.queries.length < 1 ||
    payload.queries.length > MAX_QUERIES ||
    !payload.queries.every(
      (query) =>
        typeof query === "string" &&
        query.trim().length > 0 &&
        query.length <= MAX_QUERY_LENGTH &&
        !/[\u0000-\u001f]/u.test(query),
    )
  ) {
    return NextResponse.json(
      { error: "Provide one or two search phrases, each no longer than 115 characters." },
      { status: 400 },
    );
  }

  const queries = [...new Set((payload.queries as string[]).map((query) => query.trim()))];
  const webKey = request.headers.get("x-brave-search-key")?.trim() ?? "";
  if (webKey.length > 512 || /[\r\n]/u.test(webKey)) {
    return NextResponse.json({ error: "The web search key is invalid." }, { status: 400 });
  }
  const signal = AbortSignal.timeout(25_000);
  const sources: SearchSource[] = [];
  const errors: string[] = [];

  const tasks = queries.flatMap((query) => [
    ...ACADEMIC_PROVIDERS.map(([name, search]) => ({
      name,
      run: () => search(query, signal),
    })),
    ...(webKey ? [{ name: "Brave Search", run: () => searchBrave(query, webKey, signal) }] : []),
  ]);

  const outcomes = await Promise.allSettled(tasks.map((task) => task.run()));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      sources.push(...outcome.value);
    } else {
      errors.push(`${tasks[index].name}: ${outcome.reason instanceof Error ? outcome.reason.message : "request failed"}`);
    }
  });

  const uniqueSources = [...new Map(sources.map((item) => [item.url, item])).values()];
  return NextResponse.json(
    { sources: uniqueSources.slice(0, 40), errors },
    { headers: { "Cache-Control": "no-store" } },
  );
}
