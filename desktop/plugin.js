// src/frontend/plugin.mjs
import { atom as atom2, useValue as useValue2, TITLEBAR_AREAS as TITLEBAR_AREAS2, PALETTE_AREA } from "@hermes/plugin-sdk";
import { jsx as jsx2 } from "react/jsx-runtime";

// src/frontend/cron-scope.mjs
var CRON_UI = new Map(Object.entries({
  "Morning briefing": "Утренний обзор",
  "Important mail monitor": "Проверка важных писем",
  "Weekly review": "Еженедельный обзор",
  "Weekday start reminder": "Напоминание о начале рабочего дня",
  "Custom reminder": "Своё напоминание",
  "Evening wind-down": "Вечернее подведение итогов",
  "Topic news digest": "Обзор новостей по теме",
  "Bills & renewals reminder": "Напоминание об оплате и продлении",
  "Price & availability watch": "Отслеживание цены и наличия",
  "Competitor news watch": "Новости конкурентов",
  "Habit check-in": "Проверка привычек",
  "Hydration & movement nudge": "Напоминание о воде и разминке",
  "Weekly meal plan": "План питания на неделю",
  "Daily learning drip": "Ежедневное обучение",
  "Gratitude & reflection prompt": "Благодарность и размышления",
  "On-this-day discovery": "Этот день в истории",
  "What time?": "Во сколько?",
  "Which day?": "В какой день?",
  "Where to deliver?": "Куда отправить результат?",
  "24h local time, e.g. 08:00": "Местное время в 24-часовом формате, например 08:00",
  "monday": "понедельник",
  "tuesday": "вторник",
  "wednesday": "среда",
  "thursday": "четверг",
  "friday": "пятница",
  "saturday": "суббота",
  "sunday": "воскресенье",
  "Monday": "Понедельник",
  "Tuesday": "Вторник",
  "Wednesday": "Среда",
  "Thursday": "Четверг",
  "Friday": "Пятница",
  "Saturday": "Суббота",
  "Sunday": "Воскресенье",
  "Start from": "Начать с",
  "New scheduled job": "Новая запланированная задача",
  "Schedule": "Запланировать",
  "Cancel": "Отмена",
  "This desktop": "Это приложение",
  "Bot Chat (default)": "Чат бота (по умолчанию)",
  "A weekly recap: what got done, what's still open, and what's coming up.": "Итоги недели: что сделано, что ещё осталось и что предстоит."
}));
var PRIVATE = 'input,textarea,select,option,pre,code,kbd,samp,script,style,svg,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-hermes-ru-translator]';
var EDITOR_CONTROL = "#cron-template,#cron-name,#cron-prompt";
var isAllowedSelect = (el) => el?.matches('[data-slot="select-trigger"]') && (el.id === "cron-template" || el.id.startsWith("blueprint-"));
function cronRoute(doc) {
  const win = doc.defaultView;
  return new URL(win.location.hash.slice(1) || win.location.pathname, "http://hermes.invalid").pathname === "/cron";
}
function editors(doc) {
  return [...doc.querySelectorAll('[role="dialog"]')].filter((root) => root.querySelector(EDITOR_CONTROL));
}
function selectScopes(doc, dialogs) {
  const scopes = /* @__PURE__ */ new Set();
  for (const dialog of dialogs) {
    for (const trigger of dialog.querySelectorAll('[data-slot="select-trigger"][aria-controls]')) {
      if (!isAllowedSelect(trigger)) continue;
      for (const id of trigger.getAttribute("aria-controls").split(/\s+/)) {
        const content = doc.getElementById(id);
        if (content?.matches('[data-slot="select-content"],[role="listbox"]')) scopes.add(content);
      }
    }
  }
  return scopes;
}
function collectCronRoots(doc) {
  if (!cronRoute(doc)) return /* @__PURE__ */ new Set();
  const dialogs = editors(doc);
  return /* @__PURE__ */ new Set([...doc.querySelectorAll('[data-panel-row^="blueprint-"]'), ...dialogs, ...selectScopes(doc, dialogs)]);
}
function isCronText(node, doc) {
  const el = node?.parentElement;
  if (!cronRoute(doc) || !node.isConnected || !el || el.closest(PRIVATE)) return false;
  const row = el.closest('[data-panel-row^="blueprint-"]');
  if (row) return Boolean(el.closest("span.font-medium"));
  const dialogs = editors(doc);
  const menu = el.closest('[data-slot="select-content"],[role="listbox"]');
  if (menu) return selectScopes(doc, dialogs).has(menu) && Boolean(el.closest('[data-slot="select-item"],[role="option"]'));
  const dialog = el.closest('[role="dialog"]');
  if (!dialogs.includes(dialog)) return false;
  const trigger = el.closest('[data-slot="select-trigger"]');
  if (trigger) return isAllowedSelect(trigger) && Boolean(el.closest('[data-slot="select-value"]'));
  return Boolean(el.closest('label,p,h1,h2,h3,h4,button:not([role="combobox"])'));
}

// src/frontend/adapter.mjs
var ROOTS = '[data-catalog="plugins"], [data-catalog-detail="plugins"], [data-catalog="skills"], [data-catalog-detail="skills"]';
var PUBLIC_DESCRIPTIONS = '.catalog-card-description, [data-catalog-detail] > p, [data-catalog-list] [data-entry-id] > span > .line-clamp-2, [data-testid^="plugin-row-"] > [role="cell"] > div > .mt-0\\.5.break-words';
var CACHE_KEY = "public-catalog-ru-argos-v1";
var CACHE_ENGINE = "argos-en-ru-v1";
var FIXED_UI = new Map(Object.entries({
  "Install": "Установить",
  "Install from Git": "Установить из Git",
  "Tier": "Уровень доверия",
  "Category": "Категория",
  "All": "Все",
  "Automation": "Автоматизация",
  "Desktop": "Рабочий стол",
  "General": "Общее",
  "Official": "Официальные",
  "Bundled": "Встроенные",
  "Verified": "Проверенные",
  "Verified Plugins": "Проверенные плагины",
  "Official Plugins": "Официальные плагины",
  "Community Plugins": "Плагины сообщества",
  "Bundled Plugins": "Встроенные плагины",
  "See all": "Показать все",
  "More": "Ещё",
  "Repository": "Репозиторий",
  "Documentation": "Документация",
  "Screenshots": "Снимки экрана",
  "Tools": "Инструменты",
  "Hooks": "Хуки",
  "Requires": "Требуется",
  "Platforms": "Платформы",
  "Related": "Похожие",
  "Retry": "Повторить",
  "Discover": "Обзор",
  "Discover Skills": "Обзор навыков",
  "Skills": "Навыки",
  "Discover Навыки": "Обзор навыков",
  "Discover Плагины": "Обзор плагинов",
  "Source": "Источник",
  "Filters": "Фильтры",
  "Clear filters": "Сбросить фильтры"
}));
var TEXT_AREAS = [
  ".catalog-card-description",
  "[data-catalog-list] [data-entry-id] > span > .line-clamp-2",
  "[data-catalog-detail] > p",
  "[data-catalog-detail] h4",
  "[data-catalog-detail] dt",
  '[data-testid^="plugin-row-"] > [role="cell"] > div > .mt-0\\.5.break-words',
  "[data-catalog-header] button",
  "[data-catalog-filters] button",
  "[data-catalog] h1",
  "[data-catalog] h2",
  "[data-catalog] h4",
  "[data-catalog] .catalog-section-heading",
  '[data-catalog-card] [data-slot="badge"]',
  '[data-catalog-card] button:not([aria-haspopup="dialog"])',
  "[data-catalog-detail] > header button",
  "[data-catalog-detail] > header a",
  '[data-catalog="skills"] .catalog-card-title',
  '[data-catalog-detail="skills"] > header h2',
  '[data-catalog-detail="skills"] > header h3',
  '[data-catalog-list="skills"] [data-entry-id] > span > span:first-child > span:first-child',
  '[data-catalog="skills"] [data-catalog-metadata] > span:first-child > span:first-child',
  '[data-catalog-detail="skills"] [data-catalog-metadata] > span:first-child > span:first-child'
].join(", ");
var PRIVATE2 = [
  "input",
  "textarea",
  "select",
  "option",
  '[role="combobox"]',
  '[role="listbox"]',
  '[contenteditable]:not([contenteditable="false"])',
  "form",
  "script",
  "style",
  "code",
  "pre",
  "kbd",
  "samp",
  "svg",
  "iframe",
  "[hidden]",
  '[aria-hidden="true"]',
  ".font-mono",
  "[data-env]",
  "[data-catalog-commands]",
  '[data-testid$="settings-form"]',
  '[data-testid^="plugin-folder-access-"]',
  '[data-testid^="plugin-page-access-"]',
  "[data-hermes-ru-translator]"
].join(", ");
function routeKind(win) {
  const hash = win.location.hash.slice(1);
  const url = new URL(hash || win.location.pathname + win.location.search, "http://hermes.invalid");
  if (url.pathname === "/cron") return "cron";
  if (url.pathname !== "/capabilities") return null;
  const tab = url.searchParams.get("tab") || "skills";
  return tab === "plugins" || tab === "skills" ? tab : null;
}
function safeSource(source) {
  if (!/[a-z]{2}/i.test(source) || source.length > 24e3 || !source.trim()) return false;
  if ((source.match(/[а-яё]/gi)?.length || 0) > (source.match(/[a-z]/gi)?.length || 0)) return false;
  if (/^\s*(?:https?:\/\/\S+|www\.\S+|[a-z]:\\\S+|[~/][\w./-]+|[\w.-]+\/[\w.-]+)\s*$/i.test(source)) return false;
  if (/^[\w.-]+$/.test(source.trim()) && /[_./-]/.test(source)) return false;
  return true;
}
function validTranslation(source, value) {
  return typeof value === "string" && Boolean(value.trim()) && value.isWellFormed() && value.split("�").length <= source.split("�").length;
}
function createPluginsTranslator({ document: doc, rest, onState = () => {
}, cacheStorage = null, cacheKey = CACHE_KEY, cacheEngine = CACHE_ENGINE, engineLoaded = true }) {
  const win = doc.defaultView;
  const ownership = /* @__PURE__ */ new WeakMap();
  const owned = /* @__PURE__ */ new Set();
  const queue = /* @__PURE__ */ new Set();
  const scopes = /* @__PURE__ */ new Map();
  let tooltipRoots = /* @__PURE__ */ new Set();
  let categoryRoots = /* @__PURE__ */ new Set();
  let modalDetails = /* @__PURE__ */ new Set();
  let cronDialogs = /* @__PURE__ */ new Set();
  const completed = /* @__PURE__ */ new Map();
  const durable = /* @__PURE__ */ new Map();
  let durableChars = 0;
  let durableWritable = true;
  const persistDurable = () => {
    if (cacheStorage && durableWritable) {
      try {
        cacheStorage.set(cacheKey, { version: 1, engine: cacheEngine, entries: [...durable] });
      } catch {
        durableWritable = false;
      }
    }
  };
  const keepDurable = (source, value, write) => {
    if (!validTranslation(source, value)) return;
    if (durable.has(source)) {
      durableChars -= source.length + durable.get(source).length;
      durable.delete(source);
    }
    durable.set(source, value);
    durableChars += source.length + value.length;
    while (durable.size > 1e3 || durableChars > 2e6) {
      const [key, text] = durable.entries().next().value;
      durable.delete(key);
      durableChars -= key.length + text.length;
    }
    if (write) persistDurable();
  };
  let cachedChars = 0;
  const remember = (source, value, persistable = false) => {
    if (!validTranslation(source, value)) return;
    if (completed.has(source)) {
      cachedChars -= source.length + completed.get(source).length;
      completed.delete(source);
    }
    completed.set(source, value);
    cachedChars += source.length + value.length;
    while (completed.size > 1e3 || cachedChars > 2e6) {
      const [key, text] = completed.entries().next().value;
      completed.delete(key);
      cachedChars -= key.length + text.length;
    }
    if (persistable) keepDurable(source, value, true);
  };
  try {
    const saved = cacheStorage?.get(cacheKey, null);
    if (saved?.version === 1 && saved.engine === cacheEngine && Array.isArray(saved.entries)) {
      let rejected = false;
      for (const entry of saved.entries.slice(-1e3)) {
        if (!Array.isArray(entry) || entry.length !== 2) {
          rejected = true;
          continue;
        }
        const [source, value] = entry;
        if (typeof source !== "string" || !safeSource(source) || !validTranslation(source, value) || value.length > 48e3) {
          rejected = true;
          continue;
        }
        remember(source, value);
        keepDurable(source, value, false);
      }
      if (rejected) persistDurable();
    }
  } catch {
  }
  let enabled = false;
  let disposed = false;
  let epoch = 0;
  let inFlight = false;
  let scheduled = false;
  let error = "";
  let translated = 0;
  let routeActive = null;
  let pendingCount = 0;
  let loaded = Boolean(engineLoaded);
  const publish = () => onState({ enabled, active: Boolean(routeActive), scope: routeActive, paused: !loaded, busy: inFlight || queue.size > 0, pending: queue.size + pendingCount, translated, error });
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth)) return false;
    const clipSelectors = '[data-catalog-scroll], .capabilities-scroll, [data-catalog-expanded-filters], [data-slot="popover-content"], [data-slot="select-content"]';
    for (let clip = el.parentElement?.closest(clipSelectors); clip; clip = clip.parentElement?.closest(clipSelectors)) {
      const box = clip.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right)) return false;
    }
    return true;
  };
  const eligible = (node) => {
    const el = node.parentElement;
    if (!routeActive || !node.isConnected || !el) return false;
    if (!visible(el)) return false;
    if (routeActive === "cron") {
      if (cronDialogs.size && !el.closest('[role="dialog"], [data-slot="select-content"], [role="listbox"]')) return false;
      return isCronText(node, doc);
    }
    if (el.closest(PRIVATE2)) return false;
    const tooltip = el.closest('[data-slot="tooltip-content"]');
    if (tooltipRoots.has(tooltip)) return Boolean(el.closest('[data-slot="tooltip-label"]'));
    const category = el.closest('[data-slot="popover-content"]');
    if (categoryRoots.has(category)) return Boolean(el.closest("button, [data-catalog-expanded-filters] > div > span"));
    if (!el.closest(ROOTS)) return false;
    const catalog = el.closest("[data-catalog], [data-catalog-detail]");
    if (!catalog || (catalog.getAttribute("data-catalog") ?? catalog.getAttribute("data-catalog-detail")) !== routeActive) return false;
    if (modalDetails.size && !modalDetails.has(catalog)) return false;
    if (el.closest(".catalog-card-title") && routeActive !== "skills") return false;
    if (el.closest("[data-catalog-metadata]") && !(routeActive === "skills" && el.closest("[data-catalog-metadata] > span:first-child > span:first-child"))) return false;
    const skillTitle = el.closest('.catalog-card-title, [data-catalog-detail="skills"] > header h2, [data-catalog-detail="skills"] > header h3');
    if (skillTitle && !/\s/.test(node.data.trim())) return false;
    return Boolean(el.closest(TEXT_AREAS));
  };
  const restore = () => {
    for (const node of owned) {
      const record = ownership.get(node);
      if (record?.lastApplied !== null && node.data === record.lastApplied) node.data = record.source;
      ownership.delete(node);
    }
    owned.clear();
    queue.clear();
  };
  const cancel = () => {
    epoch++;
    queue.clear();
    restore();
  };
  const track = (node) => {
    if (!eligible(node)) return;
    let record = ownership.get(node);
    if (record && node.data === record.lastApplied) return;
    if (record && node.data === record.source && record.pending) return;
    if (!safeSource(node.data)) return;
    if (!record || record.source !== node.data) {
      record = { source: node.data, lastApplied: null, pending: false };
      ownership.set(node, record);
      owned.add(node);
    }
    if (completed.has(record.source)) {
      const value = completed.get(record.source);
      if (validTranslation(record.source, value)) {
        remember(record.source, value);
        record.lastApplied = value;
        node.data = value;
        queue.delete(node);
        return;
      }
      cachedChars -= record.source.length + value.length;
      completed.delete(record.source);
      if (durable.has(record.source)) {
        durableChars -= record.source.length + durable.get(record.source).length;
        durable.delete(record.source);
        persistDurable();
      }
    }
    const fixed = (routeActive === "cron" ? CRON_UI : FIXED_UI).get(node.data.trim());
    if (fixed && !node.parentElement.closest('.catalog-card-description, [data-catalog-detail] > p, [data-catalog-list] [data-entry-id] > span > .line-clamp-2, [data-testid^="plugin-row-"]')) {
      record.lastApplied = node.data.replace(node.data.trim(), fixed);
      node.data = record.lastApplied;
      return;
    }
    if (!error && (loaded || !record.cacheMiss)) queue.add(node);
  };
  const scan = (root) => {
    const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) track(node);
  };
  const sync = () => {
    scheduled = false;
    if (disposed || !enabled) return;
    const nextActive = routeKind(win);
    if (nextActive !== routeActive) {
      cancel();
      routeActive = nextActive;
    }
    const currentRoots = routeActive === "cron" ? collectCronRoots(doc) : new Set(routeActive === "skills" || routeActive === "plugins" ? doc.querySelectorAll(`[data-catalog="${routeActive}"], [data-catalog-detail="${routeActive}"]`) : []);
    cronDialogs = new Set(routeActive === "cron" ? [...currentRoots].filter((root) => root.matches('[role="dialog"]') && visible(root)) : []);
    modalDetails = new Set([...currentRoots].filter((root) => root.hasAttribute("data-catalog-detail") && root.closest('[role="dialog"]') && visible(root)));
    tooltipRoots = /* @__PURE__ */ new Set();
    categoryRoots = /* @__PURE__ */ new Set();
    for (const root of currentRoots) {
      for (const trigger of root.querySelectorAll("[aria-describedby]")) {
        if (trigger.closest(PRIVATE2)) continue;
        for (const id of trigger.getAttribute("aria-describedby").split(/\s+/)) {
          const content = doc.getElementById(id)?.closest('[data-slot="tooltip-content"]');
          if (content) tooltipRoots.add(content);
        }
      }
      for (const trigger of root.querySelectorAll("[data-catalog-filters] [aria-controls]")) {
        for (const id of trigger.getAttribute("aria-controls").split(/\s+/)) {
          const content = doc.getElementById(id);
          if (content?.matches('[data-slot="popover-content"]')) categoryRoots.add(content);
        }
      }
    }
    for (const root of tooltipRoots) currentRoots.add(root);
    for (const root of categoryRoots) currentRoots.add(root);
    for (const [root, observer] of scopes) {
      if (!currentRoots.has(root)) {
        observer.disconnect();
        scopes.delete(root);
      }
    }
    for (const node of owned) {
      if (!eligible(node)) {
        const record = ownership.get(node);
        if (record?.lastApplied !== null && node.data === record.lastApplied) node.data = record.source;
        owned.delete(node);
        ownership.delete(node);
        queue.delete(node);
      }
    }
    {
      for (const root of currentRoots) {
        if (!scopes.has(root)) {
          const observer = new win.MutationObserver(schedule);
          observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-hidden", "data-catalog", "data-catalog-detail", "contenteditable", "aria-describedby", "aria-controls"] });
          scopes.set(root, observer);
        }
        scan(root);
      }
      void pump();
    }
    publish();
  };
  function schedule() {
    if (!scheduled && enabled && !disposed) {
      scheduled = true;
      win.queueMicrotask(sync);
    }
  }
  async function pump() {
    if (inFlight || !enabled || disposed || !routeActive || error) return;
    const cacheOnly = !loaded;
    const items = [];
    const texts = [];
    let size = 0;
    const priority = (node) => {
      const el = node.parentElement;
      if (!el) return 3;
      if (el.closest("[data-catalog-detail]") || categoryRoots.has(el.closest('[data-slot="popover-content"]')) || routeActive === "cron" && el.closest('[role="dialog"], [data-slot="select-content"]')) return 0;
      const rect = el.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= win.innerHeight && rect.right >= 0 && rect.left <= win.innerWidth ? 1 : 2;
    };
    const ordered = [...queue].map((node) => ({ node, priority: priority(node) })).sort((a, b) => a.priority - b.priority);
    for (const { node } of ordered) {
      const record = ownership.get(node);
      if (!eligible(node) || !record || node.data !== record.source) {
        queue.delete(node);
        continue;
      }
      let index = texts.indexOf(record.source);
      if (index < 0) {
        if (texts.length >= (cacheOnly ? 8 : 1) || size + record.source.length > 24e3) break;
        index = texts.length;
        texts.push(record.source);
        size += record.source.length;
      }
      record.pending = true;
      items.push({ node, record, index, persistable: routeActive !== "cron" && Boolean(node.parentElement.closest(PUBLIC_DESCRIPTIONS)) });
      queue.delete(node);
    }
    if (!items.length) return;
    const requestEpoch = epoch;
    inFlight = true;
    pendingCount = items.length;
    publish();
    try {
      const result = await rest(cacheOnly ? "/cache/lookup" : "/translate", { method: "POST", body: { texts, engine: "local", lang: "ru" }, timeoutMs: cacheOnly ? 5e3 : 18e4 });
      if (disposed || requestEpoch !== epoch || !enabled || routeKind(win) !== routeActive) return;
      if (!result || !Array.isArray(result.texts) || result.texts.length !== texts.length || cacheOnly && result.cache_epoch !== cacheEngine || result.cache_epoch !== void 0 && result.cache_epoch !== cacheEngine || result.texts.some((text, index) => !(cacheOnly && text === null) && !validTranslation(texts[index], text))) throw new Error("Invalid local translation response");
      for (let index = 0; index < texts.length; index++) {
        if (result.texts[index] !== null) remember(texts[index], result.texts[index], items.some((item) => item.index === index && item.persistable));
      }
      if (requestEpoch !== epoch || !enabled || routeKind(win) !== routeActive) return;
      for (const { node, record, index } of items) {
        if (result.texts[index] === null) {
          record.cacheMiss = true;
          continue;
        }
        if (ownership.get(node) !== record || !eligible(node) || node.data !== record.source) continue;
        const value = result.texts[index];
        record.lastApplied = value;
        node.data = value;
        translated++;
      }
    } catch (_cause) {
      if (requestEpoch === epoch && enabled && !disposed && routeKind(win) === routeActive) {
        error = "Перевод недоступен. Нажмите, чтобы выключить; включите для повтора.";
        queue.clear();
      }
    } finally {
      for (const { record } of items) record.pending = false;
      inFlight = false;
      pendingCount = 0;
      if (!disposed) {
        publish();
        schedule();
      }
    }
  }
  const discovery = new win.MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1))) schedule();
  });
  const routeChanged = () => {
    if (enabled) sync();
  };
  const stopObservers = () => {
    discovery.disconnect();
    for (const observer of scopes.values()) observer.disconnect();
    scopes.clear();
    win.removeEventListener("hashchange", routeChanged);
    win.removeEventListener("popstate", routeChanged);
    doc.removeEventListener("scroll", schedule, true);
  };
  return {
    setEngineLoaded(value) {
      if (disposed) return;
      const next = Boolean(value);
      if (loaded !== next) {
        epoch++;
        queue.clear();
      }
      loaded = next;
      if (loaded) error = "";
      publish();
      schedule();
    },
    setEnabled(value) {
      if (disposed || enabled === Boolean(value)) return;
      enabled = Boolean(value);
      error = "";
      if (enabled) {
        discovery.observe(doc.body, { childList: true, subtree: true });
        win.addEventListener("hashchange", routeChanged);
        win.addEventListener("popstate", routeChanged);
        doc.addEventListener("scroll", schedule, { capture: true, passive: true });
        sync();
      } else {
        stopObservers();
        cancel();
        routeActive = null;
        publish();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      stopObservers();
      cancel();
    }
  };
}

// src/browser/register.mjs
import { atom, useValue, TITLEBAR_AREAS } from "@hermes/plugin-sdk";
import { jsx } from "react/jsx-runtime";

// src/browser/guest.mjs
function guestCommand(command) {
  const key = "__hermesRuPageTranslationV1";
  const href = window.location.href;
  let state = window[key];
  const excluded = 'script,style,noscript,template,code,pre,kbd,samp,input,textarea,select,option,form,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"],svg,canvas,iframe,[data-hermes-ru-page-control]';
  const visibility = /* @__PURE__ */ new WeakMap();
  const visibleElement = (element) => {
    if (!element) return true;
    if (visibility.has(element)) return visibility.get(element);
    const style = getComputedStyle(element);
    const visible = style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && visibleElement(element.parentElement);
    visibility.set(element, visible);
    return visible;
  };
  const eligibleSource = (node, source) => {
    const parent = node.parentElement;
    if (!node.isConnected || !parent || parent.closest(excluded) || !visibleElement(parent)) return false;
    const trimmed = source.trim();
    if (!/[a-zA-Z]{2}/.test(trimmed) || /^(?:https?:\/\/|mailto:|file:|\/)/i.test(trimmed)) return false;
    if (!/\s/.test(trimmed) && /[_/@\\]|\.[a-z0-9]{1,5}$/i.test(trimmed)) return false;
    const link = parent.closest("a[href]");
    return !link || trimmed !== link.getAttribute("href");
  };
  const stop = () => {
    if (!state) return;
    for (const item of state.entries.values()) {
      if (item.last !== null && item.node.data === item.last && eligibleSource(item.node, item.source))
        item.node.data = item.source;
    }
    delete window[key];
  };
  if (command.action === "status") return { token: state?.token || null, href };
  if (command.action === "start") {
    if (state?.timer) clearInterval(state.timer);
    if (state?.stop) window.removeEventListener("pagehide", state.stop);
    state = state || { entries: /* @__PURE__ */ new Map(), nodes: /* @__PURE__ */ new WeakMap(), next: 1 };
    state.token = command.token;
    state.href = href;
    window[key] = state;
    return { token: state.token, href };
  }
  if (!state || state.token !== command.token || state.href !== href || command.href !== href) return { stale: true };
  if (command.action === "stop") {
    stop();
    return { stopped: true };
  }
  if (command.action === "ping") return { alive: true };
  if (command.action === "collect") {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const items = [];
    let chars = 0;
    let node;
    while ((node = walker.nextNode()) && items.length < 36 && chars < 7500) {
      const text = node.data;
      if (!eligibleSource(node, text)) continue;
      let item = state.nodes.get(node);
      if (!item || node.data !== item.source && node.data !== item.last) {
        if (item) state.entries.delete(item.id);
        item = { id: state.next++, node, source: text, last: null };
        state.nodes.set(node, item);
        state.entries.set(item.id, item);
      }
      if (item.last !== null && node.data === item.last) continue;
      items.push({ id: item.id, text: item.source });
      chars += text.length;
    }
    for (const [id, item] of state.entries) if (!item.node.isConnected) state.entries.delete(id);
    return { token: state.token, href, items };
  }
  if (command.action === "apply") {
    let applied = 0;
    for (const translated of command.items || []) {
      const item = state.entries.get(translated.id);
      if (!item || !eligibleSource(item.node, item.source) || item.source !== translated.text || item.node.data !== item.source || typeof translated.out !== "string" || !translated.out.trim())
        continue;
      const leading = item.source.match(/^\s*/)[0];
      const trailing = item.source.match(/\s*$/)[0];
      item.last = leading + translated.out.trim() + trailing;
      item.node.data = item.last;
      applied++;
    }
    return { applied };
  }
  return { error: "Unknown page-translation command" };
}
var guestScript = (command) => `(${guestCommand.toString()})(${JSON.stringify(command)})`;

// src/browser/controller.mjs
function createBrowserTranslator(ctx, { onState = () => {
} } = {}) {
  let binding = null;
  let generation = 0;
  let disposed = false;
  let starting = false;
  let translated = 0;
  const status = (patch) => onState({ active: Boolean(binding), translated, ...patch });
  const execute = (command) => ctx.preview.executeJavaScript(guestScript(command));
  const current = (expected, epoch) => !disposed && binding === expected && generation === epoch;
  const release = () => {
    binding = null;
    starting = false;
    generation++;
  };
  async function stop() {
    const old = binding;
    release();
    if (old) {
      try {
        await execute({ ...old, action: "stop" });
      } catch {
      }
    }
    status({ busy: false, error: "" });
  }
  async function scan(expected, epoch) {
    if (!current(expected, epoch)) return;
    try {
      while (current(expected, epoch)) {
        const batch = await execute({ ...expected, action: "collect" });
        if (!current(expected, epoch)) return;
        if (batch?.stale) {
          release();
          status({ busy: false });
          return;
        }
        if (!Array.isArray(batch?.items)) throw new Error("Не удалось прочитать текст страницы");
        if (!batch.items.length) {
          status({ busy: false, pending: 0, error: "" });
          return;
        }
        for (let index = 0; index < batch.items.length; index++) {
          if (!current(expected, epoch)) return;
          const item = batch.items[index];
          status({ busy: true, pending: batch.items.length - index, error: "" });
          let remaining = item.text;
          let out = "";
          while (remaining.length) {
            let length = Math.min(12e3, remaining.length);
            if (length < remaining.length) {
              const boundary = remaining.lastIndexOf(" ", length);
              if (boundary > 6e3) length = boundary + 1;
            }
            const chunk = remaining.slice(0, length);
            remaining = remaining.slice(length);
            const result = await ctx.rest("/translate", {
              method: "POST",
              body: { texts: [chunk], lang: "ru", engine: "local" },
              timeoutMs: 18e4
            });
            if (!current(expected, epoch)) return;
            if (!Array.isArray(result?.texts) || typeof result.texts[0] !== "string" || !result.texts[0].trim())
              throw new Error("Некорректный ответ локального переводчика");
            out += chunk.match(/^\s*/)[0] + result.texts[0].trim() + chunk.match(/\s*$/)[0];
          }
          const applied = await execute({ ...expected, action: "apply", items: [{ ...item, out }] });
          if (!current(expected, epoch)) return;
          if (applied?.stale) {
            release();
            status({ busy: false });
            return;
          }
          translated += applied?.applied || 0;
        }
      }
    } catch (error) {
      if (!current(expected, epoch)) return;
      status({ busy: false, error: error?.message || String(error) });
    }
  }
  async function start() {
    if (disposed || binding || starting) return;
    if (!ctx.preview?.executeJavaScript || !ctx.preview?.isAvailable()) {
      status({ error: "Откройте страницу во встроенном браузере" });
      return;
    }
    const epoch = ++generation;
    starting = true;
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    status({ busy: true, error: "" });
    try {
      const result = await execute({ action: "start", token });
      if (disposed || generation !== epoch) return;
      if (result?.token !== token || typeof result.href !== "string") throw new Error("Не удалось привязать страницу");
      const expected = binding = { token, href: result.href };
      starting = false;
      translated = 0;
      status({ busy: true, href: result.href, error: "" });
      await scan(expected, epoch);
    } catch (error) {
      if (!disposed && generation === epoch) {
        starting = false;
        status({ busy: false, error: error?.message || String(error) });
      }
    }
  }
  return {
    start,
    stop,
    toggle: async () => {
      try {
        if (starting) return stop();
        if (binding) {
          const page = await execute({ action: "status" });
          if (page?.token === binding.token && page?.href === binding.href) return stop();
          release();
        }
        return start();
      } catch (error) {
        release();
        status({ busy: false, error: error?.message || String(error) });
      }
    },
    dispose: async () => {
      release();
      disposed = true;
    },
    getState: () => ({ active: Boolean(binding), translated })
  };
}

// src/browser/register.mjs
var BROWSER_TRANSLATION_CAPABILITY = "preview.executeJavaScript";
function registerBrowserTranslation(ctx, options = {}) {
  const state = atom({
    available: Boolean(ctx.preview?.isAvailable?.()),
    active: false,
    busy: false,
    translated: 0,
    error: "",
    href: ""
  });
  const patch = (next) => state.set({ ...state.get(), ...next });
  const translator = createBrowserTranslator(ctx, {
    ...options,
    onState: (next) => {
      patch(next);
      options.onState?.(next);
    }
  });
  const refreshAvailability = () => {
    const available = Boolean(ctx.preview?.isAvailable?.());
    if (available !== state.get().available) patch({ available });
  };
  const stopAvailability = ctx.setInterval(refreshAvailability, 800);
  function BrowserTranslationButton() {
    const current = useValue(state);
    if (!current.available) return null;
    let host = "";
    try {
      host = current.href ? new URL(current.href).hostname : "";
    } catch {
    }
    const label = current.error ? "Перевод сайта: ошибка" : current.busy ? `Перевод сайта: ${current.translated}…` : current.active ? "Оригинал сайта" : "Перевести сайт";
    return jsx("button", {
      type: "button",
      "data-hermes-ru-browser-translation": true,
      "aria-label": label,
      "aria-pressed": current.active,
      title: current.error || `Перевод текста активной страницы встроенного браузера на месте${host ? ` · ${host}` : ""}. Локальный переводчик. Оригинал возвращается этой же кнопкой.`,
      className: "inline-flex h-7 shrink-0 items-center rounded px-2 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)",
      style: { WebkitAppRegion: "no-drag" },
      onClick: () => void translator.toggle(),
      children: label
    });
  }
  const unregister = ctx.register({
    id: "browser-translation-button",
    area: TITLEBAR_AREAS.right,
    order: 60,
    render: () => jsx(BrowserTranslationButton, {})
  });
  const dispose = () => {
    stopAvailability();
    unregister();
    void translator.dispose();
  };
  ctx.onDispose(dispose);
  return { ...translator, dispose };
}

// src/frontend/plugin.mjs
var LEGACY_PROFILE = { id: "q8", label: "HY-MT Q8", device: "gpu", role: "Точный перевод" };
var plugin_default = {
  id: "hermes-ru-translator",
  name: "Hermes Russian Translate",
  capabilities: [BROWSER_TRANSLATION_CAPABILITY],
  register(ctx) {
    const state = atom2({ enabled: true, active: false, busy: false, translated: 0, error: "", loaded: false, paused: true, engineBusy: "checking", engineError: "", profiles: [LEGACY_PROFILE], selected: "q8", variant: "q8", device: "gpu" });
    const patch = (next) => state.set({ ...state.get(), ...next });
    let translator = null;
    let activeEpoch = "";
    let disposed = false;
    let wanted = true;
    let desiredInitialized = false;
    const applyStatus = (status) => {
      if (disposed) return;
      if (!status || typeof status.loaded !== "boolean" || typeof status.cache_epoch !== "string" || !status.cache_epoch) throw new Error("Invalid translator status");
      const offered = Array.isArray(status.profiles) ? status.profiles : [LEGACY_PROFILE];
      const enabledIds = Array.isArray(status.enabled_variants) ? new Set(status.enabled_variants) : null;
      const profiles = offered.filter((profile) => profile && typeof profile.id === "string" && typeof profile.label === "string" && (!enabledIds || enabledIds.has(profile.id)));
      const variant = typeof status.variant === "string" ? status.variant : "q8";
      let selected = desiredInitialized ? state.get().selected : variant;
      if (!profiles.some((profile) => profile.id === selected)) selected = profiles[0]?.id || "";
      desiredInitialized = true;
      patch({ loaded: status.loaded, variant, selected, profiles, device: status.device || "gpu", model: status.model_label || status.model || "HY-MT2 Q8", engineError: "" });
      if (!translator || activeEpoch !== status.cache_epoch) {
        translator?.dispose();
        activeEpoch = status.cache_epoch;
        translator = createPluginsTranslator({
          document,
          cacheStorage: ctx.storage,
          cacheEngine: activeEpoch,
          cacheKey: `public-catalog-ru-${activeEpoch}`,
          engineLoaded: status.loaded,
          rest: (path, options) => ctx.rest(path, options),
          onState: patch
        });
        translator.setEnabled(wanted);
      } else translator.setEngineLoaded(status.loaded);
    };
    const toggle = () => {
      wanted = !wanted;
      patch({ enabled: wanted });
      translator?.setEnabled(wanted);
    };
    const changeEngine = async () => {
      const current = state.get();
      if (disposed || current.engineBusy || !current.profiles.some((profile) => profile.id === current.selected)) return;
      const loading = !current.loaded || current.variant !== current.selected;
      const switching = current.loaded && loading;
      patch({ engineBusy: switching ? "switching" : loading ? "loading" : "unloading", engineError: "" });
      translator?.setEngineLoaded(false);
      try {
        const status = await ctx.rest(loading ? "/engine/start" : "/engine/stop", {
          method: "POST",
          ...loading ? { body: { variant: current.selected } } : {},
          timeoutMs: 18e4
        });
        if (!disposed) applyStatus(status);
      } catch {
        if (!disposed) {
          translator?.setEngineLoaded(false);
          patch({ engineError: loading ? "Не удалось загрузить переводчик. Повторите загрузку." : "Не удалось подтвердить выгрузку переводчика." });
        }
      } finally {
        if (!disposed) patch({ engineBusy: "" });
      }
    };
    function Controls() {
      const current = useValue2(state);
      const device = String(current.device).toUpperCase();
      const selectedProfile = current.profiles.find((profile) => profile.id === current.selected);
      const selectedLabel = selectedProfile?.label || "Переводчик";
      const matching = current.loaded && current.variant === current.selected;
      const label = !current.enabled ? "Перевод: выкл." : current.error ? "Перевод: ошибка" : current.paused ? `Перевод: пауза · ${device}` : !current.active ? `Перевод: готов · ${device}` : current.busy ? `Перевод: ${current.pending}… · ${device}` : `Перевод: русский · ${device}`;
      const engineLabel = current.engineBusy === "checking" ? "Проверяю модель…" : current.engineBusy === "loading" ? `${selectedLabel}: загружаю…` : current.engineBusy === "switching" ? `${selectedLabel}: переключаю…` : current.engineBusy === "unloading" ? `${selectedLabel}: выгружаю…` : matching ? `${selectedLabel}: выгрузить` : current.loaded ? `${selectedLabel}: переключить` : `${selectedLabel}: загрузить`;
      const className = "inline-flex h-7 shrink-0 items-center rounded px-2 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)";
      return jsx2("div", {
        "data-hermes-ru-translator": true,
        className: "inline-flex items-center gap-1",
        style: { WebkitAppRegion: "no-drag" },
        children: [
          jsx2("button", {
            type: "button",
            "aria-pressed": current.enabled,
            "aria-label": `${label}. ${current.enabled ? "Выключить" : "Включить"} перевод плагинов, навыков и задач по расписанию`,
            title: current.error || "Перевод плагинов, навыков и задач. Инструменты и чат не переводятся. Готовые переводы доступны и после выгрузки модели.",
            className,
            onClick: toggle,
            children: label
          }, "translation"),
          jsx2("select", {
            "aria-label": "Модель переводчика",
            value: current.selected,
            disabled: Boolean(current.engineBusy) || !current.profiles.length,
            title: `${selectedProfile?.role || "Выбор модели"}; выбор не запускает модель. Сейчас: ${current.model || "не загружена"} · ${device}`,
            className: "h-7 max-w-44 rounded px-1 text-[0.6875rem] text-(--ui-text-secondary)",
            onChange: (event) => patch({ selected: event.target.value }),
            children: current.profiles.map((profile) => jsx2("option", { value: profile.id, children: `${profile.label} · ${String(profile.device || "gpu").toUpperCase()}` }, profile.id))
          }, "profile"),
          jsx2("button", {
            type: "button",
            "data-hermes-ru-engine": true,
            disabled: Boolean(current.engineBusy) || !selectedProfile,
            "aria-label": engineLabel,
            title: current.engineError || `Только локальная модель переводчика. Сейчас: ${current.model || "не загружена"} · ${device}. Основная модель чата не меняется.`,
            className,
            onClick: changeEngine,
            children: current.engineError ? `${engineLabel} · ошибка` : engineLabel
          }, "engine")
        ]
      });
    }
    ctx.register({ id: "toggle", area: TITLEBAR_AREAS2.right, order: 130, render: () => jsx2(Controls, {}) });
    ctx.register({
      id: "toggle-command",
      area: PALETTE_AREA,
      data: {
        id: "hermes-ru-translator.toggle",
        label: "Включить / выключить русский перевод плагинов, навыков и задач",
        keywords: ["plugins", "skills", "cron", "translate", "перевод", "русский", "плагины", "навыки", "задачи"],
        detail: () => state.get().enabled ? "включено" : "выключено",
        detailVariant: "state",
        run: toggle
      }
    });
    if (typeof ctx.preview?.executeJavaScript === "function" && typeof ctx.preview?.isAvailable === "function") registerBrowserTranslation(ctx);
    ctx.onDispose(() => {
      disposed = true;
      translator?.dispose();
    });
    void ctx.rest("/status", { method: "GET", timeoutMs: 15e3 }).then((status) => {
      if (!disposed) {
        applyStatus(status);
        patch({ engineBusy: "" });
      }
    }).catch(() => {
      if (!disposed) patch({ engineBusy: "", engineError: "Не удалось проверить локальный переводчик. Нажмите загрузку для повтора." });
    });
  }
};
export {
  plugin_default as default
};
