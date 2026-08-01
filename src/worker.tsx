import { Hono } from "hono";
import type { Context } from "hono";
import { requestId } from "hono/request-id";

import {
  buildApiUrl,
  normalizeSearch,
  transformCrossrefJson,
  validateSearch,
  type PublicPaper,
} from "./domain/papers";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  CROSSREF_GATE: DurableObjectNamespace;
};
type Variables = { requestId: string };
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type SearchResult = { total: number; results: PublicPaper[] };

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 413 | 415 | 502 | 503,
  ) {
    super(code);
  }
}

const canonicalOrigin = "https://ronbun-hiki.yhay81.com";
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const telemetryNames = new Set([
  "visited",
  "searched",
  "no_result",
  "doi_opened",
  "citation_copied",
  "saved",
  "correction_seen",
  "returned",
]);
const nowSeconds = () => Math.floor(Date.now() / 1000);

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const enforceSameOrigin = (c: AppContext) => {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new ApiError("cross_site_request", 403);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) throw new ApiError("cross_site_request", 403);
};

const parseJson = async (c: AppContext, maximumBytes = 2048) => {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json"))
    throw new ApiError("unsupported_media_type", 415);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes)
    throw new ApiError("payload_too_large", 413);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400);
  }
};

const objectPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new ApiError("invalid_request", 400);
  return payload as Record<string, unknown>;
};

const recordEvent = async (c: AppContext, name: string) => {
  const session = (c.req.header("x-ronbun-session") ?? "").toLowerCase();
  if (!sessionPattern.test(session)) return;
  await c.env.DB.prepare(
    "INSERT INTO product_events (session_hash,event_name,is_qa,created_at) VALUES (?,?,?,?)",
  )
    .bind(await sha256(session), name, c.req.header("x-ronbun-qa") === "1" ? 1 : 0, nowSeconds())
    .run();
};

const Layout = ({
  canonical,
  children,
  description,
  noindex = false,
  title,
}: {
  canonical: string;
  children: unknown;
  description: string;
  noindex?: boolean;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width,initial-scale=1" name="viewport" />
      <title>{title}</title>
      <meta content={description} name="description" />
      {noindex ? <meta content="noindex,nofollow" name="robots" /> : null}
      <link href={canonical} rel="canonical" />
      <meta content="website" property="og:type" />
      <meta content="論文引き" property="og:site_name" />
      <meta content={title} property="og:title" />
      <meta content={description} property="og:description" />
      <meta content={canonical} property="og:url" />
      <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
      <meta content="summary_large_image" name="twitter:card" />
      <meta content="#243a44" name="theme-color" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      <script defer src="/app.js" />
    </head>
    <body>
      <a class="skip-link" href="#main">
        本文へ
      </a>
      <header class="site-header">
        <a aria-label="論文引き ホーム" class="wordmark" href="/">
          <span aria-hidden="true" class="mini-paper">
            <i />
            <i />
          </span>
          <span>論文引き</span>
        </a>
        <nav aria-label="案内">
          <a href="/guide">使い方</a>
          <a href="/source">出典</a>
          <a href="/privacy">保存</a>
        </nav>
      </header>
      {children}
      <footer class="site-footer">
        <span>Bibliographic metadata supplied by Crossref</span>
        <span>
          <a href="https://www.crossref.org/" rel="noopener noreferrer">
            Crossref
          </a>
          <a href="https://www.doi.org/" rel="noopener noreferrer">
            DOI
          </a>
        </span>
      </footer>
    </body>
  </html>
);

const PaperTrailScene = () => (
  <div aria-hidden="true" class="paper-trail-scene">
    <div class="journal-stack">
      <span>研究</span>
      <span>紀要</span>
      <span>論集</span>
    </div>
    <div class="paper-sheet sheet-back">
      <i />
      <i />
      <i />
    </div>
    <div class="paper-sheet sheet-front">
      <b>DOI</b>
      <i />
      <i />
      <i />
      <span class="paperclip" />
    </div>
    <div class="citation-slip">
      <span>著者</span>
      <i />
      <span>年</span>
      <i />
    </div>
  </div>
);

const SearchForm = () => (
  <form class="search-form" id="search-form" novalidate>
    <div class="query-line">
      <label for="query">探したいテーマ</label>
      <div class="query-slot">
        <span aria-hidden="true" class="search-mark">
          論
        </span>
        <input
          autocomplete="off"
          id="query"
          maxlength={100}
          name="q"
          placeholder="地域医療"
          required
          type="search"
        />
        <button type="submit">論文を引く</button>
      </div>
    </div>
    <details class="refine-panel">
      <summary>題名・著者・年で絞る</summary>
      <div class="refine-grid">
        <label>
          題名に含む
          <input autocomplete="off" id="title" maxlength={100} placeholder="在宅ケア" />
        </label>
        <label>
          著者
          <input autocomplete="off" id="author" maxlength={80} placeholder="山田 太郎" />
        </label>
        <label>
          発表年（から）
          <input
            id="from-year"
            inputmode="numeric"
            max={new Date().getUTCFullYear() + 1}
            min="1800"
            placeholder="2020"
            type="number"
          />
        </label>
        <label>
          発表年（まで）
          <input
            id="to-year"
            inputmode="numeric"
            max={new Date().getUTCFullYear() + 1}
            min="1800"
            placeholder={String(new Date().getUTCFullYear())}
            type="number"
          />
        </label>
        <label>
          並び順
          <select id="sort">
            <option value="relevance">関連度順</option>
            <option value="newest">新しい順</option>
            <option value="cited">Crossref引用数順</option>
          </select>
        </label>
        <label class="check-line">
          <input checked id="japanese-first" type="checkbox" />
          日本語らしい題名を先に表示
        </label>
      </div>
    </details>
    <div aria-label="検索例" class="examples">
      <span>例</span>
      <button data-example="地域医療" type="button">
        地域医療
      </button>
      <button data-example="生成AI 教育" type="button">
        生成AIと教育
      </button>
      <button data-author="宮沢 賢治" data-example="文学" type="button">
        文学 × 宮沢賢治
      </button>
    </div>
    <p class="search-status" id="search-status" role="status">
      題名や著者を添えると、目的の論文を見つけやすくなります
    </p>
  </form>
);

const SavedTray = () => (
  <aside aria-labelledby="saved-heading" class="saved-tray">
    <div class="tray-tab">保存</div>
    <header>
      <div>
        <p>この端末だけ</p>
        <h2 id="saved-heading">あとで読む束</h2>
      </div>
      <strong id="saved-count">0</strong>
    </header>
    <div class="saved-stack" id="saved-stack">
      <p class="empty-saved">残した論文が、ここに紙片で重なります。</p>
    </div>
    <button class="clear-button" hidden id="clear-saved" type="button">
      束を空にする
    </button>
  </aside>
);

const HomePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/`}
    description="テーマ・題名・著者・発表年から論文メタデータを探し、DOIと引用用情報を確認できます。登録不要。"
    title="論文引き | 題名・著者・年から論文を探す"
  >
    <main class="home" id="main">
      <section aria-labelledby="product-title" class="research-desk">
        <div class="product-heading">
          <p class="eyebrow">PAPER FINDER</p>
          <h1 id="product-title">題名から、読むべき一本へ。</h1>
          <p>テーマ、題名、著者、年を手がかりに、DOIのある論文を引き出します。</p>
        </div>
        <PaperTrailScene />
        <SearchForm />
      </section>
      <div class="source-ribbon">
        <span>Crossref公開メタデータ</span>
        <span>論文に限定</span>
        <span>抄録は収録しない</span>
        <a href="/source">出典と範囲</a>
      </div>
      <div class="work-area">
        <section aria-labelledby="results-heading" class="results">
          <div class="section-heading">
            <div>
              <p>検索結果</p>
              <h2 id="results-heading">論文の紙束</h2>
            </div>
            <span id="result-count">未検索</span>
          </div>
          <div class="result-list" id="results">
            <div class="empty-result">
              <span class="empty-seal">論</span>
              <div>
                <h3>検索すると、論文情報が並びます</h3>
                <p>題名、著者、発表年、掲載誌、DOI、訂正情報の有無を確認できます。</p>
              </div>
            </div>
          </div>
        </section>
        <SavedTray />
      </div>
    </main>
  </Layout>
);

const GuidePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/guide`}
    description="論文引きで論文を探し、引用情報をコピーしてDOIから本文候補へ進む方法。"
    title="使い方 | 論文引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">引</span>
        <div>
          <p>使い方</p>
          <h1>手がかりを、一本の論文へ</h1>
        </div>
      </header>
      <div class="instruction-grid">
        <section>
          <b>一</b>
          <h2>テーマを入れる</h2>
          <p>探したいことばを2文字以上で入力します。題名、著者、発表年も併用できます。</p>
        </section>
        <section>
          <b>二</b>
          <h2>書誌を見分ける</h2>
          <p>掲載誌、年、著者、Crossref引用数、訂正情報の有無から読む候補を選びます。</p>
        </section>
        <section>
          <b>三</b>
          <h2>正本へ進む</h2>
          <p>引用用の短い書誌をコピーし、DOIを開いて出版社や公開本文を確認します。</p>
        </section>
      </div>
      <div class="notice-box">
        <strong>検索結果は完全な引用保証ではありません</strong>
        <p>
          提出先の書式、著者表記、巻号、ページ、訂正・撤回情報はDOI先の最新記録で確認してください。
        </p>
      </div>
      <a class="page-cta" href="/">
        論文を引く
      </a>
    </main>
  </Layout>
);

const SourcePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/source`}
    description="論文引きが利用するCrossref REST API、メタデータの収録範囲、加工と注意事項。"
    title="出典と収録 | 論文引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">典</span>
        <div>
          <p>出典と収録</p>
          <h1>公開メタデータを、読みやすい紙束に</h1>
        </div>
      </header>
      <div class="source-grid">
        <section class="source-ledger">
          <h2>出典</h2>
          <p>
            題名、著者、発表日、掲載誌、出版社、DOI、引用数、更新情報は
            <a
              href="https://www.crossref.org/documentation/retrieve-metadata/rest-api/"
              rel="noopener noreferrer"
            >
              Crossref REST API
            </a>
            から都度取得します。
          </p>
        </section>
        <section class="source-ledger">
          <h2>利用範囲</h2>
          <p>
            Crossrefが公開するメタデータのうち、DOIと題名を持つjournal-articleを最大20件表示します。
          </p>
          <p>出版社・著者の権利があり得る抄録、本文、画像、参考文献本文は取得・表示しません。</p>
        </section>
        <section class="source-ledger">
          <h2>表示の加工</h2>
          <p>
            表記を正規化し、日本語らしい題名を先に並べる選択肢を加え、短い引用文を端末内で組み立てます。
          </p>
          <p>同じ条件の応答は実行中メモリで20分再利用し、検索条件と応答をD1へ保存しません。</p>
        </section>
      </div>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical={`${canonicalOrigin}/privacy`}
    description="論文引きの検索条件、保存した論文、匿名利用計測の取り扱い。"
    title="保存とプライバシー | 論文引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">守</span>
        <div>
          <p>保存</p>
          <h1>探したことばは計測に残さない</h1>
        </div>
      </header>
      <div class="privacy-grid">
        <section>
          <h2>検索</h2>
          <p>
            検索条件はURL、D1、利用計測へ保存しません。検索実行時だけ本サービスを経由してCrossref
            APIへ送られます。
          </p>
        </section>
        <section>
          <h2>あとで読む束</h2>
          <p>
            残した公開書誌情報は、このブラウザのlocalStorageだけに最大50件保存します。Cookieやアカウントは使いません。
          </p>
        </section>
        <section>
          <h2>利用計測</h2>
          <p>
            ランダム端末IDのハッシュ、許可済み操作名、QA判定、時刻だけを35日保持します。検索語、DOI、著者名、保存内容の列はありません。
          </p>
        </section>
      </div>
    </main>
  </Layout>
);

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.use("*", requestId());
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-Request-Id", c.get("requestId"));
});

app.get("/", (c) => {
  c.header("Cache-Control", "public,max-age=60,s-maxage=300");
  return c.html(<HomePage />);
});
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/source", (c) => c.html(<SourcePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));

app.post("/api/search", async (c) => {
  enforceSameOrigin(c);
  const search = normalizeSearch(objectPayload(await parseJson(c)));
  const validationError = validateSearch(search);
  if (validationError) throw new ApiError(validationError, 400);
  const id = c.env.CROSSREF_GATE.idFromName("official-api");
  const response = await c.env.CROSSREF_GATE.get(id).fetch("https://gate.internal/search", {
    body: JSON.stringify(search),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok)
    throw new ApiError("official_api_unavailable", response.status === 503 ? 503 : 502);
  const result = await response.json<SearchResult>();
  await recordEvent(c, result.results.length ? "searched" : "no_result");
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

app.post("/api/telemetry", async (c) => {
  enforceSameOrigin(c);
  const payload = objectPayload(await parseJson(c, 256));
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!telemetryNames.has(name)) throw new ApiError("invalid_event", 400);
  await recordEvent(c, name);
  return c.body(null, 202);
});

app.get("/health", async (c) => {
  const database = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({
    api: "https://api.crossref.org/v1/works",
    ok: database?.ok === 1,
    service: "ronbun-hiki",
  });
});

app.get("/sitemap.xml", (c) => {
  const paths = ["/", "/guide", "/source", "/privacy"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${canonicalOrigin}${path}</loc></url>`).join("")}</urlset>`;
  c.header("Cache-Control", "public,max-age=3600,s-maxage=86400");
  c.header("Content-Type", "application/xml; charset=utf-8");
  return c.body(xml);
});

app.notFound((c) => {
  c.status(404);
  return c.html(
    <Layout
      canonical={`${canonicalOrigin}/404`}
      description="指定されたページは見つかりません。"
      noindex
      title="ページが見つかりません | 論文引き"
    >
      <main class="not-found" id="main">
        <span>404</span>
        <h1>論文のないページです</h1>
        <p>検索机へ戻って、テーマ・題名・著者から探してください。</p>
        <a href="/">論文を引く</a>
      </main>
    </Layout>,
  );
});

app.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json({ error: error.code, requestId: c.get("requestId") }, error.status);
  console.error(
    "request_failed",
    c.get("requestId"),
    error instanceof Error ? error.message : "unknown",
  );
  return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
});

export const scheduled = async (_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at < ?")
    .bind(nowSeconds() - 35 * 86400)
    .run();
};

type MemoryEntry = { expiresAt: number; result: SearchResult };

export class CrossrefGate {
  private readonly cache = new Map<string, MemoryEntry>();
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
    return this.state.blockConcurrencyWhile(async () => {
      const search = normalizeSearch((await request.json()) as Record<string, unknown>);
      if (validateSearch(search))
        return Response.json({ error: "invalid_search" }, { status: 400 });
      const key = await sha256(JSON.stringify(search));
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return Response.json(cached.result);
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value ?? "");

      const lastFinishedAt =
        (await this.state.storage.get<number>("last_upstream_finished_at")) ?? 0;
      const waitMilliseconds = Math.max(0, 1100 - (Date.now() - lastFinishedAt));
      if (waitMilliseconds) await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));

      let json = "";
      try {
        const upstream = await fetch(buildApiUrl(search), {
          headers: {
            Accept: "application/json",
            "User-Agent": "RonbunHiki/1.0 (+https://github.com/yhay81/ronbun-hiki)",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(12_000),
        });
        if (
          !upstream.ok ||
          !/application\/json/iu.test(upstream.headers.get("content-type") ?? "")
        ) {
          console.error("crossref_upstream_rejected", upstream.status);
          return Response.json({ error: "upstream_failed" }, { status: 503 });
        }
        json = await upstream.text();
      } catch (error) {
        console.error(
          "crossref_upstream_failed",
          error instanceof Error ? error.message : "unknown",
        );
        return Response.json({ error: "upstream_failed" }, { status: 503 });
      } finally {
        await this.state.storage.put("last_upstream_finished_at", Date.now());
      }

      try {
        const result = transformCrossrefJson(search, json);
        this.cache.set(key, { expiresAt: Date.now() + 20 * 60 * 1000, result });
        return Response.json(result);
      } catch {
        return Response.json({ error: "invalid_upstream_response" }, { status: 503 });
      }
    });
  }
}

export { app };
export default { fetch: app.fetch, scheduled };
