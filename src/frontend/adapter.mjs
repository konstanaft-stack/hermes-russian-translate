/** LOCAL trusted adapter for Hermes Desktop 3b421578. Not a public catalog SDK. */
import { CRON_UI, collectCronRoots, isCronText } from './cron-scope.mjs'

const ROOTS = '[data-catalog="plugins"], [data-catalog-detail="plugins"], [data-catalog="skills"], [data-catalog-detail="skills"]'
const PUBLIC_DESCRIPTIONS = '.catalog-card-description, [data-catalog-detail] > p, [data-catalog-list] [data-entry-id] > span > .line-clamp-2, [data-testid^="plugin-row-"] > [role="cell"] > div > .mt-0\\.5.break-words'
const CACHE_KEY = 'public-catalog-ru-argos-v1'
const CACHE_ENGINE = 'argos-en-ru-v1'
const FIXED_UI = new Map(Object.entries({
  'Install': 'Установить', 'Install from Git': 'Установить из Git',
  'Tier': 'Уровень доверия', 'Category': 'Категория', 'All': 'Все',
  'Automation': 'Автоматизация', 'Desktop': 'Рабочий стол', 'General': 'Общее',
  'Official': 'Официальные', 'Bundled': 'Встроенные', 'Verified': 'Проверенные',
  'Verified Plugins': 'Проверенные плагины', 'Official Plugins': 'Официальные плагины',
  'Community Plugins': 'Плагины сообщества', 'Bundled Plugins': 'Встроенные плагины',
  'See all': 'Показать все', 'More': 'Ещё', 'Repository': 'Репозиторий',
  'Documentation': 'Документация', 'Screenshots': 'Снимки экрана',
  'Tools': 'Инструменты', 'Hooks': 'Хуки', 'Requires': 'Требуется',
  'Platforms': 'Платформы', 'Related': 'Похожие', 'Retry': 'Повторить',
  'Discover': 'Обзор', 'Discover Skills': 'Обзор навыков', 'Skills': 'Навыки',
  'Discover Навыки': 'Обзор навыков', 'Discover Плагины': 'Обзор плагинов',
  'Source': 'Источник', 'Filters': 'Фильтры', 'Clear filters': 'Сбросить фильтры'
}))
const TEXT_AREAS = [
  '.catalog-card-description',
  '[data-catalog-list] [data-entry-id] > span > .line-clamp-2',
  '[data-catalog-detail] > p',
  '[data-catalog-detail] h4',
  '[data-catalog-detail] dt',
  '[data-testid^="plugin-row-"] > [role="cell"] > div > .mt-0\\.5.break-words',
  '[data-catalog-header] button',
  '[data-catalog-filters] button',
  '[data-catalog] h1',
  '[data-catalog] h2',
  '[data-catalog] h4',
  '[data-catalog] .catalog-section-heading',
  '[data-catalog-card] [data-slot="badge"]',
  '[data-catalog-card] button:not([aria-haspopup="dialog"])',
  '[data-catalog-detail] > header button',
  '[data-catalog-detail] > header a',
  '[data-catalog="skills"] .catalog-card-title',
  '[data-catalog-detail="skills"] > header h2',
  '[data-catalog-detail="skills"] > header h3',
  '[data-catalog-list="skills"] [data-entry-id] > span > span:first-child > span:first-child',
  '[data-catalog="skills"] [data-catalog-metadata] > span:first-child > span:first-child',
  '[data-catalog-detail="skills"] [data-catalog-metadata] > span:first-child > span:first-child'
].join(', ')
const PRIVATE = [
  'input', 'textarea', 'select', 'option', '[role="combobox"]', '[role="listbox"]',
  '[contenteditable]:not([contenteditable="false"])', 'form', 'script', 'style',
  'code', 'pre', 'kbd', 'samp', 'svg', 'iframe', '[hidden]', '[aria-hidden="true"]',
  '.font-mono', '[data-env]', '[data-catalog-commands]',
  '[data-testid$="settings-form"]', '[data-testid^="plugin-folder-access-"]',
  '[data-testid^="plugin-page-access-"]', '[data-hermes-ru-translator]'
].join(', ')

function routeKind(win) {
  const hash = win.location.hash.slice(1)
  // Parse only. Electron file:// origins are "null" and cannot be URL bases.
  const url = new URL(hash || win.location.pathname + win.location.search, 'http://hermes.invalid')
  if (url.pathname === '/cron') return 'cron'
  if (url.pathname !== '/capabilities') return null
  const tab = url.searchParams.get('tab') || 'skills'
  return tab === 'plugins' || tab === 'skills' ? tab : null
}

function safeSource(source) {
  if (!/[a-z]{2}/i.test(source) || source.length > 24000 || !source.trim()) return false
  if ((source.match(/[а-яё]/gi)?.length || 0) > (source.match(/[a-z]/gi)?.length || 0)) return false
  // These values remain exactly as rendered; none of them need the translator.
  if (/^\s*(?:https?:\/\/\S+|www\.\S+|[a-z]:\\\S+|[~/][\w./-]+|[\w.-]+\/[\w.-]+)\s*$/i.test(source)) return false
  // Display scope is authoritative. Public prose and technical examples are
  // translated locally without guessing whether their content is a credential.
  if (/^[\w.-]+$/.test(source.trim()) && /[_./-]/.test(source)) return false
  return true
}

function validTranslation(source, value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.isWellFormed()
    && value.split('\ufffd').length <= source.split('\ufffd').length
}

export function createPluginsTranslator({ document: doc, rest, onState = () => {}, cacheStorage = null, cacheKey = CACHE_KEY, cacheEngine = CACHE_ENGINE, engineLoaded = true }) {
  const win = doc.defaultView
  const ownership = new WeakMap()
  const owned = new Set()
  const queue = new Set()
  const scopes = new Map()
  let tooltipRoots = new Set()
  let categoryRoots = new Set()
  let modalDetails = new Set()
  let cronDialogs = new Set()
  const completed = new Map()
  const durable = new Map()
  let durableChars = 0
  let durableWritable = true
  const persistDurable = () => {
    if (cacheStorage && durableWritable) {
      try { cacheStorage.set(cacheKey, { version: 1, engine: cacheEngine, entries: [...durable] }) }
      catch { durableWritable = false }
    }
  }
  const keepDurable = (source, value, write) => {
    if (!validTranslation(source, value)) return
    if (durable.has(source)) { durableChars -= source.length + durable.get(source).length; durable.delete(source) }
    durable.set(source, value)
    durableChars += source.length + value.length
    while (durable.size > 1000 || durableChars > 2000000) {
      const [key, text] = durable.entries().next().value
      durable.delete(key)
      durableChars -= key.length + text.length
    }
    if (write) persistDurable()
  }
  let cachedChars = 0
  const remember = (source, value, persistable = false) => {
    if (!validTranslation(source, value)) return
    if (completed.has(source)) { cachedChars -= source.length + completed.get(source).length; completed.delete(source) }
    completed.set(source, value)
    cachedChars += source.length + value.length
    while (completed.size > 1000 || cachedChars > 2000000) {
      const [key, text] = completed.entries().next().value
      completed.delete(key)
      cachedChars -= key.length + text.length
    }
    if (persistable) keepDurable(source, value, true)
  }
  try {
    const saved = cacheStorage?.get(cacheKey, null)
    if (saved?.version === 1 && saved.engine === cacheEngine && Array.isArray(saved.entries)) {
      let rejected = false
      for (const entry of saved.entries.slice(-1000)) {
        if (!Array.isArray(entry) || entry.length !== 2) { rejected = true; continue }
        const [source, value] = entry
        if (typeof source !== 'string' || !safeSource(source) || !validTranslation(source, value) || value.length > 48000) { rejected = true; continue }
        remember(source, value)
        keepDurable(source, value, false)
      }
      if (rejected) persistDurable()
    }
  } catch { /* Unavailable or malformed storage must not disable translation. */ }
  let enabled = false
  let disposed = false
  let epoch = 0
  let inFlight = false
  let scheduled = false
  let error = ''
  let translated = 0
  let routeActive = null
  let pendingCount = 0
  let loaded = Boolean(engineLoaded)

  const publish = () => onState({ enabled, active: Boolean(routeActive), scope: routeActive, paused: !loaded, busy: inFlight || queue.size > 0, pending: queue.size + pendingCount, translated, error })
  const visible = el => {
    const rect = el.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth)) return false
    const clipSelectors = '[data-catalog-scroll], .capabilities-scroll, [data-catalog-expanded-filters], [data-slot="popover-content"], [data-slot="select-content"]'
    for (let clip = el.parentElement?.closest(clipSelectors); clip; clip = clip.parentElement?.closest(clipSelectors)) {
      const box = clip.getBoundingClientRect()
      if (box.width > 0 && box.height > 0 && (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right)) return false
    }
    return true
  }
  const eligible = node => {
    const el = node.parentElement
    if (!routeActive || !node.isConnected || !el) return false
    if (!visible(el)) return false
    if (routeActive === 'cron') {
      if (cronDialogs.size && !el.closest('[role="dialog"], [data-slot="select-content"], [role="listbox"]')) return false
      return isCronText(node, doc)
    }
    if (el.closest(PRIVATE)) return false
    const tooltip = el.closest('[data-slot="tooltip-content"]')
    if (tooltipRoots.has(tooltip)) return Boolean(el.closest('[data-slot="tooltip-label"]'))
    const category = el.closest('[data-slot="popover-content"]')
    if (categoryRoots.has(category)) return Boolean(el.closest('button, [data-catalog-expanded-filters] > div > span'))
    if (!el.closest(ROOTS)) return false
    const catalog = el.closest('[data-catalog], [data-catalog-detail]')
    if (!catalog || (catalog.getAttribute('data-catalog') ?? catalog.getAttribute('data-catalog-detail')) !== routeActive) return false
    if (modalDetails.size && !modalDetails.has(catalog)) return false
    if (el.closest('.catalog-card-title') && routeActive !== 'skills') return false
    if (el.closest('[data-catalog-metadata]') && !(routeActive === 'skills' && el.closest('[data-catalog-metadata] > span:first-child > span:first-child'))) return false
    const skillTitle = el.closest('.catalog-card-title, [data-catalog-detail="skills"] > header h2, [data-catalog-detail="skills"] > header h3')
    if (skillTitle && !/\s/.test(node.data.trim())) return false
    return Boolean(el.closest(TEXT_AREAS))
  }
  const restore = () => {
    for (const node of owned) {
      const record = ownership.get(node)
      if (record?.lastApplied !== null && node.data === record.lastApplied) node.data = record.source
      ownership.delete(node)
    }
    owned.clear()
    queue.clear()
  }
  const cancel = () => {
    epoch++
    queue.clear()
    restore()
  }
  const track = node => {
    if (!eligible(node)) return
    let record = ownership.get(node)
    if (record && node.data === record.lastApplied) return
    if (record && node.data === record.source && record.pending) return
    if (!safeSource(node.data)) return
    if (!record || record.source !== node.data) {
      record = { source: node.data, lastApplied: null, pending: false }
      ownership.set(node, record)
      owned.add(node)
    }
    if (completed.has(record.source)) {
      const value = completed.get(record.source)
      if (validTranslation(record.source, value)) {
        remember(record.source, value)
        record.lastApplied = value
        node.data = value
        queue.delete(node)
        return
      }
      cachedChars -= record.source.length + value.length
      completed.delete(record.source)
      if (durable.has(record.source)) {
        durableChars -= record.source.length + durable.get(record.source).length
        durable.delete(record.source)
        persistDurable()
      }
    }
    // Fixed, ordinary catalog labels paint immediately; package titles are
    // never eligible. Descriptions still go through the local engine.
    const fixed = (routeActive === 'cron' ? CRON_UI : FIXED_UI).get(node.data.trim())
    if (fixed && !node.parentElement.closest('.catalog-card-description, [data-catalog-detail] > p, [data-catalog-list] [data-entry-id] > span > .line-clamp-2, [data-testid^="plugin-row-"]')) {
      record.lastApplied = node.data.replace(node.data.trim(), fixed)
      node.data = record.lastApplied
      return
    }
    // SQLite is the persistent source of truth even after the bounded frontend
    // cache evicts an entry. A miss is checked once per owned source while off.
    if (!error && (loaded || !record.cacheMiss)) queue.add(node)
  }
  const scan = root => {
    const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) track(node)
  }
  const sync = () => {
    scheduled = false
    if (disposed || !enabled) return
    const nextActive = routeKind(win)
    if (nextActive !== routeActive) {
      cancel()
      routeActive = nextActive
    }
    const currentRoots = routeActive === 'cron' ? collectCronRoots(doc) : new Set(routeActive === 'skills' || routeActive === 'plugins' ? doc.querySelectorAll(`[data-catalog="${routeActive}"], [data-catalog-detail="${routeActive}"]`) : [])
    cronDialogs = new Set(routeActive === 'cron' ? [...currentRoots].filter(root => root.matches('[role="dialog"]') && visible(root)) : [])
    modalDetails = new Set([...currentRoots].filter(root => root.hasAttribute('data-catalog-detail') && root.closest('[role="dialog"]') && visible(root)))
    tooltipRoots = new Set()
    categoryRoots = new Set()
    for (const root of currentRoots) {
      for (const trigger of root.querySelectorAll('[aria-describedby]')) {
        if (trigger.closest(PRIVATE)) continue
        for (const id of trigger.getAttribute('aria-describedby').split(/\s+/)) {
          const content = doc.getElementById(id)?.closest('[data-slot="tooltip-content"]')
          if (content) tooltipRoots.add(content)
        }
      }
      for (const trigger of root.querySelectorAll('[data-catalog-filters] [aria-controls]')) {
        for (const id of trigger.getAttribute('aria-controls').split(/\s+/)) {
          const content = doc.getElementById(id)
          if (content?.matches('[data-slot="popover-content"]')) categoryRoots.add(content)
        }
      }
    }
    for (const root of tooltipRoots) currentRoots.add(root)
    for (const root of categoryRoots) currentRoots.add(root)
    for (const [root, observer] of scopes) {
      if (!currentRoots.has(root)) { observer.disconnect(); scopes.delete(root) }
    }
    for (const node of owned) {
      if (!eligible(node)) {
        const record = ownership.get(node)
        if (record?.lastApplied !== null && node.data === record.lastApplied) node.data = record.source
        owned.delete(node)
        ownership.delete(node)
        queue.delete(node)
      }
    }
    {
      for (const root of currentRoots) {
        if (!scopes.has(root)) {
          const observer = new win.MutationObserver(schedule)
          observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-catalog', 'data-catalog-detail', 'contenteditable', 'aria-describedby', 'aria-controls'] })
          scopes.set(root, observer)
        }
        scan(root)
      }
      void pump()
    }
    publish()
  }
  function schedule() {
    if (!scheduled && enabled && !disposed) {
      scheduled = true
      win.queueMicrotask(sync)
    }
  }
  async function pump() {
    if (inFlight || !enabled || disposed || !routeActive || error) return
    const cacheOnly = !loaded
    const items = []
    const texts = []
    let size = 0
    const priority = node => {
      const el = node.parentElement
      if (!el) return 3
      if (el.closest('[data-catalog-detail]') || categoryRoots.has(el.closest('[data-slot="popover-content"]')) || (routeActive === 'cron' && el.closest('[role="dialog"], [data-slot="select-content"]'))) return 0
      const rect = el.getBoundingClientRect()
      return rect.bottom >= 0 && rect.top <= win.innerHeight && rect.right >= 0 && rect.left <= win.innerWidth ? 1 : 2
    }
    const ordered = [...queue].map(node => ({ node, priority: priority(node) })).sort((a, b) => a.priority - b.priority)
    for (const { node } of ordered) {
      const record = ownership.get(node)
      if (!eligible(node) || !record || node.data !== record.source) { queue.delete(node); continue }
      let index = texts.indexOf(record.source)
      if (index < 0) {
        if (texts.length >= (cacheOnly ? 8 : 1) || size + record.source.length > 24000) break
        index = texts.length
        texts.push(record.source)
        size += record.source.length
      }
      record.pending = true
      items.push({ node, record, index, persistable: routeActive !== 'cron' && Boolean(node.parentElement.closest(PUBLIC_DESCRIPTIONS)) })
      queue.delete(node)
    }
    if (!items.length) return
    const requestEpoch = epoch
    inFlight = true
    pendingCount = items.length
    publish()
    try {
      // SDK has no AbortSignal. Epoch cancellation prevents all late writes;
      // the one already-sent local batch may finish within this bounded timeout.
      const result = await rest(cacheOnly ? '/cache/lookup' : '/translate', { method: 'POST', body: { texts, engine: 'local', lang: 'ru' }, timeoutMs: cacheOnly ? 5000 : 180000 })
      if (disposed || requestEpoch !== epoch || !enabled || routeKind(win) !== routeActive) return
      if (!result || !Array.isArray(result.texts) || result.texts.length !== texts.length
        || (cacheOnly && result.cache_epoch !== cacheEngine)
        || (result.cache_epoch !== undefined && result.cache_epoch !== cacheEngine)
        || result.texts.some((text, index) => !(cacheOnly && text === null) && !validTranslation(texts[index], text))) throw new Error('Invalid local translation response')
      for (let index = 0; index < texts.length; index++) {
        if (result.texts[index] !== null) remember(texts[index], result.texts[index], items.some(item => item.index === index && item.persistable))
      }
      if (requestEpoch !== epoch || !enabled || routeKind(win) !== routeActive) return
      for (const { node, record, index } of items) {
        if (result.texts[index] === null) { record.cacheMiss = true; continue }
        if (ownership.get(node) !== record || !eligible(node) || node.data !== record.source) continue
        const value = result.texts[index]
        record.lastApplied = value
        node.data = value
        translated++
      }
    } catch (_cause) {
      if (requestEpoch === epoch && enabled && !disposed && routeKind(win) === routeActive) {
        error = 'Перевод недоступен. Нажмите, чтобы выключить; включите для повтора.'
        queue.clear()
      }
    } finally {
      for (const { record } of items) record.pending = false
      inFlight = false
      pendingCount = 0
      if (!disposed) { publish(); schedule() }
    }
  }
  // Discovery only: no body text walking and no writes outside allowlisted roots.
  const discovery = new win.MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))) schedule()
  })
  const routeChanged = () => { if (enabled) sync() }
  const stopObservers = () => {
    discovery.disconnect()
    for (const observer of scopes.values()) observer.disconnect()
    scopes.clear()
    win.removeEventListener('hashchange', routeChanged)
    win.removeEventListener('popstate', routeChanged)
    doc.removeEventListener('scroll', schedule, true)
  }
  return {
    setEngineLoaded(value) {
      if (disposed) return
      const next = Boolean(value)
      if (loaded !== next) { epoch++; queue.clear() }
      loaded = next
      if (loaded) error = ''
      publish()
      schedule()
    },
    setEnabled(value) {
      if (disposed || enabled === Boolean(value)) return
      enabled = Boolean(value)
      error = ''
      if (enabled) {
        discovery.observe(doc.body, { childList: true, subtree: true })
        win.addEventListener('hashchange', routeChanged)
        win.addEventListener('popstate', routeChanged)
        doc.addEventListener('scroll', schedule, { capture: true, passive: true })
        sync()
      } else {
        stopObservers()
        cancel()
        routeActive = null
        publish()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      enabled = false
      stopObservers()
      cancel()
    }
  }
}
