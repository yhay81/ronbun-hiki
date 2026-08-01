import { describe, expect, it } from "vitest";

import {
  buildApiUrl,
  normalizeSearch,
  transformCrossrefJson,
  validateSearch,
} from "../src/domain/papers";

const response = (items: unknown[], total = items.length) =>
  JSON.stringify({ message: { items, "total-results": total }, status: "ok" });

const paper = (overrides: Record<string, unknown> = {}) => ({
  DOI: "10.14442/generalist.46.35",
  title: ["プライマリ・ケアと地域医療，多職種連携"],
  author: [{ family: "山田", given: "太郎" }, { name: "地域医療研究会" }],
  "container-title": ["日本プライマリ・ケア連合学会誌"],
  publisher: "日本プライマリ・ケア連合学会",
  published: { "date-parts": [[2023, 3, 15]] },
  type: "journal-article",
  "is-referenced-by-count": 12,
  "update-to": [{ DOI: "10.14442/generalist.46.99", type: "correction" }],
  ...overrides,
});

describe("paper search domain", () => {
  it("normalizes bounded Japanese search fields and defaults", () => {
    expect(
      normalizeSearch({
        q: "  地域　 医療  ",
        title: "  在宅ケア ",
        author: " 山田 太郎 ",
        fromYear: "2020",
        toYear: 2026,
      }),
    ).toEqual({
      q: "地域 医療",
      title: "在宅ケア",
      author: "山田 太郎",
      fromYear: 2020,
      toYear: 2026,
      sort: "relevance",
      japaneseFirst: true,
    });
  });

  it("requires a useful term and a forward year range", () => {
    expect(validateSearch(normalizeSearch({ q: "医" }))).toBe("query_too_short");
    expect(validateSearch(normalizeSearch({ author: "山田" }))).toBe("");
    expect(validateSearch(normalizeSearch({ q: "医療", fromYear: 2025, toYear: 2020 }))).toBe(
      "invalid_year_range",
    );
  });

  it("builds one bounded Crossref journal-article request", () => {
    const url = buildApiUrl(
      normalizeSearch({
        q: "地域医療",
        title: "在宅",
        author: "山田",
        fromYear: 2020,
        toYear: 2026,
        sort: "cited",
      }),
    );
    expect(url.origin).toBe("https://api.crossref.org");
    expect(url.pathname).toBe("/v1/works");
    expect(url.searchParams.get("rows")).toBe("40");
    expect(url.searchParams.get("filter")).toBe(
      "type:journal-article,from-pub-date:2020-01-01,until-pub-date:2026-12-31",
    );
    expect(url.searchParams.get("query.bibliographic")).toBe("地域医療");
    expect(url.searchParams.get("query.title")).toBe("在宅");
    expect(url.searchParams.get("query.author")).toBe("山田");
    expect(url.searchParams.get("sort")).toBe("is-referenced-by-count");
    expect(url.searchParams.get("order")).toBe("desc");
  });

  it("extracts only bounded public metadata and DOI destinations", () => {
    const result = transformCrossrefJson(normalizeSearch({ q: "地域医療" }), response([paper()]));
    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual({
      id: "10.14442/generalist.46.35",
      doi: "10.14442/generalist.46.35",
      title: "プライマリ・ケアと地域医療,多職種連携",
      authors: ["山田 太郎", "地域医療研究会"],
      issued: "2023-03-15",
      year: 2023,
      container: "日本プライマリ・ケア連合学会誌",
      publisher: "日本プライマリ・ケア連合学会",
      type: "journal-article",
      citationCount: 12,
      officialUrl: "https://doi.org/10.14442/generalist.46.35",
      updateCount: 1,
    });
    expect(result.results[0]).not.toHaveProperty("abstract");
  });

  it("moves Japanese titles ahead without discarding other official matches", () => {
    const english = paper({ DOI: "10.1000/english", title: ["Community medicine"] });
    const japanese = paper({ DOI: "10.1000/japanese", title: ["地域医療のこれから"] });
    const result = transformCrossrefJson(
      normalizeSearch({ q: "地域医療" }),
      response([english, japanese], 2),
    );
    expect(result.results.map((item) => item.doi)).toEqual(["10.1000/japanese", "10.1000/english"]);
  });

  it("rejects oversized or malformed upstream responses and unsafe DOI values", () => {
    expect(() =>
      transformCrossrefJson(normalizeSearch({ q: "医療" }), "x".repeat(2_000_001)),
    ).toThrow("json_too_large");
    expect(() => transformCrossrefJson(normalizeSearch({ q: "医療" }), "{}")).toThrow(
      "invalid_schema",
    );
    const result = transformCrossrefJson(
      normalizeSearch({ q: "医療" }),
      response([paper({ DOI: "https://example.com/bad" })]),
    );
    expect(result.results).toEqual([]);
  });
});
