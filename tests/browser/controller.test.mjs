import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const moduleUrl = new URL('../../src/browser/controller.mjs', import.meta.url)
test('browser controller exists', () => assert.ok(existsSync(moduleUrl), 'missing browser controller'))
if (existsSync(moduleUrl)) {
  const { createBrowserTranslator } = await import(moduleUrl)
  test('completed translation stays Russian through idle, navigation and disposal with no background guest calls', async () => {
    const dom = new JSDOM('<p>Persistent page text</p>', { url: 'https://example.com/', runScripts: 'outside-only' })
    let scriptCalls = 0
    const translator = createBrowserTranslator({ preview: { isAvailable: () => true, executeJavaScript: async code => { scriptCalls++; return dom.window.eval(code) } }, rest: async () => ({ texts: ['Постоянный русский текст'] }) }, { pollMs: 1 })
    try {
      await translator.start()
      const completedCalls = scriptCalls
      await new Promise(r => setTimeout(r, 30))
      assert.equal(scriptCalls, completedCalls, 'idle must not execute in another origin')
      dom.window.history.pushState({}, '', '/new-route')
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      await translator.dispose()
      assert.equal(scriptCalls, completedCalls, 'disposal must not execute in or restore another page')
      assert.equal(dom.window.document.querySelector('p').textContent, 'Постоянный русский текст')
    } finally { await translator.dispose(); dom.window.close() }
  })
  test('native consent denial sends no page text to the translator', async () => {
    let requests = 0
    const states = []
    const translator = createBrowserTranslator({ preview: { isAvailable: () => true, executeJavaScript: async () => { throw new Error('Not allowed on this origin') } }, rest: async () => { requests++ } }, { onState: state => states.push(state) })
    await translator.start()
    assert.equal(requests, 0)
    assert.ok(states.at(-1).error.includes('Not allowed'))
    await translator.dispose()
  })
  test('switching active browser while a request is pending never applies to the new page', async () => {
    const first = new JSDOM('<p>Original first page</p>', { url: 'https://example.com/one', runScripts: 'outside-only' })
    const second = new JSDOM('<p>Original second page</p>', { url: 'https://example.com/two', runScripts: 'outside-only' })
    let selected = first
    let resolve
    const translator = createBrowserTranslator({ preview: { isAvailable: () => true, executeJavaScript: async code => selected.window.eval(code) }, rest: () => new Promise(r => { resolve = r }) }, { pollMs: 100000 })
    try {
      const pending = translator.start()
      while (!resolve) await new Promise(r => setTimeout(r, 1))
      selected = second
      resolve({ texts: ['Поздний перевод'] })
      await pending
      assert.equal(second.window.document.querySelector('p').textContent, 'Original second page')
      assert.equal(translator.getState().active, false)
    } finally { await translator.dispose(); first.window.close(); second.window.close() }
  })
  test('translates long prose in bounded requests instead of silently skipping it', async () => {
    const prose = 'Long paragraph with useful documentation. '.repeat(800)
    const dom = new JSDOM(`<p>${prose}</p>`, { url: 'https://example.com/', runScripts: 'outside-only' })
    const lengths = []
    const ctx = { preview: { isAvailable: () => true, executeJavaScript: async code => dom.window.eval(code) }, rest: async (_, options) => { lengths.push(options.body.texts[0].length); return { texts: [options.body.texts[0].replaceAll('Long', 'Русский')] } } }
    const translator = createBrowserTranslator(ctx, { pollMs: 100000 })
    try {
      await translator.start()
      assert.ok(lengths.length > 1)
      assert.ok(lengths.every(length => length <= 12000))
      assert.ok(dom.window.document.querySelector('p').textContent.startsWith('Русский'))
    } finally { await translator.dispose(); dom.window.close() }
  })
  test('only user start reaches preview; translates via local namespace and restores', async () => {
    const dom = new JSDOM('<h1>Hello world</h1>', { url: 'https://example.com/', runScripts: 'outside-only' })
    const calls = []
    let scriptCalls = 0
    const ctx = { preview: { isAvailable: () => true, executeJavaScript: async code => { scriptCalls++; return dom.window.eval(code) } }, rest: async (path, options) => { calls.push({ path, options }); return { texts: ['Привет, мир'] } } }
    const translator = createBrowserTranslator(ctx, { pollMs: 100000 })
    try {
      assert.equal(scriptCalls, 0)
      await translator.start()
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Привет, мир')
      assert.equal(calls[0].path, '/translate')
      assert.deepEqual(calls[0].options.body, { texts: ['Hello world'], lang: 'ru', engine: 'local' })
      await translator.stop()
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Hello world')
    } finally { await translator.dispose(); dom.window.close() }
  })
  test('stopping while local translation is pending rejects its late result', async () => {
    const dom = new JSDOM('<p>Original words</p>', { url: 'https://example.com/', runScripts: 'outside-only' })
    let resolve
    const ctx = { preview: { isAvailable: () => true, executeJavaScript: async code => dom.window.eval(code) }, rest: () => new Promise(r => { resolve = r }) }
    const translator = createBrowserTranslator(ctx, { pollMs: 100000 })
    try {
      const pending = translator.start()
      while (!resolve) await new Promise(r => setTimeout(r, 1))
      await translator.stop()
      resolve({ texts: ['Поздний перевод'] })
      await pending
      assert.equal(dom.window.document.querySelector('p').textContent, 'Original words')
    } finally { await translator.dispose(); dom.window.close() }
  })
}
