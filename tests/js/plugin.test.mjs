import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const reactPaths = Object.fromEntries(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'].map(id => [id, pathToFileURL(require.resolve(id)).href]))
// Boundary harness only: real nanostores, React and DOM; the host contribution
// registry is captured, not reimplemented. This is not a runtime-loader proof.
const sdk = `export {atom} from '${pathToFileURL(require.resolve('nanostores'))}'; export {useStore as useValue} from '${pathToFileURL(require.resolve('@nanostores/react'))}'; export const TITLEBAR_AREAS={right:'titleBar.right'}; export const PALETTE_AREA='palette';`
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@hermes/plugin-sdk') return { url: `data:text/javascript,${encodeURIComponent(sdk)}`, shortCircuit: true }
  if (reactPaths[specifier]) return { url: reactPaths[specifier], shortCircuit: true }
  return next(specifier, context)
} })
const React = await import(reactPaths.react)
const { createRoot } = await import(reactPaths['react-dom/client'])
const wait = () => new Promise(resolve => setTimeout(resolve, 25))

// Catches invisible statusbar-only control, duplicated panes, nonreactive state,
// disconnected palette action, or missing plugin disposal.
for (const artifact of ['plugin.mjs', 'plugin.js']) {
const plugin = (await import(artifact === 'plugin.js' ? '../../desktop/plugin.js' : '../../src/frontend/plugin.mjs')).default
test(`${artifact}: registers one reactive titlebar toggle and palette command with automatic Plugins-only translation`, async () => {
  const dom = new JSDOM('<div id="control"></div><div data-catalog="plugins"><span class="catalog-card-description">Readable catalog description</span></div>', { url: 'http://localhost/#/capabilities?tab=plugins' })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 30, bottom: 50, left: 20, right: 420, width: 400, height: 20 })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const registrations = []
  const disposers = []
  const calls = []
  const root = createRoot(document.querySelector('#control'))
  try {
    plugin.register({
      register(contribution) { registrations.push(contribution) },
      onDispose(dispose) { disposers.push(dispose) },
      rest: async (path, options) => { calls.push(path); return path === '/status' ? { loaded: true, device: 'gpu', engine: 'local', model: 'HY-MT2 Q8', cache_epoch: 'hymt2-q8-test-v1' } : ({ texts: options.body.texts.map(() => 'Русское описание каталога'), engine: 'local', cached: 0, translated: options.body.texts.length }) }
    })
    assert.equal(registrations.filter(c => c.area === 'titleBar.right').length, 1)
    assert.equal(registrations.filter(c => c.area === 'palette').length, 1)
    assert.equal(registrations.length, 2)
    const control = registrations.find(c => c.area === 'titleBar.right')
    const palette = registrations.find(c => c.area === 'palette').data
    await React.act(async () => { root.render(control.render()); await wait() })
    let button = document.querySelector('#control button')
    assert.equal(button.getAttribute('aria-pressed'), 'true')
    assert.match(button.textContent, /^Перевод:/)
    assert.match(button.textContent, artifact.includes('cpu') ? /CPU/ : /GPU/)
    if (artifact.includes('cpu')) {
      assert.equal(document.querySelectorAll('#control button').length, 1)
      assert.ok(calls.every(path => path === '/translate'))
    }
    assert.equal(document.querySelector('.catalog-card-description').textContent, 'Русское описание каталога')
    await React.act(async () => { button.click(); await wait() })
    assert.equal(button.getAttribute('aria-pressed'), 'false')
    assert.equal(document.querySelector('.catalog-card-description').textContent, 'Readable catalog description')
    assert.equal(palette.detail(), 'выключено')
    await React.act(async () => { palette.run(); await wait() })
    assert.equal(button.getAttribute('aria-pressed'), 'true')
    assert.equal(palette.detail(), 'включено')
    assert.ok(disposers.length)
    await React.act(async () => { root.unmount(); disposers.forEach(dispose => dispose()); await wait() })
    assert.equal(document.querySelector('.catalog-card-description').textContent, 'Readable catalog description')
  } finally {
    await React.act(async () => root.unmount())
    disposers.forEach(dispose => dispose())
    dom.window.close()
    delete globalThis.window; delete globalThis.document
  }
})

if (!artifact.includes('cpu')) test(`${artifact}: GPU loads only from an explicit control and unloading preserves Russian while pausing uncached work`, async () => {
  const dom = new JSDOM('<div id="control"></div><div data-catalog="plugins"><span class="catalog-card-description">Public description</span></div>', { url: 'http://localhost/#/capabilities?tab=plugins' })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 30, bottom: 50, left: 20, right: 420, width: 400, height: 20 })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const registrations = [], disposers = [], calls = []
  let loaded = false
  const root = createRoot(document.querySelector('#control'))
  try {
    plugin.register({ register: c => registrations.push(c), onDispose: d => disposers.push(d), rest: async (path, options) => {
      calls.push({ path, options })
      if (path === '/engine/start') { assert.deepEqual(options.body, { variant: 'q8' }); loaded = true }
      if (path === '/engine/stop') loaded = false
      if (path === '/cache/lookup') return { texts: options.body.texts.map(() => null), cache_epoch: 'hymt2-q8-test-v1' }
      if (path === '/translate') return { texts: options.body.texts.map(t => `Перевод: ${t}`), engine: 'local', cached: 0, translated: 1 }
      return { loaded, device: 'gpu', engine: 'local', model: 'HY-MT2 Q8', cache_epoch: 'hymt2-q8-test-v1' }
    } })
    await React.act(async () => { root.render(registrations.find(c => c.area === 'titleBar.right').render()); await wait() })
    assert.ok(calls.some(c => c.path === '/status'))
    assert.ok(calls.every(c => ['/status', '/cache/lookup'].includes(c.path)), 'startup may read caches but cannot generate or start the model')
    const engineButton = document.querySelector('[data-hermes-ru-engine]')
    assert.ok(engineButton)
    assert.match(engineButton.textContent, /загрузить/i)
    await React.act(async () => { engineButton.click(); await wait() })
    assert.equal(document.querySelector('.catalog-card-description').textContent, 'Перевод: Public description')
    assert.match(engineButton.textContent, /выгрузить/i)
    await React.act(async () => { engineButton.click(); await wait() })
    assert.equal(document.querySelector('.catalog-card-description').textContent, 'Перевод: Public description')
    const count = calls.filter(c => c.path === '/translate').length
    await React.act(async () => { document.querySelector('[data-catalog]').insertAdjacentHTML('beforeend', '<span class="catalog-card-description">New uncached description</span>'); await wait() })
    assert.equal(calls.filter(c => c.path === '/translate').length, count)
    assert.match(document.querySelector('#control').textContent, /пауз/i)
    await React.act(async () => { engineButton.click(); await wait() })
    assert.equal(document.querySelectorAll('.catalog-card-description')[1].textContent, 'Перевод: New uncached description')
    assert.equal(calls.filter(c => c.path === '/engine/start').length, 2)
    assert.equal(calls.filter(c => c.path === '/engine/stop').length, 1)
  } finally {
    await React.act(async () => { root.unmount(); disposers.forEach(d => d()); await wait() })
    dom.window.close(); delete globalThis.window; delete globalThis.document
  }
})

if (!artifact.includes('cpu')) test(`${artifact}: choosing a profile never loads it; explicit switch/start/stop follows desired profile and actual device`, async () => {
  const dom = new JSDOM('<div id="control"></div>', { url: 'http://localhost/#/chat' })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 30, bottom: 50, left: 20, right: 420, width: 400, height: 20 })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const registrations = [], disposers = [], calls = []
  const profiles = [{ id: 'q8', label: 'HY-MT Q8', device: 'gpu', role: 'Точный перевод' }, { id: 'stq', label: 'STQ', device: 'cpu', role: 'Быстрый перевод' }, { id: 'stream', label: 'Stream', device: 'gpu', role: 'Потоковый перевод' }]
  let variant = 'q8', loaded = true
  const root = createRoot(document.querySelector('#control'))
  try {
    plugin.register({ register: c => registrations.push(c), onDispose: d => disposers.push(d), rest: async (path, options) => {
      calls.push({ path, options })
      if (path === '/engine/start') { variant = options.body.variant; loaded = true }
      if (path === '/engine/stop') loaded = false
      const profile = profiles.find(p => p.id === variant)
      return { loaded, variant, model_label: profile.label, profiles, enabled_variants: ['q8', 'stq', 'stream'], device: profile.device, engine: 'local', model: profile.label, cache_epoch: `${variant}-test-v3` }
    } })
    await React.act(async () => { root.render(registrations.find(c => c.area === 'titleBar.right').render()); await wait() })
    const selector = document.querySelector('select[aria-label="Модель переводчика"]')
    assert.ok(selector)
    assert.equal(selector.value, 'q8')
    assert.equal(selector.options.length, 3)
    const engine = document.querySelector('[data-hermes-ru-engine]')
    assert.match(engine.textContent, /выгрузить/i)
    await React.act(async () => { selector.value = 'stq'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await wait() })
    assert.deepEqual(calls.map(c => c.path), ['/status'])
    assert.match(engine.textContent, /переключить/i)
    assert.match(document.querySelector('#control button').textContent, /GPU/)
    await React.act(async () => { engine.click(); await wait() })
    assert.deepEqual(calls.at(-1).options.body, { variant: 'stq' })
    assert.match(engine.textContent, /выгрузить/i)
    assert.match(document.querySelector('#control button').textContent, /CPU/)
    await React.act(async () => { engine.click(); await wait() })
    assert.equal(calls.at(-1).path, '/engine/stop')
    assert.match(engine.textContent, /загрузить/i)
    await React.act(async () => { selector.value = 'stream'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await wait() })
    const count = calls.length
    assert.equal(calls.at(-1).path, '/engine/stop')
    await React.act(async () => { engine.click(); await wait() })
    assert.equal(calls.length, count + 1)
    assert.deepEqual(calls.at(-1).options.body, { variant: 'stream' })
  } finally {
    await React.act(async () => { root.unmount(); disposers.forEach(d => d()); await wait() })
    dom.window.close(); delete globalThis.window; delete globalThis.document
  }
})

if (!artifact.includes('cpu')) test(`${artifact}: same plugin declares native browser capability and registers gracefully only when preview API exists`, async () => {
  assert.ok(plugin.capabilities?.includes('preview.executeJavaScript'))
  const dom = new JSDOM('<div id="control"></div>', { url: 'http://localhost/#/chat' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  const registrations = [], disposers = []
  let polls = 0, stopped = 0, executeCalls = 0
  try {
    plugin.register({
      register(c) { registrations.push(c); return () => {} }, onDispose: d => disposers.push(d),
      setInterval(callback, delay) { assert.equal(typeof callback, 'function'); assert.ok(delay > 0); polls++; return () => { stopped++ } },
      preview: { isAvailable: () => false, executeJavaScript: async () => { executeCalls++ } },
      rest: async () => ({ loaded: false, device: 'gpu', variant: 'q8', model: 'HY-MT Q8', cache_epoch: 'q8-test-v3' })
    })
    await wait()
    assert.equal(registrations.filter(c => c.id === 'browser-translation-button').length, 1)
    assert.equal(polls, 1)
    assert.equal(executeCalls, 0)
    assert.ok(registrations.some(c => c.id === 'toggle'))
  } finally {
    disposers.forEach(d => d()); await wait()
    assert.equal(stopped, 1)
    dom.window.close(); delete globalThis.window; delete globalThis.document
  }
})
}
test.after(() => hook.deregister())
