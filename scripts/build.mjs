import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const allowed = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime']
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/frontend/plugin.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('../desktop/plugin.js', import.meta.url)),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  charset: 'utf8', legalComments: 'eof', external: allowed, metafile: true
})
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => !allowed.includes(item.path))) throw new Error('Unexpected runtime import')
}
console.log('Built desktop/plugin.js from source')
