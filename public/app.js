(() => {
  "use strict";

  const sessionKey = "ronbun-hiki-session-v1";
  const savedKey = "ronbun-hiki-saved-v1";
  const seenKey = "ronbun-hiki-seen-v1";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const doiUrlPattern = /^https:\/\/doi\.org\/10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+$/iu;
  const isQa =
    new URLSearchParams(location.search).get("qa") === "1" ||
    location.hostname === "localhost" ||
    navigator.webdriver === true;

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  };

  const previousSession = localStorage.getItem(sessionKey) ?? "";
  const session = uuidPattern.test(previousSession) ? previousSession : crypto.randomUUID();
  localStorage.setItem(sessionKey, session);
  const headers = () => ({
    "Content-Type": "application/json",
    "X-Ronbun-QA": isQa ? "1" : "0",
    "X-Ronbun-Session": session,
  });
  const emit = (name) => {
    fetch("/api/telemetry", {
      body: JSON.stringify({ name }),
      headers: headers(),
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  };
  const previousVisit = Number(localStorage.getItem(seenKey) ?? 0);
  emit("visited");
  if (previousVisit && Date.now() - previousVisit > 8 * 60 * 60 * 1000) emit("returned");
  localStorage.setItem(seenKey, String(Date.now()));

  const makeButton = (label, className, action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    if (className) element.className = className;
    element.addEventListener("click", action);
    return element;
  };

  const copy = async (value, target) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const previous = target.textContent;
    target.textContent = "コピーしました";
    target.classList.add("is-done");
    setTimeout(() => {
      target.textContent = previous;
      target.classList.remove("is-done");
    }, 1400);
    emit("citation_copied");
  };

  const validSaved = () => {
    const items = readJson(savedKey, []);
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.officialUrl === "string" &&
          doiUrlPattern.test(item.officialUrl),
      )
      .slice(0, 50);
  };
  let saved = validSaved();
  const persistSaved = () => localStorage.setItem(savedKey, JSON.stringify(saved.slice(0, 50)));
  const savedStack = document.querySelector("#saved-stack");
  const savedCount = document.querySelector("#saved-count");
  const clearSaved = document.querySelector("#clear-saved");

  const citation = (item) => {
    const authors = item.authors?.length ? item.authors.join("・") : "著者不明";
    const year = item.year ? `（${item.year}）` : "";
    const container = item.container ? `『${item.container}』` : "";
    return `${authors}${year}「${item.title}」${container}。https://doi.org/${item.doi}`;
  };

  const renderSaved = () => {
    if (!savedStack || !savedCount || !clearSaved) return;
    savedStack.replaceChildren();
    savedCount.textContent = String(saved.length);
    clearSaved.hidden = saved.length === 0;
    if (!saved.length) {
      const empty = document.createElement("p");
      empty.className = "empty-saved";
      empty.textContent = "残した論文が、ここに紙片で重なります。";
      savedStack.append(empty);
      return;
    }
    saved.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "saved-slip";
      const mark = document.createElement("span");
      mark.textContent = item.year || "論文";
      const title = document.createElement("a");
      title.href = item.officialUrl;
      title.rel = "noopener noreferrer";
      title.target = "_blank";
      title.textContent = item.title;
      title.addEventListener("click", () => emit("doi_opened"));
      const detail = document.createElement("small");
      detail.textContent = [item.authors?.[0], item.container].filter(Boolean).join(" / ");
      const remove = makeButton("外す", "remove-saved", () => {
        saved.splice(index, 1);
        persistSaved();
        renderSaved();
        updateSaveButtons();
      });
      card.append(mark, title, detail, remove);
      savedStack.append(card);
    });
  };

  const updateSaveButtons = () => {
    document.querySelectorAll("[data-save-paper]").forEach((itemButton) => {
      const active = saved.some((item) => item.id === itemButton.dataset.savePaper);
      itemButton.textContent = active ? "束に保存済み" : "あとで読む";
      itemButton.classList.toggle("is-saved", active);
      itemButton.setAttribute("aria-pressed", String(active));
    });
  };

  const savePaper = (item) => {
    const existing = saved.findIndex((savedItem) => savedItem.id === item.id);
    if (existing >= 0) saved.splice(existing, 1);
    else {
      saved.unshift(item);
      saved = saved.slice(0, 50);
      emit("saved");
    }
    persistSaved();
    renderSaved();
    updateSaveButtons();
  };

  clearSaved?.addEventListener("click", () => {
    saved = [];
    persistSaved();
    renderSaved();
    updateSaveButtons();
  });
  renderSaved();

  const form = document.querySelector("#search-form");
  const query = document.querySelector("#query");
  const titleInput = document.querySelector("#title");
  const authorInput = document.querySelector("#author");
  const fromYearInput = document.querySelector("#from-year");
  const toYearInput = document.querySelector("#to-year");
  const sortInput = document.querySelector("#sort");
  const japaneseFirstInput = document.querySelector("#japanese-first");
  const results = document.querySelector("#results");
  const status = document.querySelector("#search-status");
  const count = document.querySelector("#result-count");

  const addMeta = (list, label, value) => {
    if (!value && value !== 0) return;
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value);
    list.append(term, detail);
  };

  const doiMark = (doi) => {
    const mark = document.createElement("span");
    mark.className = "doi-mark";
    mark.textContent = "DOI";
    mark.title = doi;
    return mark;
  };

  const resultCard = (item) => {
    const card = document.createElement("article");
    card.className = "paper-card";
    const edge = document.createElement("span");
    edge.className = "paper-edge";
    edge.textContent = item.year || "—";
    const head = document.createElement("div");
    head.className = "paper-head";
    const source = document.createElement("span");
    source.textContent = "Crossref metadata";
    head.append(source, doiMark(item.doi));
    const title = document.createElement("h3");
    title.textContent = item.title;
    const authors = document.createElement("p");
    authors.className = "paper-authors";
    authors.textContent = item.authors?.join(" / ") || "著者情報なし";
    if (item.updateCount > 0) {
      const update = document.createElement("p");
      update.className = "update-notice";
      update.textContent = `訂正・更新情報 ${item.updateCount}件 — DOI先で最新状態を確認してください`;
      card.append(edge, head, title, authors, update);
    } else {
      card.append(edge, head, title, authors);
    }
    const meta = document.createElement("dl");
    meta.className = "paper-meta";
    addMeta(meta, "発表", item.issued);
    addMeta(meta, "掲載誌", item.container);
    addMeta(meta, "出版社", item.publisher);
    addMeta(meta, "Crossref引用", `${item.citationCount.toLocaleString("ja-JP")}件`);
    addMeta(meta, "DOI", item.doi);
    const actions = document.createElement("div");
    actions.className = "paper-actions";
    const official = document.createElement("a");
    official.href = item.officialUrl;
    official.rel = "noopener noreferrer";
    official.target = "_blank";
    official.textContent = "DOIを開く";
    official.addEventListener("click", () => emit("doi_opened"));
    const copyButton = makeButton("引用用にコピー", "", (event) =>
      copy(citation(item), event.currentTarget),
    );
    const saveButton = makeButton("あとで読む", "", () => savePaper(item));
    saveButton.dataset.savePaper = item.id;
    actions.append(official, copyButton, saveButton);
    card.append(meta, actions);
    return card;
  };

  const renderResults = (payload) => {
    results.replaceChildren();
    if (!payload.results.length) {
      const empty = document.createElement("div");
      empty.className = "no-result";
      const seal = document.createElement("span");
      seal.textContent = "論";
      const box = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = "該当する論文を引けませんでした";
      const note = document.createElement("p");
      note.textContent = "ことばを短くする、題名や著者の条件を外す、発表年を広げる方法も試せます。";
      box.append(title, note);
      empty.append(seal, box);
      results.append(empty);
      count.textContent = "0件";
      return;
    }
    payload.results.forEach((item) => results.append(resultCard(item)));
    if (payload.results.some((item) => item.updateCount > 0)) emit("correction_seen");
    count.textContent = `${payload.total.toLocaleString("ja-JP")}件中 ${payload.results.length}件`;
    updateSaveButtons();
  };

  const year = (input) => (input.value ? Number(input.value) : null);
  const search = async () => {
    const values = [query.value, titleInput.value, authorInput.value];
    if (!values.some((value) => value.trim().length >= 2)) {
      status.textContent = "テーマ、題名、著者のいずれかを2文字以上入れてください";
      query.focus();
      return;
    }
    const fromYear = year(fromYearInput);
    const toYear = year(toYearInput);
    if (fromYear && toYear && fromYear > toYear) {
      status.textContent = "発表年の範囲を確認してください";
      fromYearInput.focus();
      return;
    }
    status.textContent = "Crossrefの論文索引を確認しています…";
    form.classList.add("is-loading");
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const response = await fetch("/api/search", {
        body: JSON.stringify({
          q: query.value,
          title: titleInput.value,
          author: authorInput.value,
          fromYear,
          toYear,
          sort: sortInput.value,
          japaneseFirst: japaneseFirstInput.checked,
        }),
        headers: headers(),
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === "query_too_short") {
          status.textContent = "テーマ、題名、著者のいずれかを2文字以上入れてください";
          return;
        }
        if (error.error === "invalid_year_range") {
          status.textContent = "発表年の範囲を確認してください";
          return;
        }
        throw new Error("search_failed");
      }
      const payload = await response.json();
      renderResults(payload);
      status.textContent = payload.results.length
        ? `${payload.results.length}件の論文情報を表示しました`
        : "一致する論文はありませんでした";
      results.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      status.textContent = "Crossref APIへ接続できませんでした。少し待って、もう一度お試しください";
    } finally {
      form.classList.remove("is-loading");
      form.querySelector('button[type="submit"]').disabled = false;
    }
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });
  document.querySelectorAll("[data-example]").forEach((example) => {
    example.addEventListener("click", () => {
      query.value = example.dataset.example ?? "";
      authorInput.value = example.dataset.author ?? "";
      void search();
    });
  });
})();
