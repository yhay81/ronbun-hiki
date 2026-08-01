import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("product surface", () => {
  const worker = read("src/worker.tsx");
  const domain = read("src/domain/papers.ts");
  const client = read("public/app.js");
  const css = read("public/styles.css");
  const migration = read("migrations/0001_telemetry.sql");
  const source = read("SOURCE.md");

  it("communicates through a paper-trail visual without oversized type", () => {
    expect(worker).toContain('class="paper-trail-scene"');
    expect(worker).toContain('class="journal-stack"');
    expect(worker).toContain('class="citation-slip"');
    expect(worker).toContain('class="saved-tray"');
    expect(client).toContain('card.className = "paper-card"');
    expect(css.toLowerCase()).not.toContain("gradient");
    expect(css).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/su);
  });

  it("keeps search conditions and paper identifiers out of telemetry and product URLs", () => {
    expect(worker).toContain('app.post("/api/search"');
    expect(worker).toContain('c.header("Cache-Control", "no-store")');
    expect(migration).not.toMatch(/search_query|query_text|doi_value|author_name|email|phone/iu);
    expect(migration).toContain("CHECK(event_name IN");
    expect(client).not.toMatch(/history\.(?:pushState|replaceState)|location\.search\s*=/u);
  });

  it("serializes Crossref calls and waits from response completion", () => {
    expect(worker).toContain("blockConcurrencyWhile");
    expect(worker).toContain('storage.get<number>("last_upstream_finished_at")');
    expect(worker).toContain('storage.put("last_upstream_finished_at", Date.now())');
    expect(worker).toContain("1100 - (Date.now() - lastFinishedAt)");
  });

  it("bounds official retrieval and DOI destinations", () => {
    expect(domain).toContain('url.searchParams.set("rows", "40")');
    expect(domain).toContain('"type:journal-article"');
    expect(domain).toContain("2_000_000");
    expect(domain).toContain('new URL("https://api.crossref.org/v1/works")');
    expect(domain).toContain("officialUrl: `https://doi.org/${doi}`");
    expect(client).not.toContain("innerHTML");
    expect(worker).not.toContain("dangerouslySetInnerHTML");
  });

  it("states the source, rights boundary, and transformation", () => {
    expect(source).toContain("Crossref REST API");
    expect(source).toContain("reusable without restriction");
    expect(source).toContain("抄録");
    expect(source).toContain("加工内容");
    expect(worker).toContain("Bibliographic metadata supplied by Crossref");
  });

  it("marks automated QA and uses local-only saved papers without authentication", () => {
    expect(client).toContain("navigator.webdriver === true");
    expect(client).toContain("localStorage");
    expect(client).toContain("saved.slice(0, 50)");
    expect(`${worker}\n${client}`).not.toMatch(/better-auth|betterAuth/iu);
  });
});
