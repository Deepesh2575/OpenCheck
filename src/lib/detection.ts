export interface CorpusDocument {
  id: string;
  title: string;
  text: string;
  url?: string;
  provider?: string;
  published?: string;
  evidenceType?: "document" | "abstract" | "snippet" | "title";
}

export interface MatchedPassage {
  start: number;
  end: number;
  text: string;
  sourceId: string;
  sourceTitle: string;
}

export interface SourceMatch {
  sourceId: string;
  sourceTitle: string;
  matchedWords: number;
  percent: number;
  passages: MatchedPassage[];
  sourceUrl?: string;
  sourceProvider?: string;
  evidenceType?: CorpusDocument["evidenceType"];
}

export interface SimilarityReport {
  wordCount: number;
  overallPercent: number;
  matches: SourceMatch[];
  highlights: Array<{ start: number; end: number }>;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

interface Fingerprint {
  signature: string;
  hash: number;
  startToken: number;
  endToken: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    tokens.push({
      value: match[0].toLowerCase(),
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

function hashSignature(signature: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shingles(tokens: Token[], requestedKgram = 5): Fingerprint[] {
  if (tokens.length === 0) return [];

  const kgram = Math.min(requestedKgram, tokens.length);
  const grams: Fingerprint[] = [];
  for (let start = 0; start <= tokens.length - kgram; start += 1) {
    const signature = tokens
      .slice(start, start + kgram)
      .map((token) => token.value)
      .join(" ");
    grams.push({
      signature,
      hash: hashSignature(signature),
      startToken: start,
      endToken: start + kgram,
    });
  }
  return grams;
}

function fingerprint(tokens: Token[], requestedKgram = 5, requestedWindow = 4): Fingerprint[] {
  const grams = shingles(tokens, requestedKgram);
  if (grams.length === 0) return [];
  const window = Math.min(requestedWindow, grams.length);
  const selected: Fingerprint[] = [];
  let previousIndex = -1;
  for (let start = 0; start <= grams.length - window; start += 1) {
    let minimumIndex = start;
    for (let index = start + 1; index < start + window; index += 1) {
      if (grams[index].hash <= grams[minimumIndex].hash) minimumIndex = index;
    }
    if (minimumIndex !== previousIndex) {
      selected.push(grams[minimumIndex]);
      previousIndex = minimumIndex;
    }
  }
  return selected;
}

function mergeTokenRanges(ranges: Array<{ start: number; end: number }>) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function compareWithCorpus(
  text: string,
  corpus: CorpusDocument[],
): SimilarityReport {
  const tokens = tokenize(text);
  const queryFingerprints = fingerprint(tokens);
  const queryShingles = shingles(tokens);
  const queryBySignature = new Map<string, Fingerprint[]>();
  for (const item of queryShingles) {
    const matching = queryBySignature.get(item.signature) ?? [];
    matching.push(item);
    queryBySignature.set(item.signature, matching);
  }
  const selectedQuerySignatures = new Set(queryFingerprints.map((item) => item.signature));

  const matchedQueryTokens = new Set<number>();
  const matches: SourceMatch[] = [];

  for (const source of corpus) {
    const sourceTokens = tokenize(source.text);
    const sourceFingerprints = fingerprint(sourceTokens);
    if (!sourceFingerprints.some((item) => selectedQuerySignatures.has(item.signature))) continue;

    const sourceShingles = shingles(sourceTokens);
    const sharedSignatures = new Set(
      sourceShingles
        .map((item) => item.signature)
        .filter((signature) => queryBySignature.has(signature)),
    );
    const sourceRanges: Array<{ start: number; end: number }> = [];
    const queryRanges: Array<{ start: number; end: number }> = [];

    for (const sourceShingle of sourceShingles) {
      if (sharedSignatures.has(sourceShingle.signature)) {
        sourceRanges.push({
          start: sourceShingle.startToken,
          end: sourceShingle.endToken,
        });
      }
    }
    for (const queryShingle of queryShingles) {
      if (sharedSignatures.has(queryShingle.signature)) {
        queryRanges.push({
          start: queryShingle.startToken,
          end: queryShingle.endToken,
        });
        for (
          let tokenIndex = queryShingle.startToken;
          tokenIndex < queryShingle.endToken;
          tokenIndex += 1
        ) {
          matchedQueryTokens.add(tokenIndex);
        }
      }
    }

    const mergedSourceRanges = mergeTokenRanges(sourceRanges);
    const passages = mergedSourceRanges.map((range) => {
      const first = sourceTokens[range.start];
      const next = sourceTokens[range.end];
      const end = next?.start ?? source.text.length;
      return {
        start: first.start,
        end,
        text: source.text.slice(first.start, end).trimEnd(),
        sourceId: source.id,
        sourceTitle: source.title,
      };
    });
    const matchedWords = mergeTokenRanges(queryRanges).reduce(
      (total, range) => total + range.end - range.start,
      0,
    );

    if (matchedWords > 0) {
      matches.push({
        sourceId: source.id,
        sourceTitle: source.title,
        matchedWords,
        percent: tokens.length === 0 ? 0 : (matchedWords / tokens.length) * 100,
        passages,
        ...(source.url ? { sourceUrl: source.url } : {}),
        ...(source.provider ? { sourceProvider: source.provider } : {}),
        ...(source.evidenceType ? { evidenceType: source.evidenceType } : {}),
      });
    }
  }

  const highlights = mergeTokenRanges(
    [...matchedQueryTokens].map((index) => ({ start: index, end: index + 1 })),
  ).map((range) => ({
    start: tokens[range.start].start,
    end: tokens[range.end]?.start ?? text.length,
  }));

  matches.sort((left, right) => right.matchedWords - left.matchedWords);
  return {
    wordCount: tokens.length,
    overallPercent:
      tokens.length === 0 ? 0 : (matchedQueryTokens.size / tokens.length) * 100,
    matches,
    highlights,
  };
}

export function excludeReferences(text: string): string {
  const heading = /^\s*(?:references|bibliography|works cited|sources)\s*:?\s*$/gim;
  const match = heading.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}
