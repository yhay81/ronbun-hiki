export type SearchSort = "relevance" | "newest" | "cited";

export type PaperSearch = {
  q: string;
  title: string;
  author: string;
  fromYear: number | null;
  toYear: number | null;
  sort: SearchSort;
  japaneseFirst: boolean;
};

export type PublicPaper = {
  id: string;
  doi: string;
  title: string;
  authors: string[];
  issued: string;
  year: number | null;
  container: string;
  publisher: string;
  type: string;
  citationCount: number;
  officialUrl: string;
  updateCount: number;
};

type JsonObject = Record<string, unknown>;

const currentYear = new Date().getUTCFullYear();
const doiPattern = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/iu;

const cleanText = (value: string, maximum = 220) =>
  value
    .normalize("NFKC")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\s　]+/gu, " ")
    .trim()
    .slice(0, maximum);

const cleanQuery = (value: unknown, maximum: number) =>
  typeof value === "string" ? cleanText(value, maximum) : "";

const yearValue = (value: unknown) => {
  if (value === "" || value === undefined || value === null) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1800 && year <= currentYear + 1 ? year : null;
};

export const normalizeSearch = (input: Record<string, unknown>): PaperSearch => {
  const sort: SearchSort = ["newest", "cited"].includes(String(input.sort))
    ? (input.sort as SearchSort)
    : "relevance";
  return {
    q: cleanQuery(input.q, 100),
    title: cleanQuery(input.title, 100),
    author: cleanQuery(input.author, 80),
    fromYear: yearValue(input.fromYear),
    toYear: yearValue(input.toYear),
    sort,
    japaneseFirst: input.japaneseFirst !== false,
  };
};

export const validateSearch = (search: PaperSearch) => {
  if (![search.q, search.title, search.author].some((value) => value.length >= 2))
    return "query_too_short";
  if (search.fromYear && search.toYear && search.fromYear > search.toYear)
    return "invalid_year_range";
  return "";
};

export const buildApiUrl = (search: PaperSearch) => {
  const url = new URL("https://api.crossref.org/v1/works");
  if (search.q) url.searchParams.set("query.bibliographic", search.q);
  if (search.title) url.searchParams.set("query.title", search.title);
  if (search.author) url.searchParams.set("query.author", search.author);
  const filters = ["type:journal-article"];
  if (search.fromYear) filters.push(`from-pub-date:${search.fromYear}-01-01`);
  if (search.toYear) filters.push(`until-pub-date:${search.toYear}-12-31`);
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("rows", "40");
  url.searchParams.set(
    "sort",
    search.sort === "newest"
      ? "published"
      : search.sort === "cited"
        ? "is-referenced-by-count"
        : "relevance",
  );
  if (search.sort !== "relevance") url.searchParams.set("order", "desc");
  return url;
};

const objectValue = (value: unknown): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;

const stringList = (value: unknown, maximum = 220, limit = 4) =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, maximum))
    .filter(Boolean)
    .slice(0, limit);

const dateParts = (value: unknown): number[] => {
  const object = objectValue(value);
  const parts = object?.["date-parts"];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return [];
  return parts[0]
    .slice(0, 3)
    .map(Number)
    .filter((part) => Number.isInteger(part) && part > 0);
};

const issuedDate = (item: JsonObject) => {
  const parts =
    dateParts(item["published-print"]).length > 0
      ? dateParts(item["published-print"])
      : dateParts(item["published-online"]).length > 0
        ? dateParts(item["published-online"])
        : dateParts(item.published).length > 0
          ? dateParts(item.published)
          : dateParts(item.issued);
  if (!parts.length) return { issued: "", year: null };
  const [year, month, day] = parts;
  return {
    issued: [
      year,
      month ? String(month).padStart(2, "0") : "",
      day ? String(day).padStart(2, "0") : "",
    ]
      .filter(Boolean)
      .join("-"),
    year: year >= 1800 && year <= currentYear + 1 ? year : null,
  };
};

const authorNames = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map(objectValue)
    .filter((author): author is JsonObject => author !== null)
    .map((author) => {
      const family = cleanQuery(author.family, 80);
      const given = cleanQuery(author.given, 80);
      const name = cleanQuery(author.name, 120);
      return name || [family, given].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .slice(0, 8);
};

const updateCount = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((update) => {
        const object = objectValue(update);
        return object && doiPattern.test(cleanQuery(object.DOI, 200));
      }).length
    : 0;

const publicPaper = (value: unknown): PublicPaper | null => {
  const item = objectValue(value);
  if (!item) return null;
  const doi = cleanQuery(item.DOI, 200).toLowerCase();
  const title = stringList(item.title, 320, 1)[0] ?? "";
  if (!doiPattern.test(doi) || !title) return null;
  const date = issuedDate(item);
  const count = Number(item["is-referenced-by-count"]);
  return {
    id: doi,
    doi,
    title,
    authors: authorNames(item.author),
    issued: date.issued,
    year: date.year,
    container: stringList(item["container-title"], 180, 1)[0] ?? "",
    publisher: cleanQuery(item.publisher, 180),
    type: cleanQuery(item.type, 60),
    citationCount: Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 10_000_000) : 0,
    officialUrl: `https://doi.org/${doi}`,
    updateCount: updateCount(item["update-to"]),
  };
};

const japaneseRank = (paper: PublicPaper) => {
  const text = paper.title;
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 2;
  return /\p{Script=Han}/u.test(text) ? 1 : 0;
};

export const transformCrossrefJson = (search: PaperSearch, json: string) => {
  if (new TextEncoder().encode(json).byteLength > 2_000_000) throw new Error("json_too_large");
  const root = objectValue(JSON.parse(json));
  const message = objectValue(root?.message);
  if (!message || !Array.isArray(message.items)) throw new Error("invalid_schema");
  const papers = message.items
    .map(publicPaper)
    .filter((paper): paper is PublicPaper => paper !== null);
  const ordered = search.japaneseFirst
    ? papers
        .map((paper, index) => ({ paper, index, rank: japaneseRank(paper) }))
        .sort((left, right) => right.rank - left.rank || left.index - right.index)
        .map(({ paper }) => paper)
    : papers;
  const total = Number(message["total-results"]);
  return {
    total: Number.isSafeInteger(total) && total >= 0 ? total : 0,
    results: ordered.slice(0, 20),
  };
};
