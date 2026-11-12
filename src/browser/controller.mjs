import { guestScript } from './guest.mjs'

// No app DOM reach, private bridge, navigation, external request or model startup.
export function createBrowserTranslator(ctx, { onState = () => {} } = {}) {
  let binding = null
  let generation = 0
  let disposed = false
  let starting = false
  let translated = 0
  const status = (patch) => onState({ active: Boolean(binding), translated, ...patch })
  const execute = (command) => ctx.preview.executeJavaScript(guestScript(command))
  const current = (expected, epoch) => !disposed && binding === expected && generation === epoch
  const release = () => {
    binding = null
    starting = false
    generation++
  }
  async function stop() {
    const old = binding
    release()
    // Explicit user 'Original' only. Automatic release/dispose never restores.
    if (old) {
      try {
        await execute({ ...old, action: 'stop' })
      } catch {}
    }
    status({ busy: false, error: '' })
  }
  async function scan(expected, epoch) {
    if (!current(expected, epoch)) return
    try {
      while (current(expected, epoch)) {
        const batch = await execute({ ...expected, action: 'collect' })
        if (!current(expected, epoch)) return
        if (batch?.stale) {
          release()
          status({ busy: false })
          return
        }
        if (!Array.isArray(batch?.items)) throw new Error('Не удалось прочитать текст страницы')
        if (!batch.items.length) {
          status({ busy: false, pending: 0, error: '' })
          return
        }
        for (let index = 0; index < batch.items.length; index++) {
          if (!current(expected, epoch)) return
          const item = batch.items[index]
          status({ busy: true, pending: batch.items.length - index, error: '' })
          let remaining = item.text
          let out = ''
          while (remaining.length) {
            let length = Math.min(12000, remaining.length)
            if (length < remaining.length) {
              const boundary = remaining.lastIndexOf(' ', length)
              if (boundary > 6000) length = boundary + 1
            }
            const chunk = remaining.slice(0, length)
            remaining = remaining.slice(length)
            const result = await ctx.rest('/translate', {
              method: 'POST',
              body: { texts: [chunk], lang: 'ru', engine: 'local' },
              timeoutMs: 180000,
            })
            if (!current(expected, epoch)) return
            if (!Array.isArray(result?.texts) || typeof result.texts[0] !== 'string' || !result.texts[0].trim())
              throw new Error('Некорректный ответ локального переводчика')
            out += chunk.match(/^\s*/)[0] + result.texts[0].trim() + chunk.match(/\s*$/)[0]
          }
          const applied = await execute({ ...expected, action: 'apply', items: [{ ...item, out }] })
          if (!current(expected, epoch)) return
          if (applied?.stale) {
            release()
            status({ busy: false })
            return
          }
          translated += applied?.applied || 0
        }
      }
    } catch (error) {
      if (!current(expected, epoch)) return
      status({ busy: false, error: error?.message || String(error) })
    }
  }
  async function start() {
    if (disposed || binding || starting) return
    if (!ctx.preview?.executeJavaScript || !ctx.preview?.isAvailable()) {
      status({ error: 'Откройте страницу во встроенном браузере' })
      return
    }
    const epoch = ++generation
    starting = true
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
    status({ busy: true, error: '' })
    try {
      const result = await execute({ action: 'start', token })
      if (disposed || generation !== epoch) return
      if (result?.token !== token || typeof result.href !== 'string') throw new Error('Не удалось привязать страницу')
      const expected = (binding = { token, href: result.href })
      starting = false
      translated = 0
      status({ busy: true, href: result.href, error: '' })
      await scan(expected, epoch)
    } catch (error) {
      if (!disposed && generation === epoch) {
        starting = false
        status({ busy: false, error: error?.message || String(error) })
      }
    }
  }
  return {
    start,
    stop,
    toggle: async () => {
      try {
        if (starting) return stop()
        if (binding) {
          // This probe occurs only on a user click. Selection may have changed
          // since completion; one click translates that new page rather than
          // attempting to restore an unrelated inactive page.
          const page = await execute({ action: 'status' })
          if (page?.token === binding.token && page?.href === binding.href) return stop()
          release()
        }
        return start()
      } catch (error) {
        release()
        status({ busy: false, error: error?.message || String(error) })
      }
    },
    dispose: async () => {
      release()
      disposed = true
    },
    getState: () => ({ active: Boolean(binding), translated }),
  }
}
