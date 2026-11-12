/* CONTENT.LAB — генератор постов для Telegram / Instagram / YouTube
   React 18 (UMD globals). Gemini 3.5 Flash-Lite SSE + демо-генератор. */

const { useState, useEffect, useLayoutEffect, useRef, useReducer, useMemo, useCallback, memo } = React;

/* ───────────────────────── Константы ───────────────────────── */

const PLATFORMS = {
  tg: { id: "tg", label: "Telegram", short: "TG", accent: "#2AABEE", limit: 1024 },
  ig: { id: "ig", label: "Instagram", short: "IG", accent: "#E05A47", limit: 2000 },
  yt: { id: "yt", label: "YouTube", short: "YT", accent: "#E53935", limit: 1500 },
};
const PLATFORM_IDS = ["tg", "ig", "yt"];

const VARIANTS = [
  { id: "expert", idx: "01", label: "Экспертный разбор", short: "Эксперт" },
  { id: "storytelling", idx: "02", label: "Сторителлинг", short: "История" },
  { id: "direct_offer", idx: "03", label: "Прямой оффер", short: "Оффер" },
];
const VARIANT_IDS = VARIANTS.map((v) => v.id);
const VARIANT_BY_ID = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

const PRESETS = [
  { id: "case", label: "+Кейс", hint: "Добавь реальный кейс с цифрами: точка А, что сделали, точка Б, срок." },
  { id: "offer", label: "+Оффер", hint: "Включи конкретный оффер: что получает клиент, условия, срок, ограничение." },
  { id: "breakdown", label: "+Разбор", hint: "Добавь пошаговый разбор из 3–5 пунктов с конкретными действиями." },
  { id: "personal", label: "+Личный опыт", hint: "Пиши от первого лица и добавь эпизод из личного опыта автора." },
];

const DEFAULT_IDEA =
  "Кофейня спешелти в спальном районе. Утром очередь, а после 12:00 зал пустой. Хотим, чтобы люди приходили днём и работали с ноутбуком.";

const LS = {
  key: "contentlab.geminiKey",
  theme: "contentlab.theme",
  history: "contentlab.history.v1",
  platform: "contentlab.platform",
  idea: "contentlab.idea",
  presets: "contentlab.presets",
  view: "contentlab.view",
  tagMode: "contentlab.tagMode",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/* ───────────────────────── Хранилище ───────────────────────── */

function lsGet(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* хранилище недоступно — работаем без сохранения */
  }
}
function lsDel(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (e) {}
}

/* ───────────────────────── Утилиты ───────────────────────── */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, arr) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}
function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}
function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("no clipboard");
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/* ───────────────────────── Парсер потока ───────────────────────── */

const MARKER_NAMES = ["TITLE", "BODY", "CTA", "HASHTAGS"];
const MARKER_KEY = { TITLE: "title", BODY: "body", CTA: "cta", HASHTAGS: "tags", HASHTAG: "tags", TAGS: "tags" };

function isPartialMarker(s) {
  const t = s.replace(/[\[\s*]/g, "").toUpperCase();
  if (!t) return true;
  return MARKER_NAMES.some((m) => m.startsWith(t)) || ["TAGS", "HASHTAG"].some((m) => m.startsWith(t));
}

function cleanBlock(s) {
  return s
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}

/**
 * Раскладывает сырой (в том числе незавершённый) буфер стрима по 4 блокам.
 * Терпим к: регистру маркеров, пробелам внутри скобок, markdown-обёрткам,
 * обрезанному на середине маркеру в конце буфера, повторным маркерам.
 */
function parseDelimitedPost(rawBuffer) {
  const raw = String(rawBuffer || "").replace(/\r\n?/g, "\n");
  const out = {
    title: "",
    body: "",
    cta: "",
    tags: [],
    active: null,
    seen: { title: false, body: false, cta: false, tags: false },
  };
  const re = /\**\[\s*(TITLE|BODY|CTA|HASHTAGS|HASHTAG|TAGS)\s*\]\**:?/gi;
  const hits = [];
  let m;
  while ((m = re.exec(raw))) {
    hits.push({ key: MARKER_KEY[m[1].toUpperCase()], start: m.index, end: m.index + m[0].length });
  }

  if (!hits.length) {
    // Модель проигнорировала формат: показываем текст в BODY, но не мусор вроде "[TIT".
    const trimmed = raw.trim();
    if (trimmed.length > 60 && !/^\**\[/.test(trimmed)) {
      out.body = cleanBlock(trimmed);
      out.seen.body = true;
      out.active = "body";
    }
    return out;
  }

  const parts = { title: [], body: [], cta: [], tags: [] };
  hits.forEach((h, i) => {
    const isLast = i === hits.length - 1;
    let seg = raw.slice(h.end, isLast ? raw.length : hits[i + 1].start);
    if (isLast) {
      // хвост вида "\n[BO" — начало следующего маркера, ещё не дошедшее целиком
      const tail = seg.match(/\**\[[^\]\n]{0,10}$/);
      if (tail && isPartialMarker(tail[0])) seg = seg.slice(0, tail.index);
    }
    parts[h.key].push(seg);
    out.seen[h.key] = true;
  });
  out.active = hits[hits.length - 1].key;

  out.title = cleanBlock(parts.title.join("\n"))
    .replace(/^[#*]+\s*/, "")
    .replace(/\*+$/, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/^[«"](.*)[»"]$/, "$1");
  out.body = cleanBlock(parts.body.join("\n\n"));
  out.cta = cleanBlock(parts.cta.join("\n"));

  const tagsRaw = parts.tags.join(" ");
  const seenTags = new Set();
  tagsRaw
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .forEach((t) => {
      const tag = "#" + t;
      const k = tag.toLowerCase();
      if (!seenTags.has(k)) {
        seenTags.add(k);
        out.tags.push(tag);
      }
    });
  return out;
}

function serializePost(p) {
  return `[TITLE]\n${p.title}\n\n[BODY]\n${p.body}\n\n[CTA]\n${p.cta}\n\n[HASHTAGS]\n${(p.tags || []).join(" ")}`;
}

function buildFullText(post, disabled) {
  const tags = (post.tags || []).filter((t) => !(disabled && disabled.has(t)));
  return [post.title, post.body, post.cta, tags.join(" ")].filter((s) => s && s.trim()).join("\n\n");
}

/* ───────────────────────── Промпты Gemini ───────────────────────── */

const PLATFORM_STYLE = {
  tg: "Telegram-канал. Плотный текст, короткие абзацы по 1–3 предложения, допустимы списки через «—». Эмодзи не больше двух на весь пост.",
  ig: "Пост в Instagram. Первая строка BODY продолжает крючок, абзацы по 1–3 предложения с пустой строкой между ними, разговорный тон, эмодзи умеренно (3–5 на пост).",
  yt: "Описание YouTube-ролика. О чём видео и что зритель получит, затем блок таймкодов в формате «00:00 — пункт» (5–7 строк), в конце 1–2 предложения с ключевыми словами для поиска.",
};

const ANGLE_PROMPT = {
  expert:
    "УГОЛ ПОДАЧИ: ЭКСПЕРТНЫЙ РАЗБОР. Чёткий тезис, 2–4 аргумента с конкретикой, практические шаги, одна типичная ошибка и как её избежать.",
  storytelling:
    "УГОЛ ПОДАЧИ: СТОРИТЕЛЛИНГ. История с героем, конфликтом и поворотом. Вывод вплетён в сюжет, без морали в лоб. Детали: время, место, реплики.",
  direct_offer:
    "УГОЛ ПОДАЧИ: ПРЯМОЙ ОФФЕР. Боль клиента в его словах, решение, что входит, условия, срок, ограничение, снятие главного возражения.",
};

function buildSystemPrompt(platformId) {
  const p = PLATFORMS[platformId];
  return [
    "Ты — редактор-копирайтер для соцсетей. Пишешь на русском, языком практика, который знает предмет.",
    "",
    "ЖЁСТКИЙ ФОРМАТ ОТВЕТА. Ровно четыре секции в этом порядке, каждый маркер на отдельной строке:",
    "[TITLE]",
    "текст заголовка",
    "[BODY]",
    "основной текст",
    "[CTA]",
    "призыв к действию",
    "[HASHTAGS]",
    "#тег1 #тег2 #тег3",
    "Никакого текста до [TITLE] и после хэштегов. Без markdown (**, ##, ```), без пояснений и вариантов.",
    "",
    "АНТИ-ШТАМП ФИЛЬТР. Запрещены фразы и любые их вариации: «В современном мире», «Ни для кого не секрет», «Уникальная возможность».",
    "Также не используй: «в наше время», «не упустите шанс», «давайте разберёмся», «секрет успеха», «революционный», «уникальный», «лучший на рынке», «индивидуальный подход».",
    "Вместо общих слов — конкретика: цифры, сроки, названия, действия, наблюдаемые детали.",
    "",
    "ПРАВИЛА СЕКЦИЙ:",
    "- TITLE: один крючок до 90 символов, без кавычек-ёлочек вокруг и без точки в конце.",
    `- BODY: строго не длиннее ${p.limit} символов с пробелами. Абзацы разделяй пустой строкой.`,
    "- CTA: 1–2 предложения с одним конкретным действием.",
    "- HASHTAGS: 5–8 хэштегов через пробел, каждый начинается с #, без пробелов внутри.",
  ].join("\n");
}

function buildUserPrompt({ idea, platformId, variantId, presets }) {
  const p = PLATFORMS[platformId];
  const presetLines = PRESETS.filter((x) => presets.includes(x.id)).map((x) => `- ${x.hint}`);
  return [
    `ПЛОЩАДКА: ${p.label}. ${PLATFORM_STYLE[platformId]}`,
    `ЛИМИТ BODY: ${p.limit} символов.`,
    ANGLE_PROMPT[variantId],
    presetLines.length ? "ДОПОЛНИТЕЛЬНО:\n" + presetLines.join("\n") : "",
    "",
    "ИДЕЯ / ОПИСАНИЕ БИЗНЕСА:",
    idea,
  ]
    .filter(Boolean)
    .join("\n");
}

async function streamGemini({ apiKey, system, prompt, signal, onText }) {
  let res;
  try {
    res = await fetch(GEMINI_URL(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Gemini 3.x: temperature/topP/topK устарели и игнорируются, thinking по умолчанию "minimal"
        generationConfig: {
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    const err = new Error("Сетевой запрос к Gemini заблокирован или недоступен.");
    err.network = true;
    throw err;
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch (e) {}
    const err = new Error(
      res.status === 400 || res.status === 403
        ? `Ключ отклонён: ${msg}`
        : res.status === 429
        ? "Лимит запросов Gemini исчерпан (429). Подождите минуту и повторите."
        : msg
    );
    err.status = res.status;
    throw err;
  }
  if (!res.body || !res.body.getReader) throw new Error("Браузер не поддерживает потоковое чтение ответа.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleEvent = (block) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (json.error) throw new Error(json.error.message || "Ошибка Gemini");
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      throw new Error(`Запрос отклонён фильтром Gemini: ${json.promptFeedback.blockReason}`);
    }
    const cand = json.candidates && json.candidates[0];
    if (!cand) return;
    const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
    if (text) onText(text);
    if (cand.finishReason === "SAFETY") throw new Error("Ответ остановлен фильтром безопасности Gemini.");
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let match;
    while ((match = buffer.match(/\r?\n\r?\n/))) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      handleEvent(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleEvent(buffer);
}

/* ───────────────────────── Демо-генератор ───────────────────────── */

const STOP = new Set(
  "это этот эта эти когда чтобы который которая которые хотим хочу хотят после перед потом очень много можно нужно люди время только через между нашей нашего наших своих своей район районе".split(" ")
);

function topicParts(idea) {
  const clean = idea.replace(/\s+/g, " ").trim() || DEFAULT_IDEA;
  let first = clean.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "");
  if (first.length > 64) {
    const cut = first.slice(0, 64);
    first = cut.slice(0, Math.max(cut.lastIndexOf(" "), 30)).replace(/[,;:—-]+$/, "");
  }
  const S = first.charAt(0).toUpperCase() + first.slice(1);
  const words = clean
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w));
  const kw = [];
  for (const w of words) {
    const t = w.replace(/-/g, "");
    if (!kw.includes(t)) kw.push(t);
    if (kw.length >= 3) break;
  }
  return { S, kw, clean };
}

function fitParagraphs(pars, limit) {
  const out = [];
  let len = 0;
  const max = Math.floor(limit * 0.94);
  for (const p of pars) {
    const add = (out.length ? 2 : 0) + p.length;
    if (len + add > max) {
      if (!out.length) out.push(p.slice(0, max));
      continue;
    }
    out.push(p);
    len += add;
  }
  return out.join("\n\n");
}

function buildDemoPost({ idea, platformId, variantId, presets, seed }) {
  const r = rng(hashStr(`${idea}|${platformId}|${variantId}|${seed}`));
  const { S, kw } = topicParts(idea);
  const P = PLATFORMS[platformId];
  const month = MONTHS[new Date().getMonth()];
  const has = (id) => presets.includes(id);
  const n = (a, b) => a + Math.floor(r() * (b - a + 1));
  const ig = platformId === "ig";
  const yt = platformId === "yt";
  let title = "";
  let pars = [];
  let cta = "";

  if (variantId === "expert") {
    title = pick(r, [
      `${S}: три решения, которые работают быстрее рекламы`,
      `${S}. Где теряются клиенты и что поменять за ${n(10, 21)} дней`,
      `${S}: разбор без воды, только то, что проверено цифрами`,
    ]);
    pars.push(
      ig
        ? `📌 Большинство в этой нише начинают с рекламы и скидок. Это самый дорогой путь: деньги уходят в охват, а повторных визитов больше не становится.`
        : `Большинство в этой нише начинают с рекламы и скидок. Это самый дорогой путь: деньги уходят в охват, а повторных визитов больше не становится.`
    );
    if (has("personal")) {
      pars.push(
        `Из личного опыта: на своём проекте мы ${pick(r, ["трижды", "четыре раза"])} переписывали предложение, прежде чем увидели рост. Каждый раз помогала не креативность, а цифры из кассы.`
      );
    }
    pars.push(
      `Что работает на практике:\n— Одно понятное обещание. Не «качественно и недорого», а результат и срок, которые можно проверить.\n— Первый контакт. Посмотрите, что человек видит за первые 10 секунд: витрину, шапку профиля, первое сообщение.\n— Повод вернуться. Механика второго визита окупается быстрее, чем новый трафик: абонемент, напоминание, бонус на следующий раз.`
    );
    if (has("breakdown")) {
      pars.push(
        `Порядок внедрения:\n1) аудит первого экрана — 1 день;\n2) новое обещание и тексты — 2 дня;\n3) механика возврата — ${n(5, 7)} дней;\n4) замер — 2 недели, без новых изменений.`
      );
    }
    if (has("case")) {
      pars.push(
        `Кейс: проект из похожей ниши за ${n(5, 8)} недель поднял долю повторных покупок с ${n(14, 19)}% до ${n(28, 36)}%. Бюджет на рекламу не меняли, переделали только первый экран и механику возврата.`
      );
    }
    pars.push(
      `Главная ошибка — менять всё сразу. Меняйте один элемент в неделю и считайте три показателя: обращения, конверсию в покупку и средний чек.`
    );
    if (has("offer")) {
      pars.push(`Если хотите применить это к своему проекту, разберу вашу ситуацию на 30-минутном созвоне. Бесплатно, ${n(3, 5)} слота на этой неделе.`);
    }
    if (yt) {
      pars.push(
        `Таймкоды:\n00:00 — О чём ролик\n01:${n(10, 40)} — Почему «как у всех» не работает\n03:${n(10, 50)} — Три рабочих решения\n07:${n(10, 50)} — Ошибка, которая съедает бюджет\n10:${n(10, 50)} — План на две недели\n12:${n(10, 50)} — Ответы на вопросы`
      );
    }
    if (ig) {
      pars.push(`Сохраните пост, чтобы вернуться к чек-листу, когда сядете за план на ${month}.`);
    }
    cta = yt
      ? pick(r, [
          "Напишите в комментариях, какой пункт внедрите первым, а шаблон плана заберите по ссылке в описании.",
          "Подпишитесь на канал: в следующем ролике разберу механику возврата клиентов по шагам.",
        ])
      : ig
      ? pick(r, ["Напишите «ПЛАН» в директ, пришлю чек-лист аудита первого экрана.", "Сохраните и отправьте тому, кто отвечает у вас за продажи."])
      : pick(r, ["Напишите «аудит» в комментариях, пришлю чек-лист первого экрана.", "Перешлите пост коллеге, который сейчас планирует рекламный бюджет."]);
  } else if (variantId === "storytelling") {
    title = pick(r, [
      `Один вопрос клиента, после которого мы переписали всё`,
      `Мы делали всё «правильно», а касса молчала. История про «${S}»`,
      `${n(3, 6)} месяцев тишины и одна фраза, которая всё поменяла`,
    ]);
    pars.push(
      `${pick(r, ["Март", "Октябрь", "Конец лета"])}. Тема — «${S}». Всё сделано по учебнику: красивые фото, акции по пятницам, посты три раза в неделю. А в кассе тишина.`
    );
    pars.push(
      `Перелом случился на обычном разговоре. Постоянный клиент спросил: «А почему я должен прийти именно к вам?» Ответа не нашлось. Ни у кого в команде.`
    );
    if (has("personal")) {
      pars.push(`Я помню этот вечер: мы сидели над пустой таблицей и впервые честно признали, что говорим о себе словами, которые клиенту ничего не объясняют.`);
    }
    pars.push(
      `Мы выписали всё, что клиенты говорили о нас сами, их словами. ${pick(r, ["Три", "Четыре"])} фразы повторялись чаще остальных. Они и стали новым текстом на вывеске, в профиле и в первом сообщении.`
    );
    if (has("breakdown")) {
      pars.push(
        `Что именно мы сделали:\n1. Собрали ${n(25, 40)} отзывов и выделили повторяющиеся слова.\n2. Переписали первый экран под эти слова.\n3. Убрали всё, что нельзя подтвердить фактом.`
      );
    }
    if (has("case")) {
      pars.push(`В цифрах: +${n(31, 48)}% обращений за ${n(4, 6)} недель при том же бюджете на продвижение.`);
    }
    pars.push(`Людей стало больше не потому, что мы стали громче. Нас стало проще понять.`);
    if (has("offer")) {
      pars.push(`Если узнали себя, мы собрали этот процесс в короткий воркшоп на 90 минут. Ближайшая группа стартует в ${month === "май" ? "мае" : "этом месяце"}.`);
    }
    if (yt) {
      pars.push(
        `Таймкоды:\n00:00 — Как всё начиналось\n02:${n(10, 50)} — Вопрос, на который не было ответа\n05:${n(10, 50)} — Что мы услышали от клиентов\n08:${n(10, 50)} — Новый текст и первые результаты\n11:${n(10, 50)} — Что бы мы сделали иначе`
      );
    }
    cta = yt
      ? "Расскажите в комментариях, какой вопрос клиента поставил в тупик вас. Лучшие истории разберу в следующем выпуске."
      : ig
      ? "Напишите в директ слово «ИСТОРИЯ», и я пришлю шаблон, по которому мы собирали отзывы."
      : "Напишите в комментариях, какой вопрос клиента однажды поставил в тупик вас.";
  } else {
    title = pick(r, [
      `${S}. Конкретное предложение на ${month}`,
      `Запуск под ключ за ${n(7, 12)} рабочих дней: «${S}»`,
      `${S}: берём ${n(3, 5)} проекта в этом месяце`,
    ]);
    pars.push(
      `Кому: тем, кто устал вкладываться в рекламу без понятной отдачи и хочет видеть результат в цифрах. Тема: «${S}».`
    );
    pars.push(
      `Что входит:\n— аудит текущей воронки и первого экрана;\n— новое предложение и ${n(3, 5)} текста под ваши каналы;\n— механика повторных продаж;\n— замер результата через 14 дней.`
    );
    if (has("case")) {
      pars.push(`Последний похожий проект: с ${n(40, 70)} до ${n(110, 160)} заявок в месяц за ${n(6, 9)} недель.`);
    }
    if (has("breakdown")) {
      pars.push(`Как проходит работа:\n1) бриф — 40 минут;\n2) аудит и стратегия — 3 дня;\n3) тексты и механика — 5 дней;\n4) запуск и замер — 2 недели.`);
    }
    if (has("personal")) {
      pars.push(`Веду каждый проект лично, без передачи стажёрам. Поэтому и беру немного.`);
    }
    pars.push(
      `Сроки: ${n(7, 12)} рабочих дней от брифа до запуска.\nУсловия: фиксированная стоимость, оплата в два этапа. Если через 14 дней показатели не выросли, дорабатываем бесплатно.`
    );
    pars.push(has("offer") ? `До конца месяца: аудит в подарок при старте до ${n(20, 28)} числа. Мест: ${n(2, 4)}.` : `Мест в этом месяце: ${n(3, 5)}.`);
    if (yt) {
      pars.push(
        `Таймкоды:\n00:00 — Для кого это предложение\n01:${n(10, 50)} — Что входит в работу\n04:${n(10, 50)} — Пример результата\n06:${n(10, 50)} — Условия и гарантия\n08:${n(10, 50)} — Как записаться`
      );
    }
    cta = yt
      ? "Ссылка на запись — в первом закреплённом комментарии и в описании ниже."
      : ig
      ? "Жмите на ссылку в шапке профиля или напишите «СТАРТ» в директ."
      : "Напишите «СТАРТ» в личные сообщения, пришлю бриф и свободные даты.";
  }

  const platformTags = { tg: ["#телеграм", "#бизнес"], ig: ["#инстаграм", "#маркетинг", "#smm"], yt: ["#youtube", "#разбор"] }[platformId];
  const angleTag = { expert: "#экспертиза", storytelling: "#историябренда", direct_offer: "#оффер" }[variantId];
  const presetTags = [has("case") && "#кейс", has("breakdown") && "#пошагово", has("personal") && "#личныйопыт", has("offer") && "#предложение"].filter(Boolean);
  const kwTags = kw.map((w) => "#" + w);
  const tags = Array.from(new Set([...kwTags, angleTag, ...presetTags, ...platformTags])).slice(0, 8);

  const body = fitParagraphs(pars, P.limit);
  return { title, body, cta, tags };
}

function tokenizeRaw(raw) {
  return raw.match(/\[[A-Z]+\]|\s+|[^\s\[]+|\[/g) || [];
}

/* ───────────────────────── Хранилище генераций (вне React) ───────────────────────── */

function emptyVariant() {
  return { raw: "", status: "idle", progress: 0, source: null, error: null, startedAt: 0, doneAt: 0 };
}
function emptyPlatform() {
  return {
    status: "idle",
    variants: { expert: emptyVariant(), storytelling: emptyVariant(), direct_offer: emptyVariant() },
  };
}
function newSession({ idea, presets, primary }) {
  return {
    id: uid(),
    idea,
    presets: presets.slice(),
    primary,
    seed: Math.floor(Math.random() * 1e9),
    createdAt: Date.now(),
    platforms: { tg: emptyPlatform(), ig: emptyPlatform(), yt: emptyPlatform() },
  };
}
function platformStatus(pl) {
  const vs = VARIANT_IDS.map((v) => pl.variants[v]);
  if (vs.every((v) => v.status === "idle")) return "idle";
  if (vs.some((v) => v.status === "streaming" || v.status === "queued")) return "warming";
  if (vs.some((v) => v.status === "error")) return "error";
  if (vs.every((v) => v.status === "done")) return "ready";
  return "warming";
}

/* ───────────────────────── Компоненты ───────────────────────── */

function Led({ state, size = 7 }) {
  return <span className={`led led-${state || "idle"}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

const ledLabel = {
  idle: "НЕТ ДАННЫХ",
  warming: "ПРОГРЕВ",
  ready: "ГОТОВО",
  error: "ОШИБКА",
};

const RevealText = memo(function RevealText({ text, animate }) {
  const tokens = useMemo(() => (text ? text.split(/(\s+)/) : []), [text]);
  return tokens.map((tk, i) =>
    tk === "" ? null : /^\s+$/.test(tk) ? (
      <span key={i}>{tk}</span>
    ) : (
      <span key={i} className={animate ? "w" : undefined}>
        {tk}
      </span>
    )
  );
});

function CopyBtn({ text, label = "COPY", onDone, disabled }) {
  const [state, setState] = useState("idle");
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button
      type="button"
      className={`btn-mini ${state === "ok" ? "is-ok" : ""} ${state === "fail" ? "is-fail" : ""}`}
      disabled={disabled || !text}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "fail");
        if (onDone) onDone(ok, text);
        clearTimeout(t.current);
        t.current = setTimeout(() => setState("idle"), 1200);
      }}
    >
      {state === "ok" ? "✓ COPIED" : state === "fail" ? "× FAILED" : `⧉ ${label}`}
    </button>
  );
}

function Skeleton({ lines = 3, widths }) {
  const w = widths || ["92%", "84%", "64%", "88%", "52%"];
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} style={{ width: w[i % w.length] }} />
      ))}
    </div>
  );
}

function Module({ num, code, label, right, children, kind, compact, active }) {
  return (
    <section className={`module mod-${kind} ${compact ? "is-compact" : ""} ${active ? "is-active" : ""}`}>
      <header className="module-head">
        <span className="badge">
          [{num} // {code}]
        </span>
        <span className="module-label">{label}</span>
        <span className="module-right">{right}</span>
      </header>
      <div className="module-body">{children}</div>
    </section>
  );
}

function PostStack({ post, variantState, platformId, compact, disabledTags, onToggleTag, tagMode, notify, onRetry, onDemo }) {
  const P = PLATFORMS[platformId];
  const streaming = variantState.status === "streaming";
  const idle = variantState.status === "idle" || variantState.status === "queued";
  const errored = variantState.status === "error";
  const bodyLen = post.body.length;
  const over = bodyLen > P.limit;
  const caret = (key) => (streaming && post.active === key ? <span className="caret" aria-hidden="true" /> : null);
  const pending = (key) => (streaming || idle) && !post.seen[key];
  const anim = streaming;

  if (errored && !post.title && !post.body) {
    return (
      <div className="error-box">
        <div className="badge">[ERR // GEMINI]</div>
        <p>{variantState.error || "Не удалось получить ответ."}</p>
        <div className="row-gap">
          <button type="button" className="btn" onClick={onRetry}>
            ↻ ПОВТОРИТЬ
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDemo}>
            ДЕМО-ВАРИАНТ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`stack ${compact ? "is-compact" : ""}`}>
      <Module
        num="01"
        code="HOOK"
        label="Заголовок"
        kind="hook"
        compact={compact}
        active={streaming && post.active === "title"}
        right={<CopyBtn text={post.title} onDone={(ok) => notify(ok ? "Заголовок скопирован" : "Не удалось скопировать")} disabled={!post.title} />}
      >
        {pending("title") && !post.title ? (
          <Skeleton lines={1} widths={["72%"]} />
        ) : (
          <h2 className="hook-text">
            <RevealText text={post.title} animate={anim} />
            {caret("title")}
          </h2>
        )}
      </Module>

      <Module
        num="02"
        code="BODY"
        label="Основной текст"
        kind="body"
        compact={compact}
        active={streaming && post.active === "body"}
        right={
          <>
            <span className={`counter ${over ? "is-over" : ""}`} title={`Лимит ${P.label}: ${P.limit}`}>
              {fmtNum(bodyLen)} / {fmtNum(P.limit)}
            </span>
            <CopyBtn text={post.body} onDone={(ok) => notify(ok ? "Текст скопирован" : "Не удалось скопировать")} disabled={!post.body} />
          </>
        }
      >
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (bodyLen / P.limit) * 100)}%` }} className={over ? "is-over" : ""} />
        </div>
        {pending("body") && !post.body ? (
          <Skeleton lines={compact ? 4 : 6} />
        ) : (
          <div className="body-text">
            <RevealText text={post.body} animate={anim} />
            {caret("body")}
          </div>
        )}
        {over && !streaming ? <div className="warn">Превышен лимит {P.label} на {fmtNum(bodyLen - P.limit)} симв. Сократите текст перед публикацией.</div> : null}
      </Module>

      <Module
        num="03"
        code="CTA"
        label="Призыв к действию"
        kind="cta"
        compact={compact}
        active={streaming && post.active === "cta"}
        right={<CopyBtn text={post.cta} onDone={(ok) => notify(ok ? "CTA скопирован" : "Не удалось скопировать")} disabled={!post.cta} />}
      >
        {pending("cta") && !post.cta ? (
          <Skeleton lines={1} widths={["80%"]} />
        ) : (
          <p className="cta-text">
            <RevealText text={post.cta} animate={anim} />
            {caret("cta")}
          </p>
        )}
      </Module>

      <Module
        num="04"
        code="TAGS"
        label={tagMode === "copy" ? "Клик копирует тег" : "Клик отключает тег"}
        kind="tags"
        compact={compact}
        active={streaming && post.active === "tags"}
        right={
          <CopyBtn
            text={post.tags.filter((t) => !disabledTags.has(t)).join(" ")}
            onDone={(ok) => notify(ok ? "Хэштеги скопированы" : "Не удалось скопировать")}
            disabled={!post.tags.length}
          />
        }
      >
        {pending("tags") && !post.tags.length ? (
          <div className="pills">
            {[64, 88, 72, 96].map((w, i) => (
              <span key={i} className="pill pill-ghost" style={{ width: w }} />
            ))}
          </div>
        ) : (
          <div className="pills">
            {post.tags.map((t, i) => {
              const off = disabledTags.has(t);
              return (
                <button
                  key={t + i}
                  type="button"
                  className={`pill ${off ? "is-off" : ""} ${anim ? "w" : ""}`}
                  title={tagMode === "copy" ? "Скопировать тег" : off ? "Включить тег" : "Отключить тег"}
                  onClick={async () => {
                    if (tagMode === "copy") {
                      const ok = await copyText(t);
                      notify(ok ? `${t} скопирован` : "Не удалось скопировать");
                    } else {
                      onToggleTag(t);
                    }
                  }}
                >
                  {t}
                </button>
              );
            })}
            {caret("tags")}
          </div>
        )}
      </Module>
    </div>
  );
}

function CopyAllBar({ post, disabledTags, platformId, variantId, streaming, notify }) {
  const [done, setDone] = useState(null);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const full = buildFullText(post, disabledTags);
  const P = PLATFORMS[platformId];
  return (
    <div className="copybar">
      <div className="copybar-meta">
        <span className="mono dim">
          {VARIANT_BY_ID[variantId].idx} · {VARIANT_BY_ID[variantId].label.toUpperCase()} · {P.label.toUpperCase()}
        </span>
        <span className="mono dim">{fmtNum(full.length)} СИМВ.</span>
      </div>
      <button
        type="button"
        className={`btn-copyall ${done ? "is-done" : ""}`}
        disabled={!full}
        onClick={async () => {
          const ok = await copyText(full);
          if (ok) {
            setDone(full.length);
            clearTimeout(t.current);
            t.current = setTimeout(() => setDone(null), 1600);
          } else {
            notify("Буфер обмена недоступен. Выделите текст вручную.");
          }
        }}
      >
        <span className="morph" aria-hidden="true">
          {done ? (
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18">
              <rect x="8" y="8" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M4 16V4h12" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </span>
        <span>{done ? `СКОПИРОВАНО · ${fmtNum(done)} СИМВ.` : streaming ? "СКОПИРОВАТЬ ВЕСЬ ПОСТ (ИДЁТ СТРИМ)" : "СКОПИРОВАТЬ ВЕСЬ ПОСТ"}</span>
      </button>
    </div>
  );
}

function ApiKeyModal({ open, onClose, apiKey, onSave, onRemove }) {
  const [val, setVal] = useState(apiKey || "");
  const [show, setShow] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setVal(apiKey || "");
      setShow(false);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    }
  }, [open, apiKey]);
  if (!open) return null;
  const masked = apiKey ? apiKey.slice(0, 6) + "•••••" + apiKey.slice(-4) : null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (val.trim()) onSave(val.trim());
        }}
      >
        <header className="modal-head">
          <span className="badge" id="api-title">
            [ 🔑 API KEY ]
          </span>
          <button type="button" className="btn-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="dim">
            Ключ Gemini API хранится только в localStorage этого браузера. Запросы идут напрямую в <span className="mono">generativelanguage.googleapis.com</span>,
            модель <span className="mono">{GEMINI_MODEL}</span>.
          </p>
          <label className="field-label" htmlFor="api-key-input">
            GEMINI API KEY
          </label>
          <div className="key-row">
            <input
              id="api-key-input"
              ref={inputRef}
              className="input mono"
              type={show ? "text" : "password"}
              value={val}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck="false"
              onChange={(e) => setVal(e.target.value)}
            />
            <button type="button" className="btn btn-ghost" onClick={() => setShow((s) => !s)}>
              {show ? "СКРЫТЬ" : "ПОКАЗАТЬ"}
            </button>
          </div>
          <div className="key-status mono">
            <Led state={apiKey ? "ready" : "idle"} /> {masked ? `СОХРАНЁН: ${masked}` : "КЛЮЧ НЕ ЗАДАН · РАБОТАЕТ ДЕМО-ГЕНЕРАТОР"}
          </div>
          <p className="note">
            Ключ можно получить в Google AI Studio (aistudio.google.com → Get API key). Если среда просмотра блокирует внешние запросы, приложение покажет это и
            переключится на демо-генератор, чтобы интерфейс продолжал работать.
          </p>
        </div>
        <footer className="modal-foot">
          {apiKey ? (
            <button type="button" className="btn btn-ghost btn-danger" onClick={onRemove}>
              УДАЛИТЬ КЛЮЧ
            </button>
          ) : (
            <span />
          )}
          <div className="row-gap">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ОТМЕНА
            </button>
            <button type="submit" className="btn btn-primary" disabled={!val.trim()}>
              СОХРАНИТЬ
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function HistoryDrawer({ open, onClose, history, onLoad, onDelete, onClear, notify }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const searchRef = useRef(null);
  useEffect(() => {
    if (open) {
      setConfirmClear(false);
      setTimeout(() => searchRef.current && searchRef.current.focus(), 60);
    }
  }, [open]);

  const items = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return history.filter((h) => {
      if (filter !== "all" && h.platform !== filter) return false;
      if (!qq) return true;
      return [h.title, h.body, h.cta, (h.tags || []).join(" "), h.idea].join(" ").toLowerCase().includes(qq);
    });
  }, [history, q, filter]);

  const counts = useMemo(() => {
    const c = { all: history.length, tg: 0, ig: 0, yt: 0 };
    history.forEach((h) => (c[h.platform] = (c[h.platform] || 0) + 1));
    return c;
  }, [history]);

  return (
    <div className={`drawer-wrap ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="История постов">
        <header className="drawer-head">
          <span className="badge">[ HISTORY · {history.length} ]</span>
          <button type="button" className="btn-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="drawer-tools">
          <input
            id="history-search"
            ref={searchRef}
            className="input"
            type="search"
            placeholder="Поиск по тексту, тегам, идее…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="seg" role="tablist" aria-label="Фильтр по площадке">
            {[
              ["all", "Все"],
              ["tg", "TG"],
              ["ig", "IG"],
              ["yt", "YT"],
            ].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`seg-btn ${filter === id ? "is-on" : ""}`} onClick={() => setFilter(id)}>
                {label} <span className="dim">{counts[id] || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-list">
          {!history.length ? (
            <div className="empty">
              <div className="badge">[ ПУСТО ]</div>
              <p>Каждый готовый вариант сохраняется сюда автоматически. Сгенерируйте первый пост.</p>
            </div>
          ) : !items.length ? (
            <div className="empty">
              <div className="badge">[ 0 СОВПАДЕНИЙ ]</div>
              <p>Ничего не найдено по запросу «{q}». Измените запрос или фильтр.</p>
            </div>
          ) : (
            items.map((h) => {
              const P = PLATFORMS[h.platform];
              const V = VARIANT_BY_ID[h.variant];
              const full = buildFullText(h, new Set(h.disabledTags || []));
              return (
                <article key={h.id} className="hcard" style={{ "--acc": P.accent }}>
                  <header className="hcard-head">
                    <span className="mono hcard-plat">
                      <i className="dot" /> {P.short}
                    </span>
                    <span className="mono dim">
                      {V ? V.idx : "--"} · {V ? V.short.toUpperCase() : ""}
                    </span>
                    <span className="mono dim hcard-date">{fmtDate(h.createdAt)}</span>
                  </header>
                  <h3 className="hcard-title">{h.title || "Без заголовка"}</h3>
                  <p className="hcard-body">{h.body}</p>
                  <footer className="hcard-foot">
                    <button
                      type="button"
                      className={`btn-mini ${copiedId === h.id ? "is-ok" : ""}`}
                      onClick={async () => {
                        const ok = await copyText(full);
                        if (ok) {
                          setCopiedId(h.id);
                          setTimeout(() => setCopiedId((c) => (c === h.id ? null : c)), 1200);
                        } else notify("Не удалось скопировать");
                      }}
                    >
                      {copiedId === h.id ? `✓ ${fmtNum(full.length)} СИМВ.` : "⧉ COPY"}
                    </button>
                    <button type="button" className="btn-mini" onClick={() => onLoad(h)}>
                      ↩ В РЕДАКТОР
                    </button>
                    <span className="grow" />
                    {h.source === "gemini" ? <span className="mono dim">GEMINI</span> : <span className="mono dim">DEMO</span>}
                    <button type="button" className="btn-mini btn-mini-x" onClick={() => onDelete(h.id)} aria-label="Удалить">
                      ×
                    </button>
                  </footer>
                </article>
              );
            })
          )}
        </div>
        {history.length ? (
          <footer className="drawer-foot">
            {confirmClear ? (
              <>
                <span className="mono dim">Удалить все {history.length}?</span>
                <span className="grow" />
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
                  НЕТ
                </button>
                <button
                  type="button"
                  className="btn btn-danger-solid"
                  onClick={() => {
                    onClear();
                    setConfirmClear(false);
                  }}
                >
                  ДА, ОЧИСТИТЬ
                </button>
              </>
            ) : (
              <>
                <span className="mono dim">localStorage · до 200 записей</span>
                <span className="grow" />
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(true)}>
                  ОЧИСТИТЬ ИСТОРИЮ
                </button>
              </>
            )}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

/* ───────────────────────── Приложение ───────────────────────── */

function App() {
  const [theme, setTheme] = useState(() => lsGet(LS.theme, "graphite"));
  const [platform, setPlatform] = useState(() => {
    const p = lsGet(LS.platform, "tg");
    return PLATFORMS[p] ? p : "tg";
  });
  const [idea, setIdea] = useState(() => lsGet(LS.idea, DEFAULT_IDEA));
  const [presets, setPresets] = useState(() => lsGet(LS.presets, ["case"]));
  const [apiKey, setApiKey] = useState(() => lsGet(LS.key, ""));
  const [history, setHistory] = useState(() => {
    const h = lsGet(LS.history, []);
    return Array.isArray(h) ? h : [];
  });
  const [view, setView] = useState(() => lsGet(LS.view, "focus"));
  const [tagMode, setTagMode] = useState(() => lsGet(LS.tagMode, "toggle"));
  const [activeVariant, setActiveVariant] = useState("expert");
  const [keyOpen, setKeyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [switchMs, setSwitchMs] = useState(0);
  const [toast, setToast] = useState(null);
  const [netNotice, setNetNotice] = useState(false);
  const [disabledTags, setDisabledTags] = useState({});

  const sessionRef = useRef(null);
  const ctrlRef = useRef(null);
  const savedRef = useRef(new Set());
  const switchT = useRef(0);
  const toastT = useRef(null);
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const [, bump] = useReducer((x) => x + 1, 0);
  const rafRef = useRef(0);
  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      bump();
    });
  }, []);

  /* persist prefs */
  useEffect(() => {
    document.documentElement.setAttribute("data-skin", theme);
    lsSet(LS.theme, theme);
  }, [theme]);
  useEffect(() => lsSet(LS.platform, platform), [platform]);
  useEffect(() => lsSet(LS.idea, idea), [idea]);
  useEffect(() => lsSet(LS.presets, presets), [presets]);
  useEffect(() => lsSet(LS.view, view), [view]);
  useEffect(() => lsSet(LS.tagMode, tagMode), [tagMode]);
  useEffect(() => lsSet(LS.history, history), [history]);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /* ── движок генерации ── */

  const runVariant = useCallback(
    async (session, platformId, variantId, { background = false } = {}) => {
      const ctrl = ctrlRef.current;
      if (!ctrl || ctrl.sessionId !== session.id) return;
      const signal = ctrl.abort.signal;
      const V = session.platforms[platformId].variants[variantId];
      Object.assign(V, { raw: "", status: "streaming", progress: 0, error: null, startedAt: performance.now(), doneAt: 0 });
      session.platforms[platformId].status = platformStatus(session.platforms[platformId]);
      scheduleRender();

      const limit = PLATFORMS[platformId].limit;
      const key = apiKeyRef.current;
      const useGemini = !!key && !ctrl.forceDemo;

      // Насос: выпускает текст на экран по словам с адаптивной скоростью
      let pending = [];
      let finished = false;
      let totalTokens = 0;
      let emitted = 0;
      const baseDelay = background ? 8 : [26, 31, 36][VARIANT_IDS.indexOf(variantId)];

      const pump = (async () => {
        while (true) {
          if (signal.aborted) throw abortError();
          if (pending.length) {
            const burst = Math.max(1, Math.floor(pending.length / 24));
            let chunk = "";
            for (let i = 0; i < burst && pending.length; i++) {
              chunk += pending.shift();
              if (pending.length && /^\s+$/.test(pending[0])) chunk += pending.shift();
            }
            V.raw += chunk;
            emitted += burst;
            if (useGemini) {
              const p = parseDelimitedPost(V.raw);
              const est =
                p.active === "tags" ? 94 : p.active === "cta" ? 86 : p.active === "body" ? 12 + 70 * Math.min(1, p.body.length / (limit * 0.7)) : p.active === "title" ? 6 : 2;
              V.progress = Math.max(V.progress, Math.min(96, est));
            } else {
              V.progress = totalTokens ? Math.min(99, (emitted / totalTokens) * 100) : 0;
            }
            scheduleRender();
            const jitter = background ? 0 : Math.random() * 22 - 6;
            await sleep(Math.max(4, baseDelay + jitter), signal);
          } else if (finished) {
            break;
          } else {
            await sleep(16, signal);
          }
        }
      })();

      const pushText = (txt) => {
        const toks = tokenizeRaw(txt);
        totalTokens += toks.length;
        pending.push(...toks);
      };

      try {
        if (useGemini) {
          try {
            await streamGemini({
              apiKey: key,
              system: buildSystemPrompt(platformId),
              prompt: buildUserPrompt({ idea: session.idea, platformId, variantId, presets: session.presets }),
              signal,
              onText: pushText,
            });
            V.source = "gemini";
          } catch (e) {
            if (e.name === "AbortError") throw e;
            if (e.network) {
              // Среда блокирует внешние запросы — продолжаем на демо, чтобы UI работал.
              ctrl.forceDemo = true;
              setNetNotice(true);
              pending = [];
              V.raw = "";
              const demo = buildDemoPost({ idea: session.idea, platformId, variantId, presets: session.presets, seed: session.seed });
              pushText(serializePost(demo));
              V.source = "demo-fallback";
            } else {
              throw e;
            }
          }
        } else {
          await sleep(background ? 60 : 180 + VARIANT_IDS.indexOf(variantId) * 140, signal);
          const demo = buildDemoPost({ idea: session.idea, platformId, variantId, presets: session.presets, seed: session.seed });
          pushText(serializePost(demo));
          V.source = "demo";
        }
        finished = true;
        await pump;
        V.status = "done";
        V.progress = 100;
        V.doneAt = performance.now();
      } catch (e) {
        finished = true;
        pending = [];
        if (e.name === "AbortError") return;
        try {
          await pump;
        } catch (e2) {}
        V.status = "error";
        V.error = e.message || String(e);
        V.progress = 100;
        if (!background) notify(V.error);
      } finally {
        session.platforms[platformId].status = platformStatus(session.platforms[platformId]);
        scheduleRender();
      }
    },
    [scheduleRender, notify]
  );

  const runPlatform = useCallback(
    async (session, platformId, opts) => {
      const pl = session.platforms[platformId];
      if (pl.started) return pl.started;
      pl.started = Promise.all(VARIANT_IDS.map((v) => runVariant(session, platformId, v, opts)));
      return pl.started;
    },
    [runVariant]
  );

  const generate = useCallback(() => {
    const text = idea.trim();
    if (!text) {
      notify("Опишите идею или бизнес, чтобы сгенерировать пост");
      return;
    }
    if (ctrlRef.current) ctrlRef.current.abort.abort();
    const session = newSession({ idea: text, presets, primary: platform });
    sessionRef.current = session;
    const ctrl = { sessionId: session.id, abort: new AbortController(), forceDemo: false };
    ctrlRef.current = ctrl;
    setDisabledTags({});
    scheduleRender();

    (async () => {
      await runPlatform(session, platform, { background: false });
      if (ctrl.abort.signal.aborted) return;
      const others = PLATFORM_IDS.filter((p) => p !== platform);
      // Кросс-платформенный прогрев: светодиоды горят янтарным до готовности
      others.forEach((p) => {
        const pl = session.platforms[p];
        if (!pl.started) {
          VARIANT_IDS.forEach((v) => (pl.variants[v].status = "queued"));
          pl.status = "warming";
        }
      });
      scheduleRender();
      const gem = !!apiKeyRef.current && !ctrl.forceDemo;
      if (gem) {
        for (const p of others) {
          if (ctrl.abort.signal.aborted) return;
          await runPlatform(session, p, { background: true });
        }
      } else {
        await Promise.all(others.map((p) => runPlatform(session, p, { background: true })));
      }
    })();
  }, [idea, presets, platform, runPlatform, notify, scheduleRender]);

  /* автозапуск демо при первом открытии, чтобы холст не был пустым */
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    if (!history.length) generate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* при выборе площадки, которая ещё не стартовала в текущей сессии, запускаем её сразу */
  const selectPlatform = useCallback(
    (p) => {
      switchT.current = performance.now();
      setPlatform(p);
      const s = sessionRef.current;
      if (s && ctrlRef.current && ctrlRef.current.sessionId === s.id) {
        const pl = s.platforms[p];
        if (!pl.started && pl.status === "idle") runPlatform(s, p, { background: false });
      }
    },
    [runPlatform]
  );

  const selectVariant = useCallback((v) => {
    switchT.current = performance.now();
    setActiveVariant(v);
  }, []);

  useLayoutEffect(() => {
    if (switchT.current) {
      const ms = performance.now() - switchT.current;
      switchT.current = 0;
      setSwitchMs(Math.max(0, Math.round(ms)));
    }
  }, [activeVariant, platform]);

  /* ── автосохранение в историю ── */
  const session = sessionRef.current;
  useEffect(() => {
    const s = sessionRef.current;
    if (!s) return;
    const toAdd = [];
    PLATFORM_IDS.forEach((p) => {
      const pl = s.platforms[p];
      const visible = p === platform || p === s.primary;
      if (!visible) return;
      VARIANT_IDS.forEach((v) => {
        const V = pl.variants[v];
        const id = `${s.id}-${p}-${v}`;
        if (V.status === "done" && !savedRef.current.has(id) && !s.loaded) {
          savedRef.current.add(id);
          const post = parseDelimitedPost(V.raw);
          toAdd.push({
            id,
            sessionId: s.id,
            platform: p,
            variant: v,
            idea: s.idea,
            presets: s.presets,
            title: post.title,
            body: post.body,
            cta: post.cta,
            tags: post.tags,
            source: V.source === "gemini" ? "gemini" : "demo",
            createdAt: Date.now(),
          });
        }
      });
    });
    if (toAdd.length) setHistory((h) => [...toAdd.reverse(), ...h].slice(0, 200));
  });

  /* ── горячие клавиши ── */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        generate();
        return;
      }
      if (e.key === "Escape") {
        setKeyOpen(false);
        setHistoryOpen(false);
        return;
      }
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1" || e.key === "2" || e.key === "3") selectVariant(VARIANT_IDS[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generate, selectVariant]);

  /* ── история: загрузка обратно в редактор ── */
  const loadFromHistory = useCallback(
    (entry) => {
      if (ctrlRef.current) ctrlRef.current.abort.abort();
      const related = history.filter((h) => h.sessionId === entry.sessionId);
      const s = newSession({ idea: entry.idea, presets: entry.presets || [], primary: entry.platform });
      s.id = entry.sessionId;
      s.loaded = true;
      related.forEach((h) => {
        const pl = s.platforms[h.platform];
        if (!pl) return;
        const V = pl.variants[h.variant];
        if (!V) return;
        Object.assign(V, { raw: serializePost(h), status: "done", progress: 100, source: h.source });
        pl.started = Promise.resolve();
      });
      PLATFORM_IDS.forEach((p) => (s.platforms[p].status = platformStatus(s.platforms[p])));
      sessionRef.current = s;
      ctrlRef.current = { sessionId: s.id, abort: new AbortController(), forceDemo: false };
      const dt = {};
      related.forEach((h) => {
        if (h.disabledTags && h.disabledTags.length) dt[`${s.id}|${h.platform}|${h.variant}`] = h.disabledTags;
      });
      setDisabledTags(dt);
      setIdea(entry.idea || "");
      setPresets(entry.presets || []);
      switchT.current = performance.now();
      setPlatform(entry.platform);
      setActiveVariant(entry.variant);
      setHistoryOpen(false);
      notify("Пост загружен в редактор");
      scheduleRender();
    },
    [history, notify, scheduleRender]
  );

  /* ── производные данные для рендера ── */
  const P = PLATFORMS[platform];
  const plData = session ? session.platforms[platform] : null;
  const platStatus = (p) => (session ? platformStatus(session.platforms[p]) : "idle");
  const readyCount = plData ? VARIANT_IDS.filter((v) => plData.variants[v].status === "done").length : 0;
  const anyStreaming = plData ? VARIANT_IDS.some((v) => plData.variants[v].status === "streaming") : false;
  const primaryBusy = session ? platformStatus(session.platforms[session.primary]) === "warming" : false;

  const posts = useMemo(() => {
    const o = {};
    VARIANT_IDS.forEach((v) => {
      o[v] = plData ? parseDelimitedPost(plData.variants[v].raw) : parseDelimitedPost("");
    });
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plData, plData && plData.variants.expert.raw, plData && plData.variants.storytelling.raw, plData && plData.variants.direct_offer.raw]);

  const dtKey = (v) => `${session ? session.id : "none"}|${platform}|${v}`;
  const getDisabled = (v) => new Set(disabledTags[dtKey(v)] || []);
  const toggleTag = (v, tag) => {
    const k = dtKey(v);
    setDisabledTags((d) => {
      const cur = new Set(d[k] || []);
      if (cur.has(tag)) cur.delete(tag);
      else cur.add(tag);
      const next = { ...d, [k]: Array.from(cur) };
      // синхронизируем с историей
      const hid = `${session.id}-${platform}-${v}`;
      setHistory((h) => h.map((e) => (e.id === hid ? { ...e, disabledTags: Array.from(cur) } : e)));
      return next;
    });
  };

  const retry = (v) => {
    const s = sessionRef.current;
    if (!s) return;
    runVariant(s, platform, v, { background: false });
  };
  const demoOne = (v) => {
    const s = sessionRef.current;
    if (!s || !ctrlRef.current) return;
    const prev = ctrlRef.current.forceDemo;
    ctrlRef.current.forceDemo = true;
    runVariant(s, platform, v, { background: false }).then(() => {
      if (ctrlRef.current) ctrlRef.current.forceDemo = prev;
    });
  };

  const sourceLabel = apiKey ? "GEMINI 3.5 FLASH-LITE" : "DEMO";
  const ideaLen = idea.length;

  return (
    <div className="app" style={{ "--acc": P.accent }}>
      {/* ───────── TOP BAR ───────── */}
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark" aria-hidden="true" />
          <span className="logo-text">
            CONTENT<span className="acc">.</span>LAB
          </span>
          <span className="logo-ver mono">v1.0</span>
        </div>

        <div className="plat-indicator mono" aria-label="Статус прегенерации по площадкам">
          {PLATFORM_IDS.map((p) => (
            <button
              key={p}
              type="button"
              className={`pi ${p === platform ? "is-on" : ""}`}
              onClick={() => selectPlatform(p)}
              title={`${PLATFORMS[p].label}: ${ledLabel[platStatus(p)]}`}
              style={{ "--pacc": PLATFORMS[p].accent }}
            >
              <Led state={platStatus(p)} />
              {PLATFORMS[p].short}
            </button>
          ))}
        </div>

        <div className="top-actions">
          <button type="button" className={`btn-top ${apiKey ? "has-key" : ""}`} onClick={() => setKeyOpen(true)}>
            <span aria-hidden="true">🔑</span> API KEY <Led state={apiKey ? "ready" : "idle"} size={6} />
          </button>
          <button type="button" className="btn-top" onClick={() => setHistoryOpen(true)}>
            HISTORY ({history.length})
          </button>
          <div className="theme-toggle mono" role="radiogroup" aria-label="Тема">
            <button type="button" role="radio" aria-checked={theme === "graphite"} className={theme === "graphite" ? "is-on" : ""} onClick={() => setTheme("graphite")}>
              GRAPHITE
            </button>
            <span className="slash">/</span>
            <button type="button" role="radio" aria-checked={theme === "paper"} className={theme === "paper" ? "is-on" : ""} onClick={() => setTheme("paper")}>
              PAPER
            </button>
          </div>
        </div>
      </header>

      <main className="split">
        {/* ───────── CONTROL DECK ───────── */}
        <aside className="deck">
          <div className="deck-section">
            <div className="section-label mono">
              <span>[A] ПЛОЩАДКА</span>
              <span className="dim">ЛИМИТ BODY</span>
            </div>
            <div className="selector" role="radiogroup" aria-label="Соцсеть">
              {PLATFORM_IDS.map((p) => {
                const st = platStatus(p);
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={platform === p}
                    className={`sel-btn ${platform === p ? "is-on" : ""}`}
                    style={{ "--pacc": PLATFORMS[p].accent }}
                    onClick={() => selectPlatform(p)}
                  >
                    <span className="sel-top">
                      <Led state={st} />
                      <span className="mono sel-short">{PLATFORMS[p].short}</span>
                    </span>
                    <span className="sel-name">{PLATFORMS[p].label}</span>
                    <span className="mono sel-limit">{fmtNum(PLATFORMS[p].limit)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="deck-section">
            <div className="section-label mono">
              <label htmlFor="idea-input">[B] ИДЕЯ / ОПИСАНИЕ БИЗНЕСА</label>
              <span className="dim">{fmtNum(ideaLen)} СИМВ.</span>
            </div>
            <textarea
              id="idea-input"
              className="textarea"
              value={idea}
              rows={7}
              placeholder="Например: студия растяжки у метро, хотим заполнить утренние группы"
              onChange={(e) => setIdea(e.target.value)}
            />
          </div>

          <div className="deck-section">
            <div className="section-label mono">
              <span>[C] ПРЕСЕТЫ</span>
              <span className="dim">{presets.length} / 4</span>
            </div>
            <div className="chips">
              {PRESETS.map((pr) => {
                const on = presets.includes(pr.id);
                return (
                  <button
                    key={pr.id}
                    type="button"
                    aria-pressed={on}
                    className={`chip mono ${on ? "is-on" : ""}`}
                    title={pr.hint}
                    onClick={() => setPresets((ps) => (ps.includes(pr.id) ? ps.filter((x) => x !== pr.id) : [...ps, pr.id]))}
                  >
                    {pr.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="deck-section">
            <button type="button" className={`btn-generate ${primaryBusy ? "is-busy" : ""}`} onClick={generate}>
              <span className="gen-label">{primaryBusy ? `ГЕНЕРАЦИЯ… ${readyCount}/3` : "СГЕНЕРИРОВАТЬ ПОСТ"}</span>
              <span className="kbd mono">⌘+↵</span>
            </button>
            <div className="gen-meta mono">
              <span>
                ИСТОЧНИК: <b>{sourceLabel}</b>
              </span>
              <span className="dim">3 УГЛА × 3 ПЛОЩАДКИ</span>
            </div>
          </div>

          <div className="deck-section readout">
            <div className="section-label mono">
              <span>[D] ПРЕГЕНЕРАЦИЯ</span>
            </div>
            <ul className="readout-list mono">
              {PLATFORM_IDS.map((p) => {
                const st = platStatus(p);
                const n = session ? VARIANT_IDS.filter((v) => session.platforms[p].variants[v].status === "done").length : 0;
                return (
                  <li key={p}>
                    <Led state={st} />
                    <span className="ro-name">{PLATFORMS[p].label}</span>
                    <span className="ro-dots" aria-hidden="true" />
                    <span className={`ro-state st-${st}`}>
                      {ledLabel[st]} {st !== "idle" ? `${n}/3` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {netNotice ? (
              <p className="note warnnote">
                Среда просмотра заблокировала запрос к Gemini, поэтому посты собраны демо-генератором. Откройте HTML-файл локально или на своём хостинге, чтобы
                работал реальный стрим.
              </p>
            ) : null}
          </div>
        </aside>

        {/* ───────── MODULAR CANVAS ───────── */}
        <section className="canvas">
          <div className="canvas-head">
            <div className="tabs" role="tablist" aria-label="Варианты подачи">
              {VARIANTS.map((v) => {
                const st = plData ? plData.variants[v.id] : emptyVariant();
                const on = activeVariant === v.id;
                return (
                  <button key={v.id} type="button" role="tab" aria-selected={on} className={`tab ${on ? "is-on" : ""}`} onClick={() => selectVariant(v.id)}>
                    <span className="tab-idx serif">{v.idx}</span>
                    <span className="tab-text">
                      <span className="tab-label">{v.label}</span>
                      <span className="tab-state mono">
                        {st.status === "done"
                          ? "ГОТОВО"
                          : st.status === "streaming"
                          ? `СТРИМ ${Math.round(st.progress)}%`
                          : st.status === "error"
                          ? "ОШИБКА"
                          : st.status === "queued"
                          ? "В ОЧЕРЕДИ"
                          : "—"}
                      </span>
                    </span>
                    <span className="tab-bar" aria-hidden="true">
                      <i style={{ width: `${st.progress}%` }} className={st.status === "done" ? "is-done" : st.status === "error" ? "is-err" : ""} />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="canvas-tools">
              <span className={`ready-badge mono ${readyCount === 3 ? "is-ready" : anyStreaming ? "is-busy" : ""}`}>
                [<i className="rb-dot" />
                {readyCount === 3 ? " ГОТОВО" : anyStreaming ? " СТРИМ" : " ОЖИДАНИЕ"} {readyCount}/3 • {switchMs}ms]
              </span>
              <div className="seg mono" role="radiogroup" aria-label="Режим просмотра">
                <button type="button" role="radio" aria-checked={view === "focus"} className={`seg-btn ${view === "focus" ? "is-on" : ""}`} onClick={() => setView("focus")}>
                  ▢ Фокус 1x
                </button>
                <button type="button" role="radio" aria-checked={view === "compare"} className={`seg-btn ${view === "compare" ? "is-on" : ""}`} onClick={() => setView("compare")}>
                  ▤ Сравнение 3x
                </button>
              </div>
              <div className="seg mono" role="radiogroup" aria-label="Клик по тегу">
                <button type="button" role="radio" aria-checked={tagMode === "toggle"} className={`seg-btn ${tagMode === "toggle" ? "is-on" : ""}`} onClick={() => setTagMode("toggle")} title="Клик по тегу отключает его">
                  # ОТКЛ
                </button>
                <button type="button" role="radio" aria-checked={tagMode === "copy"} className={`seg-btn ${tagMode === "copy" ? "is-on" : ""}`} onClick={() => setTagMode("copy")} title="Клик по тегу копирует его">
                  # КОПИЯ
                </button>
              </div>
            </div>
          </div>

          <div className="canvas-scroll">
            {!plData || platformStatus(plData) === "idle" ? (
              <div className="canvas-empty">
                <span className="serif empty-idx">00</span>
                <div>
                  <div className="badge">[ {P.label.toUpperCase()} · НЕТ ДАННЫХ ]</div>
                  <p>Опишите идею слева и нажмите «Сгенерировать пост» или ⌘+↵. Три варианта подачи появятся здесь, а две другие площадки прогреются в фоне.</p>
                </div>
              </div>
            ) : view === "focus" ? (
              <div className="focus">
                <div className="focus-head">
                  <span className="serif focus-idx">{VARIANT_BY_ID[activeVariant].idx}</span>
                  <div className="focus-meta">
                    <span className="focus-title">{VARIANT_BY_ID[activeVariant].label}</span>
                    <span className="mono dim">
                      {P.label.toUpperCase()} · {(plData.variants[activeVariant].source || (apiKey ? "gemini" : "demo")).toUpperCase().replace("-", " ")} ·{" "}
                      {session && session.idea ? session.idea.slice(0, 48) + (session.idea.length > 48 ? "…" : "") : ""}
                    </span>
                  </div>
                </div>
                <PostStack
                  post={posts[activeVariant]}
                  variantState={plData.variants[activeVariant]}
                  platformId={platform}
                  disabledTags={getDisabled(activeVariant)}
                  onToggleTag={(t) => toggleTag(activeVariant, t)}
                  tagMode={tagMode}
                  notify={notify}
                  onRetry={() => retry(activeVariant)}
                  onDemo={() => demoOne(activeVariant)}
                />
              </div>
            ) : (
              <div className="compare">
                {VARIANTS.map((v) => (
                  <div
                    key={v.id}
                    className={`compare-col ${activeVariant === v.id ? "is-on" : ""}`}
                    onClick={() => activeVariant !== v.id && selectVariant(v.id)}
                  >
                    <div className="compare-head">
                      <span className="serif compare-idx">{v.idx}</span>
                      <span className="compare-label">{v.label}</span>
                      {activeVariant === v.id ? <span className="mono acc-text">● ВЫБРАН</span> : null}
                    </div>
                    <PostStack
                      post={posts[v.id]}
                      variantState={plData.variants[v.id]}
                      platformId={platform}
                      compact
                      disabledTags={getDisabled(v.id)}
                      onToggleTag={(t) => toggleTag(v.id, t)}
                      tagMode={tagMode}
                      notify={notify}
                      onRetry={() => retry(v.id)}
                      onDemo={() => demoOne(v.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {plData && platformStatus(plData) !== "idle" ? (
            <CopyAllBar
              post={posts[activeVariant]}
              disabledTags={getDisabled(activeVariant)}
              platformId={platform}
              variantId={activeVariant}
              streaming={plData.variants[activeVariant].status === "streaming"}
              notify={notify}
            />
          ) : null}
        </section>
      </main>

      <ApiKeyModal
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        apiKey={apiKey}
        onSave={(k) => {
          setApiKey(k);
          lsSet(LS.key, k);
          setNetNotice(false);
          setKeyOpen(false);
          notify("Ключ сохранён. Следующая генерация пойдёт через Gemini");
        }}
        onRemove={() => {
          setApiKey("");
          lsDel(LS.key);
          setKeyOpen(false);
          notify("Ключ удалён. Включён демо-генератор");
        }}
      />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        onLoad={loadFromHistory}
        onDelete={(id) => setHistory((h) => h.filter((e) => e.id !== id))}
        onClear={() => setHistory([])}
        notify={notify}
      />

      <div className={`toast mono ${toast ? "is-on" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

/* экспорт парсера для отладки в консоли */
window.parseDelimitedPost = parseDelimitedPost;

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
