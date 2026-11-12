import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createPluginsTranslator } from '../../src/frontend/adapter.mjs'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const wait = () => new Promise(resolve => setTimeout(resolve, 25))
const card = (text = 'Organize your research sources') => `<article data-catalog-card data-entry-id="research-helper"><button aria-haspopup="dialog" aria-label="research-helper"><span class="catalog-card-title">research-helper</span></button><span class="catalog-card-description">${text}</span><button id="install">Install</button></article>`
function setup(html = card(), rest, url = 'http://localhost/#/capabilities?tab=plugins', options = {}) {
  const dom = new JSDOM(`<div data-chat>Private conversation text</div><div data-catalog="plugins">${html}</div>`, { url })
  // jsdom has no layout. Declare explicit viewport geometry for these DOM tests.
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const top = this.closest('[data-offscreen]') ? 2000 : 30
    return { x: 20, y: top, top, bottom: top + 20, left: 20, right: 420, width: 400, height: 20 }
  }
  const calls = []
  const states = []
  const translate = rest || (async (path, request) => {
    calls.push({ path, ...request })
    if (path === '/cache/lookup') return { texts: request.body.texts.map(() => null), cache_epoch: options.cacheEngine || 'argos-en-ru-v1' }
    return { texts: request.body.texts.map(text => `Перевод: ${text}`), engine: 'argos', cached: 0, translated: request.body.texts.length }
  })
  const api = createPluginsTranslator({ document: dom.window.document, rest: translate, onState: s => states.push(s), ...options })
  const dispose = () => { api.dispose(); dom.window.close() }
  return { dom, doc: dom.window.document, api, calls, states, dispose }
}

// Catches widening the selector to arbitrary page content, or adding a second pane.
test('replaces plugin descriptions in place while preserving names, payloads and actions', async () => {
  const s = setup(card() + '<input value="secret input"><textarea>private draft</textarea><pre>code text</pre>')
  try {
    let clicks = 0
    const button = s.doc.querySelector('#install')
    button.addEventListener('click', () => clicks++)
    const description = s.doc.querySelector('.catalog-card-description')
    const originalTextNode = description.firstChild
    s.api.setEnabled(true)
    await wait()
    assert.equal(description.textContent, 'Перевод: Organize your research sources')
    assert.equal(description.firstChild, originalTextNode)
    assert.equal(s.doc.querySelectorAll('.catalog-card-description').length, 1)
    assert.equal(s.doc.querySelector('.catalog-card-title').textContent, 'research-helper')
    assert.equal(s.doc.querySelector('[data-chat]').textContent, 'Private conversation text')
    assert.equal(s.doc.querySelector('input').value, 'secret input')
    assert.equal(s.doc.querySelector('textarea').value, 'private draft')
    assert.equal(s.doc.querySelector('pre').textContent, 'code text')
    button.click()
    assert.equal(clicks, 1)
    assert.ok(s.calls.some(call => call.path === '/translate' && call.method === 'POST' && call.body.engine === 'local' && call.body.lang === 'ru'))
  } finally { s.dispose() }
})

// Catches losing inserts, portals or source changes while avoiding own observer loops.
test('translates inserted cards, list rows, selected detail portals and React text replacement', async () => {
  const s = setup()
  try {
    s.api.setEnabled(true)
    await wait()
    const firstCount = s.calls.length
    await wait()
    assert.equal(s.calls.length, firstCount)
    s.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', card('Browse useful tools'))
    s.doc.body.insertAdjacentHTML('beforeend', '<div role="dialog"><div data-catalog-detail="plugins"><h2>research-helper</h2><p>Detailed plugin overview</p><p>Another paragraph</p><code>tool_identifier</code><input value="private detail"></div></div>')
    s.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', '<div data-catalog-list="plugins"><div data-entry-id="other"><span><span><span>other-name</span></span><span class="line-clamp-2">List description</span></span></div></div>')
    await wait()
    assert.equal(s.doc.querySelector('[data-catalog-detail] > p').textContent, 'Перевод: Detailed plugin overview')
    assert.equal(s.doc.querySelector('[data-catalog-detail] h2').textContent, 'research-helper')
    s.doc.querySelector('[role="dialog"]').remove()
    await wait()
    assert.equal(s.doc.querySelector('[data-catalog-list] .line-clamp-2').textContent, 'Перевод: List description')
    const description = s.doc.querySelector('.catalog-card-description')
    description.firstChild.data = 'A new server description'
    await wait()
    assert.equal(description.textContent, 'Перевод: A new server description')
    description.replaceChildren(s.doc.createTextNode('React replaced the node'))
    await wait()
    assert.equal(description.textContent, 'Перевод: React replaced the node')
  } finally { s.dispose() }
})

// Catches stale writes when source or enable generation changes during a local request.
test('rejects stale responses after source change and after disable', async () => {
  const pending = []
  const s = setup(card(), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.api.setEnabled(true)
    await wait()
    const node = s.doc.querySelector('.catalog-card-description').firstChild
    node.data = 'New source arrived'
    pending[0].resolve({ texts: pending[0].options.body.texts.map(() => 'Устаревшее'), engine: 'argos', cached: 0, translated: 1 })
    await wait()
    assert.equal(node.data, 'New source arrived')
    assert.equal(pending.length, 2)
    s.api.setEnabled(false)
    pending[1].resolve({ texts: pending[1].options.body.texts.map(() => 'Позднее'), engine: 'argos', cached: 0, translated: 1 })
    await wait()
    assert.equal(node.data, 'New source arrived')
  } finally { s.dispose() }
})

// Catches overwriting newer React content on cleanup and retaining observers after unload.
test('disable and dispose restore only owned writes and stop subsequent translation', async () => {
  const s = setup(card() + card('Second description'))
  try {
    s.api.setEnabled(true)
    await wait()
    const nodes = s.doc.querySelectorAll('.catalog-card-description')
    assert.equal(nodes[0].textContent, 'Перевод: Organize your research sources')
    nodes[1].firstChild.data = 'New application value'
    s.api.setEnabled(false)
    assert.equal(nodes[0].textContent, 'Organize your research sources')
    assert.equal(nodes[1].textContent, 'New application value')
    s.api.setEnabled(true)
    await wait()
    s.api.dispose()
    assert.equal(nodes[0].textContent, 'Organize your research sources')
    const count = s.calls.length
    nodes[0].firstChild.data = 'After unload'
    await wait()
    assert.equal(s.calls.length, count)
    assert.equal(nodes[0].textContent, 'After unload')
  } finally { s.dispose() }
})

// Catches accidentally translating skills/settings/chat or unsafe display values.
test('excludes other routes, inactive catalogs, settings, inputs, code, URLs, identifiers and credentials', async () => {
  const s = setup(card() + [
    '<div data-catalog="skills"><span class="catalog-card-description">Skill private text</span></div>',
    '<form><span class="catalog-card-description">Setting private text</span></form>',
    '<div contenteditable="true"><span class="catalog-card-description">Editable text</span></div>',
    '<span class="catalog-card-description">https://example.test/private</span>',
    '<span class="catalog-card-description">API_KEY=super-secret-value</span>',
    '<span class="catalog-card-description">tool_identifier</span>',
    '<span class="catalog-card-description"><code>do_something()</code><span>Readable explanation</span></span>'
  ].join(''))
  try {
    s.dom.window.location.hash = '#/settings?tab=plugins'
    s.api.setEnabled(true)
    await wait()
    assert.equal(s.calls.length, 0)
    s.dom.window.location.hash = '#/capabilities?tab=connectors'
    await wait()
    assert.equal(s.calls.length, 0)
    s.dom.window.location.hash = '#/capabilities?tab=plugins'
    await wait()
    const sent = s.calls.flatMap(c => c.body.texts)
    assert.ok(sent.includes('Organize your research sources'))
    for (const forbidden of ['Skill private text', 'Setting private text', 'Editable text', 'https://example.test/private', 'tool_identifier', 'do_something()']) assert.ok(!sent.includes(forbidden), forbidden)
    assert.ok(sent.includes('API_KEY=super-secret-value'))
    assert.equal(s.doc.querySelector('code').textContent, 'do_something()')
  } finally { s.dispose() }
})

// Catches oversized wire requests, parallel requests and HTML interpretation.
test('serializes batches at eight strings and 24000 characters and keeps HTML as text', async () => {
  const s = setup(Array.from({ length: 19 }, (_, i) => card(`Description ${i}: ${'helpful notes '.repeat(230)}`)).join('') + card('&lt;img src=x onerror=alert(1)&gt; useful markup'))
  try {
    s.api.setEnabled(true)
    await wait(); await wait(); await wait()
    assert.ok(s.calls.length >= 3)
    for (const call of s.calls) {
      assert.ok(call.body.texts.length <= 8)
      assert.ok(call.body.texts.reduce((sum, text) => sum + text.length, 0) <= 24000)
    }
    assert.equal(s.doc.querySelectorAll('img').length, 0)
    assert.ok(s.doc.body.textContent.includes('Перевод: <img src=x onerror=alert(1)> useful markup'))
  } finally { s.dispose() }
})

// Catches request storms and applying partial/malformed translations to arbitrary nodes.
test('surfaces one Russian error and pauses on failed or malformed responses until toggled', async () => {
  for (const response of [null, { texts: [], engine: 'argos', cached: 0, translated: 0 }]) {
    let count = 0
    const s = setup(card(), async () => { count++; if (!response) throw new Error('backend detail'); return response })
    try {
      s.api.setEnabled(true)
      await wait()
      s.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', card('New after error'))
      await wait()
      assert.equal(count, 1)
      assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Organize your research sources')
      assert.ok(s.states.at(-1).error.startsWith('Перевод недоступен'))
    } finally { s.dispose() }
  }
})

// Catches removing the mapped installed-package description or translating its name.
test('translates actual installed package description and leaves package identity and private grants intact', async () => {
  const s = setup('<div data-catalog-detail="plugins"><div data-testid="plugin-row-agent:example" role="row"><div role="cell"><div><div><span>example-package</span></div><div class="mt-0.5 break-words">Installed package description</div><div data-testid="plugin-page-access-example"><span class="catalog-card-description">Private host access text</span></div></div></div></div></div>')
  try {
    s.api.setEnabled(true)
    await wait()
    assert.equal(s.doc.querySelector('.break-words').textContent, 'Перевод: Installed package description')
    assert.equal(s.doc.querySelector('[role="cell"] > div > div > span').textContent, 'example-package')
    assert.equal(s.doc.querySelector('[data-testid^="plugin-page-access-"]').textContent, 'Private host access text')
  } finally { s.dispose() }
})

// Catches parallel batches, and details waiting behind a page of mounted cards.
test('one request runs at a time and newly opened details get the next batch', async () => {
  const pending = []
  const s = setup(Array.from({ length: 20 }, (_, i) => card(`Description number ${i}`)).join(''), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.api.setEnabled(true)
    await wait()
    assert.equal(pending.length, 1)
    s.doc.body.insertAdjacentHTML('beforeend', '<div data-catalog-detail="plugins"><p>Selected detail needs priority</p></div>')
    await wait()
    assert.equal(pending.length, 1)
    pending[0].resolve({ texts: pending[0].options.body.texts.map(text => `Перевод: ${text}`), engine: 'argos', cached: 0, translated: 8 })
    await wait()
    assert.equal(pending.length, 2)
    assert.equal(pending[1].options.body.texts[0], 'Selected detail needs priority')
  } finally { s.dispose() }
})

// Catches late writes after unloading or navigating without a React DOM removal.
test('route exit and dispose invalidate a pending response even while old nodes stay mounted', async () => {
  for (const action of ['route', 'dispose']) {
    const pending = []
    const s = setup(card(), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
    try {
      s.api.setEnabled(true)
      await wait()
      if (action === 'route') s.dom.window.location.hash = '#/chat'
      else s.api.dispose()
      pending[0].resolve({ texts: pending[0].options.body.texts.map(() => 'Поздний перевод'), engine: 'argos', cached: 0, translated: 1 })
      await wait()
      assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Organize your research sources')
    } finally { s.dispose() }
  }
})

// Catches translating unrelated tooltip portals or missing actual Plugins tips.
test('translates only tooltip portals associated with a Plugins trigger', async () => {
  const s = setup(card() + '<button aria-describedby="plugins-tip">Install</button>')
  try {
    s.api.setEnabled(true)
    await wait()
    s.doc.body.insertAdjacentHTML('beforeend', '<div role="tooltip" id="plugins-tip" data-slot="tooltip-content"><div data-slot="tooltip-label">Install this useful plugin</div></div><button data-chat aria-describedby="chat-tip">Chat</button><div role="tooltip" id="chat-tip" data-slot="tooltip-content"><div data-slot="tooltip-label">Private chat tooltip</div></div>')
    await wait()
    assert.equal(s.doc.querySelector('#plugins-tip [data-slot="tooltip-label"]').textContent, 'Перевод: Install this useful plugin')
    assert.equal(s.doc.querySelector('#chat-tip').textContent, 'Private chat tooltip')
  } finally { s.dispose() }
})

// Catches controls waiting on Argos and blanket replacement of proper names.
test('shows bounded Russian catalog controls immediately while local descriptions are pending', async () => {
  const s = setup('<header data-catalog-header><button>Install from Git</button></header><div data-catalog-filters><button>Tier</button><button>Automation</button></div><section><header class="catalog-section-heading"><h2>Verified Plugins</h2><p>From the company behind the integration verified by Nous</p></header></section>' + card())
  try {
    s.api.setEnabled(true)
    assert.equal(s.doc.querySelector('[data-catalog-header] button').textContent, 'Установить из Git')
    assert.equal(s.doc.querySelector('[data-catalog-filters] button').textContent, 'Уровень доверия')
    assert.equal(s.doc.querySelector('.catalog-section-heading h2').textContent, 'Проверенные плагины')
    assert.equal(s.doc.querySelector('.catalog-card-title').textContent, 'research-helper')
    await wait()
    assert.ok(s.calls.flatMap(c => c.body.texts).includes('From the company behind the integration verified by Nous'))
  } finally { s.dispose() }
})

// Catches treating a public description containing a source URL as a URL field.
test('translates public prose containing URLs and repository references while leaving standalone values intact', async () => {
  const prose = 'Browse useful tools from owner/repository and https://example.test/docs today.'
  const s = setup(card(prose) + card('owner/repository') + card('https://example.test/docs'))
  try {
    s.api.setEnabled(true)
    await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, `Перевод: ${prose}`)
    assert.ok(s.calls.flatMap(call => call.body.texts).includes(prose))
    assert.ok(!s.calls.flatMap(call => call.body.texts).includes('owner/repository'))
    assert.ok(!s.calls.flatMap(call => call.body.texts).includes('https://example.test/docs'))
  } finally { s.dispose() }
})

// Catches file:// origins being "null" in the native Electron renderer.
test('recognizes the real native Electron file URL hash route without a network origin', async () => {
  const s = setup(card(), undefined, 'file:///opt/hermes/app/index.html#/capabilities?tab=plugins')
  try {
    assert.doesNotThrow(() => s.api.setEnabled(true))
    await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Organize your research sources')
  } finally { s.dispose() }
})

// Catches long public pinned URLs being mistaken for standalone credentials.
test('translates descriptions with long pinned public URLs and public credential examples', async () => {
  const prose = 'Read the guide at https://raw.githubusercontent.com/example/plugin/1234567890abcdef1234567890abcdef12345678/README.md to configure this useful plugin.'
  const s = setup(card(prose) + card('Use API_KEY=super-secret-value with https://example.test/docs'))
  try {
    s.api.setEnabled(true)
    await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, `Перевод: ${prose}`)
    const sent = s.calls.flatMap(call => call.body.texts)
    assert.ok(sent.includes(prose))
    assert.ok(sent.includes('Use API_KEY=super-secret-value with https://example.test/docs'))
  } finally { s.dispose() }
})

test('malformed URL-like public prose cannot crash catalog translation', async () => {
  const s = setup(card('Read the https://%broken example carefully'))
  try {
    assert.doesNotThrow(() => s.api.setEnabled(true))
    await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Read the https://%broken example carefully')
  } finally { s.dispose() }
})

test('reopened translated detail paints from memory while an unrelated request is pending, including route reentry', async () => {
  const pending = []
  const s = setup('<div data-catalog-detail="plugins"><p>Known detail description</p></div>', (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.api.setEnabled(true)
    await wait()
    pending[0].resolve({ texts: ['Известное описание'], engine: 'argos', cached: 0, translated: 1 })
    await wait()
    assert.equal(s.doc.querySelector('p').textContent, 'Известное описание')
    s.doc.querySelector('[data-catalog-detail]').remove()
    s.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', card('Unrelated queued description'))
    await wait()
    assert.equal(pending.length, 2)
    s.doc.body.insertAdjacentHTML('beforeend', '<div data-catalog-detail="plugins"><p>Known detail description</p></div>')
    await wait()
    assert.equal(s.doc.querySelector('p').textContent, 'Известное описание')
    assert.equal(pending.length, 2)
    s.dom.window.location.hash = '#/chat'
    await wait()
    s.dom.window.location.hash = '#/capabilities?tab=plugins'
    await wait()
    assert.equal(s.doc.querySelector('p').textContent, 'Известное описание')
    assert.equal(pending.length, 2)
  } finally { s.dispose() }
})

test('valid completed translation is reusable after the original DOM node disappeared', async () => {
  const pending = []
  const s = setup(card('Description removed before reply'), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.api.setEnabled(true)
    await wait()
    s.doc.querySelector('[data-catalog-card]').remove()
    pending[0].resolve({ texts: ['Повторно используемое описание'], engine: 'argos', cached: 0, translated: 1 })
    await wait()
    s.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', card('Description removed before reply'))
    await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Повторно используемое описание')
    assert.equal(pending.length, 1)
  } finally { s.dispose() }
})

test('skills descriptions, readable titles and linked category popovers translate without changing IDs or other portals', async () => {
  for (const route of ['#/capabilities', '#/capabilities?tab=skills']) {
    const s = setup(card('Research useful references').replaceAll('research-helper', 'research_topic').replace('>research_topic</span>', '>Research a topic</span>') + '<div data-catalog-filters><button aria-controls="category-popover">+222</button></div>', undefined, `http://localhost/${route}`)
    try {
      s.doc.querySelector('[data-catalog]').setAttribute('data-catalog', 'skills')
      s.doc.body.insertAdjacentHTML('beforeend', '<div id="category-popover" data-slot="popover-content"><button data-category="software-development">Software development</button><input value="private category search"></div><div data-slot="popover-content"><button>Private unrelated portal</button></div><div data-catalog-detail="skills"><header><h2>Research a topic</h2></header><p>Detailed skill description</p><pre>Do not change SKILL.md body</pre></div>')
      let clicks = 0
      const option = s.doc.querySelector('[data-category]')
      option.addEventListener('click', () => clicks++)
      s.api.setEnabled(true)
      await wait()
      assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Research useful references')
      assert.equal(s.doc.querySelector('.catalog-card-title').textContent, 'Перевод: Research a topic')
      assert.equal(s.doc.querySelector('[data-catalog-card]').getAttribute('data-entry-id'), 'research_topic')
      assert.equal(s.doc.querySelector('[data-catalog-card] button').getAttribute('aria-label'), 'research_topic')
      assert.equal(option.textContent, 'Перевод: Software development')
      assert.equal(option.getAttribute('data-category'), 'software-development')
      option.click(); assert.equal(clicks, 1)
      assert.equal(s.doc.querySelector('[data-catalog-detail] > p').textContent, 'Перевод: Detailed skill description')
      assert.equal(s.doc.querySelector('pre').textContent, 'Do not change SKILL.md body')
      assert.equal(s.doc.querySelector('input').value, 'private category search')
      assert.ok(!s.calls.flatMap(c => c.body.texts).includes('Private unrelated portal'))
      s.dom.window.location.hash = '#/capabilities?tab=tools'
      await wait()
      assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Research useful references')
      const count = s.calls.length
      s.dom.window.location.hash = '#/capabilities?tab=toolsets'
      await wait()
      assert.equal(s.calls.length, count)
    } finally { s.dispose() }
  }
})

test('only visible cards request translation, scrolling admits new cards, and each description request is small', async () => {
  const pending = []
  const s = setup(card('Foreground short description') + card('Hidden background description').replace('data-catalog-card', 'data-catalog-card data-offscreen'), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.api.setEnabled(true)
    await wait()
    assert.deepEqual(pending[0].options.body.texts, ['Foreground short description'])
    pending[0].resolve({ texts: ['Видимое описание'], engine: 'argos', cached: 0, translated: 1 })
    await wait()
    assert.equal(pending.length, 1)
    assert.equal(s.doc.querySelector('[data-offscreen] .catalog-card-description').textContent, 'Hidden background description')
    s.doc.querySelector('[data-offscreen]').removeAttribute('data-offscreen')
    s.doc.dispatchEvent(new s.dom.window.Event('scroll'))
    await wait()
    assert.deepEqual(pending[1].options.body.texts, ['Hidden background description'])
    s.api.dispose()
    const count = pending.length
    s.doc.dispatchEvent(new s.dom.window.Event('scroll'))
    await wait()
    assert.equal(pending.length, count)
  } finally { s.dispose() }
})

test('mostly Russian interface copy containing URL or API does not enter translation requests', async () => {
  const s = setup(card('Введите URL для подключения') + card('English explanation mentioning API and URL remains translatable'))
  try {
    s.api.setEnabled(true)
    await wait()
    assert.ok(!s.calls.flatMap(c => c.body.texts).includes('Введите URL для подключения'))
    assert.ok(s.calls.flatMap(c => c.body.texts).includes('English explanation mentioning API and URL remains translatable'))
  } finally { s.dispose() }
})

test('open detail dialog pauses card background work, then only one newly visible description is sent per request', async () => {
  const pending = []
  const s = setup(card('First visible card') + card('Second visible card'), (_path, options) => new Promise(resolve => pending.push({ options, resolve })))
  try {
    s.doc.body.insertAdjacentHTML('beforeend', '<div role="dialog"><div data-catalog-detail="plugins"><p>Foreground modal detail</p></div></div>')
    s.api.setEnabled(true)
    await wait()
    assert.deepEqual(pending[0].options.body.texts, ['Foreground modal detail'])
    pending[0].resolve({ texts: ['Описание открытого окна'], engine: 'argos', cached: 0, translated: 1 })
    await wait()
    assert.equal(pending.length, 1)
    s.doc.querySelector('[role="dialog"]').remove()
    await wait()
    assert.deepEqual(pending[1].options.body.texts, ['First visible card'])
  } finally { s.dispose() }
})

function jsonStorage() {
  const values = new Map([['unrelated-existing-key', { keep: true }]])
  return {
    values,
    get(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback },
    set(key, value) { values.set(key, structuredClone(value)) }
  }
}

test('a fresh adapter restores public description cache synchronously without REST and changed sources request new translations', async () => {
  const cacheStorage = jsonStorage()
  const first = setup(card('Public repeatable description'), undefined, undefined, { cacheStorage })
  try { first.api.setEnabled(true); await wait() } finally { first.dispose() }
  const second = setup(card('Public repeatable description'), undefined, undefined, { cacheStorage })
  try {
    second.api.setEnabled(true)
    assert.equal(second.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Public repeatable description')
    assert.equal(second.calls.length, 0)
    second.doc.querySelector('.catalog-card-description').firstChild.data = 'Changed public description'
    await wait()
    assert.equal(second.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Changed public description')
    assert.equal(second.calls.length, 1)
    assert.deepEqual(cacheStorage.values.get('unrelated-existing-key'), { keep: true })
  } finally { second.dispose() }
})

test('durable cache excludes structurally private fields, is bounded, and tolerates malformed data and storage quota failures', async () => {
  const cacheStorage = jsonStorage()
  const s = setup(card('Public cache seed') + card('API_KEY=super-secret-value') + '<input value="private input">', undefined, undefined, { cacheStorage })
  try {
    s.api.setEnabled(true); await wait()
    const ownKey = [...cacheStorage.values.keys()].find(key => key !== 'unrelated-existing-key')
    assert.ok(ownKey)
    const cached = cacheStorage.values.get(ownKey)
    assert.ok(JSON.stringify(cached).includes('Public cache seed'))
    assert.ok(JSON.stringify(cached).includes('API_KEY=super-secret-value'))
    assert.ok(!JSON.stringify(cached).includes('private input'))
    // Shape is learned from a genuine serialization, not assumed by a fake backend.
    cached.entries = Array.from({ length: 1200 }, (_, i) => [`Public historic description ${i}`, `Историческое описание ${i}`])
    cacheStorage.values.set(ownKey, cached)
    const reopened = setup(card('New public description'), undefined, undefined, { cacheStorage })
    try {
      reopened.api.setEnabled(true); await wait()
      assert.ok(cacheStorage.values.get(ownKey).entries.length <= 1000)
      assert.ok(JSON.stringify(cacheStorage.values.get(ownKey)).length <= 2100000)
    } finally { reopened.dispose() }
    cacheStorage.values.set(ownKey, { entries: [null, ['API_KEY=secret', 'секрет']], version: 'wrong' })
    const malformed = setup(card('After malformed cache'), undefined, undefined, { cacheStorage })
    try {
      assert.doesNotThrow(() => malformed.api.setEnabled(true)); await wait()
      assert.equal(malformed.doc.querySelector('.catalog-card-description').textContent, 'Перевод: After malformed cache')
    } finally { malformed.dispose() }
    const quota = setup(card('Quota still translates'), undefined, undefined, { cacheStorage: { get() { throw new Error('read denied') }, set() { throw new Error('quota exceeded') } } })
    try {
      assert.doesNotThrow(() => quota.api.setEnabled(true)); await wait()
      assert.equal(quota.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Quota still translates')
    } finally { quota.dispose() }
  } finally { s.dispose() }
})

test('scheduled-task editor translates allowed text and select displays while preserving prompts, IDs, models and actions', async () => {
  const cacheStorage = jsonStorage()
  const s = setup('', undefined, 'file:///C:/app/index.html#/cron', { cacheStorage })
  try {
    s.doc.body.insertAdjacentHTML('beforeend', '<div data-panel-row="blueprint-weekly-review"><span class="font-medium">Weekly review</span></div><div data-panel-row="user-job"><span>Private existing job</span></div><div role="dialog"><h2>New scheduled job</h2><form><label for="cron-template">Start from</label><button id="cron-template" role="combobox" data-slot="select-trigger" aria-controls="template-menu"><span data-slot="select-value">Weekly review</span></button><p>A new descriptive weekly summary</p><label for="blueprint-day">Which day?</label><button id="blueprint-day" role="combobox" data-slot="select-trigger" aria-controls="day-menu"><span data-slot="select-value">sunday</span></button><input id="cron-name" value="Private task name"><textarea id="cron-prompt">Private job prompt</textarea><button id="cron-model" role="combobox" data-slot="select-trigger" aria-controls="model-menu"><span data-slot="select-value">Private selected model</span></button><button id="schedule" type="button">Schedule</button><code>0 8 * * 1</code></form></div><div id="day-menu" data-slot="select-content" role="listbox"><div role="option" data-value="sunday"><span>sunday</span></div></div><div id="model-menu" data-slot="select-content" role="listbox"><div role="option">Private model option</div></div>')
    let clicked = 0
    s.doc.querySelector('#schedule').addEventListener('click', () => clicked++)
    s.api.setEnabled(true)
    assert.equal(s.doc.querySelector('[role="dialog"] h2').textContent, 'Новая запланированная задача')
    assert.equal(s.doc.querySelector('#cron-template').textContent, 'Еженедельный обзор')
    assert.equal(s.doc.querySelector('#blueprint-day').textContent, 'воскресенье')
    assert.equal(s.doc.querySelector('#day-menu [role="option"]').textContent, 'воскресенье')
    assert.equal(s.doc.querySelector('#day-menu [role="option"]').getAttribute('data-value'), 'sunday')
    await wait()
    assert.equal(s.doc.querySelector('[role="dialog"] p').textContent, 'Перевод: A new descriptive weekly summary')
    assert.equal(s.doc.querySelector('#cron-name').value, 'Private task name')
    assert.equal(s.doc.querySelector('#cron-prompt').value, 'Private job prompt')
    assert.equal(s.doc.querySelector('#cron-model').textContent, 'Private selected model')
    assert.equal(s.doc.querySelector('#model-menu').textContent, 'Private model option')
    assert.equal(s.doc.querySelector('[data-panel-row="user-job"]').textContent, 'Private existing job')
    s.doc.querySelector('#schedule').click(); assert.equal(clicked, 1)
    assert.deepEqual([...cacheStorage.values.keys()], ['unrelated-existing-key'])
    const sent = s.calls.flatMap(call => call.body.texts)
    for (const privateText of ['Private task name', 'Private job prompt', 'Private selected model', 'Private model option', 'Private existing job', '0 8 * * 1']) assert.ok(!sent.includes(privateText))
    s.dom.window.location.hash = '#/capabilities?tab=tools'
    await wait()
    assert.equal(s.doc.querySelector('#cron-template').textContent, 'Weekly review')
    assert.equal(s.doc.querySelector('#day-menu [role="option"]').textContent, 'sunday')
  } finally { s.dispose() }
})

test('category options clipped by their popup viewport wait until that popup scrolls', async () => {
  const s = setup('<div data-catalog-filters><button aria-controls="categories">+222</button></div>', undefined, 'http://localhost/#/capabilities?tab=skills')
  try {
    s.doc.querySelector('[data-catalog]').setAttribute('data-catalog', 'skills')
    s.doc.body.insertAdjacentHTML('beforeend', '<div id="categories" data-slot="popover-content"><button id="visible-category">Visible category</button><button id="clipped-category">Clipped category</button></div>')
    const popup = s.doc.querySelector('#categories')
    popup.getBoundingClientRect = () => ({ top: 30, bottom: 100, left: 20, right: 420, width: 400, height: 70 })
    const clipped = s.doc.querySelector('#clipped-category')
    clipped.getBoundingClientRect = () => ({ top: 150, bottom: 170, left: 20, right: 420, width: 400, height: 20 })
    s.api.setEnabled(true); await wait()
    assert.equal(s.doc.querySelector('#visible-category').textContent, 'Перевод: Visible category')
    assert.equal(clipped.textContent, 'Clipped category')
    assert.ok(!s.calls.flatMap(c => c.body.texts).includes('Clipped category'))
    clipped.getBoundingClientRect = () => ({ top: 50, bottom: 70, left: 20, right: 420, width: 400, height: 20 })
    popup.dispatchEvent(new s.dom.window.Event('scroll')); await wait()
    assert.equal(clipped.textContent, 'Перевод: Clipped category')
  } finally { s.dispose() }
})

test('cache epochs isolate engines and unloaded engines replay cached Russian without translating misses', async () => {
  const cacheStorage = jsonStorage()
  const argos = setup(card('Same public description'), undefined, undefined, { cacheStorage })
  try { argos.api.setEnabled(true); await wait() } finally { argos.dispose() }
  const hymt = setup(card('Same public description'), undefined, undefined, { cacheStorage, cacheKey: 'hymt-epoch', cacheEngine: 'hymt-q8-v1', engineLoaded: false })
  try {
    hymt.api.setEnabled(true); await wait()
    assert.deepEqual(hymt.calls.map(call => call.path), ['/cache/lookup'])
    assert.equal(hymt.doc.querySelector('.catalog-card-description').textContent, 'Same public description')
    hymt.api.setEngineLoaded(true); await wait()
    assert.deepEqual(hymt.calls.map(call => call.path), ['/cache/lookup', '/translate'])
    hymt.api.setEngineLoaded(false)
    assert.equal(hymt.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Same public description')
    hymt.doc.querySelector('.catalog-card-description').remove()
    hymt.doc.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', card('Same public description') + card('Uncached while unloaded'))
    await wait()
    assert.equal(hymt.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Same public description')
    assert.deepEqual(hymt.calls.map(call => call.path), ['/cache/lookup', '/translate', '/cache/lookup'])
  } finally { hymt.dispose() }
  const cold = setup(card('Same public description'), undefined, undefined, { cacheStorage, cacheKey: 'hymt-epoch', cacheEngine: 'hymt-q8-v1', engineLoaded: false })
  try {
    cold.api.setEnabled(true)
    assert.equal(cold.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Same public description')
    assert.equal(cold.calls.length, 0)
  } finally { cold.dispose() }
})

for (const [name, description] of [
  ['memory-example', 'Local memory for long sessions. Store notes in memory.db and set EXAMPLE_ENABLED=true. ' + 'Technical documentation with literal identifiers and normal prose. '.repeat(32)],
  ['search-example', 'Searchable SQLite memory with FTS5 and optional embeddings. Use example/settings.json. ' + 'Detailed documentation containing English and Russian language names. '.repeat(150)]
]) test(`long ${name} documentation translates in the modal despite technical examples`, async () => {
    const s = setup('')
    try {
      s.doc.body.insertAdjacentHTML('beforeend', '<div role="dialog"><div data-catalog-detail="plugins"><p></p></div></div>')
      s.doc.querySelector('p').textContent = description
      s.api.setEnabled(true); await wait()
      assert.ok(s.calls.flatMap(call => call.body.texts).includes(description), name)
      assert.equal(s.doc.querySelector('p').textContent, `Перевод: ${description}`, name)
    } finally { s.dispose() }
})

test('public display prose containing token, key, bearer and opaque examples is translated while actual inputs remain untouched', async () => {
  const prose = 'Example token=abc password=value API_KEY=sample Authorization: Bearer public-example sk-public-example-value ' + 'A1b2C3'.repeat(20) + ' belongs to this documentation.'
  const s = setup(card(prose) + '<input value="actual input remains exact"><textarea>actual draft remains exact</textarea>')
  try {
    s.api.setEnabled(true); await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, `Перевод: ${prose}`)
    assert.equal(s.doc.querySelector('input').value, 'actual input remains exact')
    assert.equal(s.doc.querySelector('textarea').value, 'actual draft remains exact')
  } finally { s.dispose() }
})

test('bad durable Snapcompact legacy output is evicted and requested again without painting replacement characters', async () => {
  const source = 'Snapcompact context engine: archives conversation history as dense bitmap PNG frames that vision models read back at ~1/3 the token cost.'
  const cacheStorage = jsonStorage()
  const seed = setup(card(source), undefined, undefined, { cacheStorage })
  try { seed.api.setEnabled(true); await wait() } finally { seed.dispose() }
  const ownKey = [...cacheStorage.values.keys()].find(key => key !== 'unrelated-existing-key')
  const stored = cacheStorage.values.get(ownKey)
  stored.entries = [[source, 'Snapcompact ' + '\ufffd'.repeat(105)]]
  cacheStorage.values.set(ownKey, stored)
  let finish
  const pending = []
  const next = setup(card(source), (_path, options) => { pending.push(options); return new Promise(resolve => { finish = resolve }) }, undefined, { cacheStorage })
  try {
    next.api.setEnabled(true); await wait()
    assert.equal(next.doc.querySelector('.catalog-card-description').textContent, source)
    assert.equal(pending.length, 1)
    assert.ok(!JSON.stringify(cacheStorage.values.get(ownKey)).includes('\ufffd'))
    finish({ texts: ['Корректное описание Snapcompact'], engine: 'local', cached: 0, translated: 1 })
    await wait()
    assert.equal(next.doc.querySelector('.catalog-card-description').textContent, 'Корректное описание Snapcompact')
  } finally { next.dispose() }
})

test('new outputs with increased replacement characters or malformed UTF16 never paint or persist', async () => {
  for (const output of ['Перевод \ufffd', 'Перевод \ud800']) {
    const cacheStorage = jsonStorage()
    const s = setup(card('Correctly encoded source'), async () => ({ texts: [output], engine: 'local', cached: 0, translated: 1 }), undefined, { cacheStorage })
    try {
      s.api.setEnabled(true); await wait()
      assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Correctly encoded source')
      assert.deepEqual([...cacheStorage.values.keys()], ['unrelated-existing-key'])
      assert.ok(s.states.at(-1).error)
    } finally { s.dispose() }
  }
})

test('a replacement character already present in the source may remain without blocking a valid translation', async () => {
  const source = 'Original public text contains \ufffd as an example'
  const s = setup(card(source), async () => ({ texts: ['Исходный пример содержит \ufffd'], engine: 'local', cached: 0, translated: 1 }))
  try {
    s.api.setEnabled(true); await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Исходный пример содержит \ufffd')
  } finally { s.dispose() }
})

test('an empty frontend cache replays SQLite rows with the model unloaded using only bounded cache lookups', async () => {
  const requests = []
  const s = setup(Array.from({ length: 19 }, (_, index) => card(`Archived public description ${index}`)).join(''), async (path, options) => {
    requests.push({ path, ...options })
    return { texts: options.body.texts.map(text => `Архив: ${text}`), cache_epoch: 'disk-epoch', cached: options.body.texts.length, missed: 0 }
  }, undefined, { cacheStorage: jsonStorage(), cacheEngine: 'disk-epoch', engineLoaded: false })
  try {
    s.api.setEnabled(true); await wait(); await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Архив: Archived public description 0')
    assert.equal(s.doc.querySelectorAll('.catalog-card-description')[18].textContent, 'Архив: Archived public description 18')
    assert.ok(requests.length >= 3)
    for (const request of requests) {
      assert.equal(request.path, '/cache/lookup')
      assert.ok(request.body.texts.length <= 8)
      assert.ok(request.body.texts.reduce((total, text) => total + text.length, 0) <= 24000)
      assert.ok(request.timeoutMs <= 5000)
    }
  } finally { s.dispose() }
})

test('SQLite cache misses remain English without repeated unloaded requests and translate after explicit load', async () => {
  const requests = []
  const s = setup(card('Uncached public description'), async (path, options) => {
    requests.push(path)
    return { texts: options.body.texts.map(text => path === '/cache/lookup' ? null : `Перевод: ${text}`), cache_epoch: 'disk-epoch' }
  }, undefined, { cacheEngine: 'disk-epoch', engineLoaded: false })
  try {
    s.api.setEnabled(true); await wait(); await wait()
    s.doc.dispatchEvent(new s.dom.window.Event('scroll')); await wait()
    s.api.setEngineLoaded(false); await wait()
    assert.deepEqual(requests, ['/cache/lookup'])
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Uncached public description')
    assert.equal(s.states.at(-1).error, '')
    assert.equal(s.states.at(-1).busy, false)
    s.api.setEngineLoaded(true); await wait()
    assert.deepEqual(requests, ['/cache/lookup', '/translate'])
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Перевод: Uncached public description')
  } finally { s.dispose() }
})

test('a lookup response from a different model epoch cannot paint or enter frontend storage', async () => {
  const storage = jsonStorage()
  const requests = []
  const s = setup(card('Expected epoch source'), async path => {
    requests.push(path)
    return { texts: ['Другой профиль'], cache_epoch: 'wrong-epoch' }
  }, undefined, { cacheStorage: storage, cacheEngine: 'expected-epoch', engineLoaded: false })
  try {
    s.api.setEnabled(true); await wait(); await wait()
    assert.deepEqual(requests, ['/cache/lookup'])
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Expected epoch source')
    assert.deepEqual([...storage.values.keys()], ['unrelated-existing-key'])
  } finally { s.dispose() }
})

test('a disabled cache lookup cannot paint or persist a late SQLite response', async () => {
  const storage = jsonStorage()
  let finish
  const s = setup(card('Pending disk source'), () => new Promise(resolve => { finish = resolve }), undefined,
    { cacheStorage: storage, cacheEngine: 'disk-epoch', engineLoaded: false })
  try {
    s.api.setEnabled(true); await wait()
    assert.equal(typeof finish, 'function')
    s.api.setEnabled(false)
    finish({ texts: ['Поздний архив'], cache_epoch: 'disk-epoch' }); await wait()
    assert.equal(s.doc.querySelector('.catalog-card-description').textContent, 'Pending disk source')
    assert.deepEqual([...storage.values.keys()], ['unrelated-existing-key'])
  } finally { s.dispose() }
})
