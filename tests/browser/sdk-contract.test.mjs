import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const root = process.env.HERMES_DESKTOP_SOURCE
const require = createRequire(import.meta.url)
test('optional Hermes source checkout exposes the preview API', {skip: !root}, () => {
  const preview = readFileSync(root + 'src/contrib/plugin-preview.ts', 'utf8')
  const areas = readFileSync(root + 'src/sdk/areas.ts', 'utf8')
  assert.match(preview, /executeJavaScript: \(code: string\)/)
  assert.match(preview, /isAvailable: \(\) => boolean/)
  assert.match(preview, /ensurePreviewScriptConsent\(pluginId, name, origin\)/)
  assert.match(preview, /return run\(originGuarded\(origin, code\)\)/)
  assert.match(areas, /right: 'titleBar.right'/)
})
test('browser module bundles for runtime with only sanctioned external imports', async () => {
  // Build against this repository's pinned development dependencies.
  const { build } = require('esbuild')
  const allowed = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
  const result = await build({ entryPoints: [new URL('../../src/browser/register.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, external: allowed, metafile: true })
  const imports = Object.values(result.metafile.outputs).flatMap(value => value.imports.map(item => item.path))
  assert.ok(imports.every(path => allowed.includes(path)))
  assert.ok(result.outputFiles[0].text.includes('registerBrowserTranslation'))
})
