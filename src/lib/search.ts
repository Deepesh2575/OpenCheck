export interface SearchSource {
  id: string;
  title: string;
  text: string;
  url: string;
  provider: string;
  published?: string;
  evidenceType: "abstract" | "snippet" | "title";
}

export interface SearchQueryResult {
  sources: SearchSource[];
  errors: string[];
}

export function extractSearchQueries(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => (sentence.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 9);

  const distinct: string[] = [];
  for (const sentence of sentences.length > 0
    ? sentences
    : words.length >= 9
      ? [words.slice(0, 15).join(" ")]
      : []) {
    const query = sentence.slice(0, 115).replace(/[<>]/g, "").trim();
    if (!distinct.some((previous) => previous.toLowerCase() === query.toLowerCase())) {
      distinct.push(query);
    }
    if (distinct.length === 2) break;
  }
  return distinct;
}

export async function searchExternalSources(
  queries: string[],
  options: { webApiKey?: string; signal?: AbortSignal } = {},
): Promise<SearchQueryResult> {
  const response = await fetch("/api/sources/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.webApiKey ? { "X-Brave-Search-Key": options.webApiKey } : {}),
    },
    body: JSON.stringify({ queries }),
    signal: options.signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Source search failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("sources" in payload) ||
    !Array.isArray(payload.sources) ||
    !("errors" in payload) ||
    !Array.isArray(payload.errors)
  ) {
    throw new Error("Source search returned an unexpected response.");
  }
  return payload as SearchQueryResult;
}

export interface WritingStyleReview {
  assessment: "signals_observed" | "no_clear_signals" | "inconclusive";
  summary: string;
  signals: string[];
  caveat: string;
}

export async function requestWritingStyleReview(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WritingStyleReview> {
  const response = await fetch("/api/ai/style-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, apiKey }),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `AI style review failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("review" in payload) ||
    typeof payload.review !== "object" ||
    payload.review === null
  ) {
    throw new Error("AI style review returned an unexpected response.");
  }
  const review = payload.review as Partial<WritingStyleReview>;
  if (
    !["signals_observed", "no_clear_signals", "inconclusive"].includes(
      String(review.assessment),
    ) ||
    typeof review.summary !== "string" ||
    review.summary.length > 1000 ||
    !Array.isArray(review.signals) ||
    review.signals.length > 3 ||
    !review.signals.every((item) => typeof item === "string" && item.length <= 500) ||
    typeof review.caveat !== "string" ||
    review.caveat.length > 1000
  ) {
    throw new Error("AI style review returned an invalid result.");
  }
  return review as WritingStyleReview;
}
