import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const moduleUrl = new URL('../../src/browser/guest.mjs', import.meta.url)
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('browser translator implementation exists', () => assert.ok(existsSync(moduleUrl), 'missing guest translator'))
if (existsSync(moduleUrl)) {
  const { guestCommand } = await import(moduleUrl)
  test('guest snapshot has no lease timer or observer and survives navigation without restoration', () => {
    const { dom, run } = page()
    try {
      dom.window.setInterval = () => { throw new Error('No guest background timer permitted') }
      dom.window.MutationObserver = class { constructor() { throw new Error('No guest observer permitted') } }
      const { href } = run({ action: 'start', token: 'persistent' })
      const batch = run({ action: 'collect', token: 'persistent', href })
      run({ action: 'apply', token: 'persistent', href, items: batch.items.map(x => ({ ...x, out: 'Русский навсегда до оригинала' })) })
      dom.window.history.pushState({}, '', '/other')
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Русский навсегда до оригинала')
    } finally { dom.window.close() }
  })
  function page() {
    const dom = new JSDOM('<h1>Get started</h1><p>Read the documentation</p><code>npm install nexus</code><pre>Secret text</pre><input value="Password"><form><button>Submit order</button></form><a href="https://example.com/">https://example.com/</a><span contenteditable="true">Draft message</span><p hidden>Hidden paragraph</p>', { url: 'https://github.com/project/nexus', runScripts: 'outside-only' })
    const run = payload => dom.window.eval(`(${guestCommand.toString()})(${JSON.stringify(payload)})`)
    return { dom, run }
  }
  for (const destination of ['editable', 'form', 'textarea', 'code']) {
    test(`late translation and explicit Original skip a node that became ${destination}`, () => {
      for (const afterApply of [false, true]) {
        const { dom, run } = page()
        try {
          const { href } = run({ action: 'start', token: 'eligibility' })
          const batch = run({ action: 'collect', token: 'eligibility', href })
          const item = batch.items.find(item => item.text === 'Read the documentation')
          const paragraph = dom.window.document.querySelector('p')
          const translated = { ...item, out: 'Читайте документацию' }
          if (afterApply) run({ action: 'apply', token: 'eligibility', href, items: [translated] })
          if (destination === 'editable') paragraph.setAttribute('contenteditable', 'true')
          else {
            const target = dom.window.document.createElement(destination)
            dom.window.document.body.append(target)
            target.append(paragraph.firstChild)
          }
          const node = destination === 'editable' ? paragraph.firstChild : dom.window.document.body.lastElementChild.firstChild
          const before = node.data
          if (afterApply) run({ action: 'stop', token: 'eligibility', href })
          else assert.equal(run({ action: 'apply', token: 'eligibility', href, items: [translated] }).applied, 0)
          assert.equal(node.data, before)
        } finally { dom.window.close() }
      }
    })
  }
  test('translates guest text in place without changing code, forms, URLs or editables', () => {
    const { dom, run } = page()
    try {
      const start = run({ action: 'start', token: 'one' })
      const batch = run({ action: 'collect', token: 'one', href: start.href })
      assert.deepEqual(Array.from(batch.items, x => x.text), ['Get started', 'Read the documentation'])
      run({ action: 'apply', token: 'one', href: start.href, items: batch.items.map(x => ({ ...x, out: `Русский ${x.text}` })) })
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Русский Get started')
      assert.equal(dom.window.document.querySelector('input').value, 'Password')
      assert.equal(dom.window.document.querySelector('code').textContent, 'npm install nexus')
      assert.equal(dom.window.document.querySelector('form button').textContent, 'Submit order')
      assert.equal(run({ action: 'collect', token: 'one', href: start.href }).items.length, 0)
      run({ action: 'stop', token: 'one', href: start.href })
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Get started')
    } finally { dom.window.close() }
  })
  test('rejects changed source, token and same-origin navigation; discovers dynamic content', () => {
    const { dom, run } = page()
    try {
      const { href } = run({ action: 'start', token: 'two' })
      const batch = run({ action: 'collect', token: 'two', href })
      dom.window.document.querySelector('h1').firstChild.data = 'New heading'
      run({ action: 'apply', token: 'two', href, items: batch.items.map(x => ({ ...x, out: 'Старый перевод' })) })
      assert.equal(dom.window.document.querySelector('h1').textContent, 'New heading')
      dom.window.document.body.insertAdjacentHTML('beforeend', '<p>Dynamic readme content</p>')
      assert.ok(run({ action: 'collect', token: 'two', href }).items.some(x => x.text === 'Dynamic readme content'))
      assert.equal(run({ action: 'apply', token: 'wrong', href, items: [] }).stale, true)
      dom.window.history.pushState({}, '', '/other')
      assert.equal(run({ action: 'apply', token: 'two', href, items: [] }).stale, true)
    } finally { dom.window.close() }
  })
  test('stop only restores owned values and prevents late application', () => {
    const { dom, run } = page()
    try {
      const { href } = run({ action: 'start', token: 'three' })
      const batch = run({ action: 'collect', token: 'three', href })
      run({ action: 'apply', token: 'three', href, items: batch.items.map(x => ({ ...x, out: 'Русский текст' })) })
      dom.window.document.querySelector('h1').firstChild.data = 'Framework update'
      run({ action: 'stop', token: 'three', href })
      assert.equal(dom.window.document.querySelector('h1').textContent, 'Framework update')
      assert.equal(dom.window.document.querySelector('p').textContent, 'Read the documentation')
      assert.equal(run({ action: 'apply', token: 'three', href, items: batch.items }).stale, true)
    } finally { dom.window.close() }
  })
}
