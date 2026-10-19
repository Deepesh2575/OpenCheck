import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as searchPost } from "../src/app/api/sources/search/route";
import { POST as styleReviewPost } from "../src/app/api/ai/style-review/route";
import { extractSearchQueries } from "../src/lib/search";

describe("extractSearchQueries", () => {
  it("selects at most two short excerpts and removes duplicates", () => {
    const queries = extractSearchQueries(
      "Biodiversity loss changes how ecosystems function and recover after disturbances. " +
        "Biodiversity loss changes how ecosystems function and recover after disturbances. " +
        "Local communities also help restore native habitat and protect vulnerable species.",
    );

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.length <= 115)).toBe(true);
  });

  it("uses a short prefix for text without a sentence boundary", () => {
    const query = extractSearchQueries(
      "Field researchers document long term changes in mountain plants and pollinator populations",
    );

    expect(query).toHaveLength(1);
    expect(query[0]).toBe(
      "Field researchers document long term changes in mountain plants and pollinator populations",
    );
  });

  it("does not generate search excerpts for very short text", () => {
    expect(extractSearchQueries("Short text.")).toEqual([]);
  });
});

describe("external API privacy and input guards", () => {
  it("rejects invalid external-search requests without querying providers", async () => {
    const request = new NextRequest("http://localhost/api/sources/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [""] }),
    });
    const response = await searchPost(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Provide one or two search phrases, each no longer than 115 characters.",
    });
  });

  it("rejects writing-style requests without consented text and a BYO key", async () => {
    const request = new NextRequest("http://localhost/api/ai/style-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "A short draft.", apiKey: "" }),
    });
    const response = await styleReviewPost(request);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("at least 100 characters");
  });
});
