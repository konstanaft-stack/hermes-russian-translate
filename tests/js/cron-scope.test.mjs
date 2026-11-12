import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { collectCronRoots, isCronText, CRON_UI } from '../../src/frontend/cron-scope.mjs'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const fixture = `<div data-panel-row="blueprint-weekly-review"><span class="font-medium">Weekly review</span></div>
<div data-panel-row="user-job"><span>Private task title</span></div>
<div role="dialog"><h2>New scheduled job</h2><form>
 <label for="cron-template">Start from</label><button id="cron-template" role="combobox" data-slot="select-trigger" aria-controls="template-menu"><span data-slot="select-value">Weekly review</span></button>
 <p>A weekly recap: what got done and what is coming up.</p>
 <label for="blueprint-weekly-review-day">Which day?</label><button id="blueprint-weekly-review-day" role="combobox" data-slot="select-trigger" aria-controls="day-menu"><span data-slot="select-value">sunday</span></button>
 <input id="cron-name" value="Private task name"><textarea id="cron-prompt">Private prompt</textarea><code>0 8 * * 1</code>
 <label for="cron-model">Model</label><button id="cron-model" role="combobox" data-slot="select-trigger" aria-controls="model-menu"><span data-slot="select-value">Private model name</span></button>
 <button type="submit">Schedule</button>
</form></div>
<div id="template-menu" role="listbox" data-slot="select-content"><div role="option" data-value="weekly-review"><span>Weekly review</span></div></div>
<div id="day-menu" role="listbox" data-slot="select-content"><div role="option" data-value="sunday"><span>sunday</span></div></div>
<div id="model-menu" role="listbox" data-slot="select-content"><div role="option" data-value="model-key"><span>Private model name</span></div></div>`
const dom = () => new JSDOM(fixture, { url:'file:///C:/app/index.html#/cron' })
test('covers real blueprint rows, editor labels/hints and only linked template/day selects', () => {
 const s=dom(), d=s.window.document
 try {
  const roots=collectCronRoots(d)
  assert.equal(roots.size,4)
  for (const selector of ['[data-panel-row^="blueprint-"] span','label[for="cron-template"]','[role="dialog"] p','#cron-template span','#blueprint-weekly-review-day span','#template-menu [role="option"] span','#day-menu [role="option"] span']) {
   assert.equal(isCronText(d.querySelector(selector).firstChild,d),true,selector)
  }
  for (const selector of ['[data-panel-row="user-job"] span','textarea','code','#cron-model span','#model-menu span']) assert.equal(isCronText(d.querySelector(selector).firstChild,d),false,selector)
  assert.equal(d.querySelector('input').value,'Private task name')
  assert.equal(d.querySelector('#day-menu [role="option"]').getAttribute('data-value'),'sunday')
  assert.equal(CRON_UI.get('Weekly review'),'Еженедельный обзор')
  assert.equal(CRON_UI.get('sunday'),'воскресенье')
 } finally { s.window.close() }
})
test('does not touch other routes, dialogs, editable content or hidden select copies', () => {
 const s=dom(), d=s.window.document
 try {
  d.body.insertAdjacentHTML('beforeend','<div role="dialog"><p>Unrelated settings</p></div><select aria-hidden="true"><option>Weekly review</option></select>')
  assert.equal(isCronText(d.querySelector('select option').firstChild,d),false)
  assert.equal(isCronText(d.querySelectorAll('[role="dialog"]')[1].querySelector('p').firstChild,d),false)
  d.querySelector('[role="dialog"] p').setAttribute('contenteditable','true')
  assert.equal(isCronText(d.querySelector('[role="dialog"] p').firstChild,d),false)
  s.window.location.hash='/capabilities?tab=tools'
  assert.equal(collectCronRoots(d).size,0)
  assert.equal(isCronText(d.querySelector('label').firstChild,d),false)
 } finally {s.window.close()}
})
