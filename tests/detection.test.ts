import { describe, expect, it } from "vitest";
import {
  compareWithCorpus,
  CorpusDocument,
  excludeReferences,
} from "../src/lib/detection";

const essay =
  "Careful field research helps scientists understand how ecosystems respond to " +
  "seasonal changes. Long-term observations can reveal patterns that short studies " +
  "might miss, while clear records make results easier to compare and reproduce.";

const source: CorpusDocument = {
  id: "field-notes",
  title: "Field notes",
  text:
    "Careful field research helps scientists understand how ecosystems respond to " +
    "seasonal changes. Long-term observations can reveal patterns that short studies " +
    "might miss, while clear records make results easier to compare and reproduce.",
};

describe("compareWithCorpus", () => {
  it("finds exact matching passages and highlights them in the submitted text", () => {
    const report = compareWithCorpus(essay, [source]);

    expect(report.overallPercent).toBe(100);
    expect(report.matches).toHaveLength(1);
    expect(report.matches[0].sourceTitle).toBe("Field notes");
    expect(report.matches[0].passages[0].text).toBe(source.text);
    expect(essay.slice(report.highlights[0].start, report.highlights[0].end)).toBe(essay);
  });

  it("finds overlapping fingerprints after a few words have changed", () => {
    const nearCopy = essay.replace("Careful field research", "Detailed field research");
    const report = compareWithCorpus(nearCopy, [source]);

    expect(report.overallPercent).toBeGreaterThan(60);
    expect(report.overallPercent).toBeLessThan(100);
    expect(report.matches).toHaveLength(1);
  });

  it("does not report matches when there are no shared word sequences", () => {
    const report = compareWithCorpus(
      "Quantum mechanics describes particles through mathematical probability distributions.",
      [source],
    );

    expect(report.overallPercent).toBe(0);
    expect(report.matches).toHaveLength(0);
  });

  it("counts matched words once in the overall score across duplicate sources", () => {
    const report = compareWithCorpus(essay, [
      source,
      { ...source, id: "duplicate", title: "Duplicate source" },
    ]);

    expect(report.matches).toHaveLength(2);
    expect(report.overallPercent).toBe(100);
  });
});

describe("excludeReferences", () => {
  it("removes text after a recognized references heading", () => {
    expect(excludeReferences("Essay body.\n\nReferences\nAuthor, A. (2024).")).toBe("Essay body.");
    expect(excludeReferences("Essay body.\n\nReferences:\nAuthor, A. (2024).")).toBe(
      "Essay body.",
    );
  });

  it("leaves the text alone when no references heading exists", () => {
    expect(excludeReferences("An essay without a bibliography.")).toBe(
      "An essay without a bibliography.",
    );
  });
});
