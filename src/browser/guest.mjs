// Serialized into the consent-gated Browser guest, never run in the app DOM.
export function guestCommand(command) {
  const key = '__hermesRuPageTranslationV1'
  const href = window.location.href
  let state = window[key]
  // Eligibility is checked again at EVERY write, since a SPA can move an
  // unchanged Text node into an editor/form while translation is pending.
  const excluded =
    'script,style,noscript,template,code,pre,kbd,samp,input,textarea,select,option,form,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"],svg,canvas,iframe,[data-hermes-ru-page-control]'
  const visibility = new WeakMap()
  const visibleElement = (element) => {
    if (!element) return true
    if (visibility.has(element)) return visibility.get(element)
    const style = getComputedStyle(element)
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      visibleElement(element.parentElement)
    visibility.set(element, visible)
    return visible
  }
  const eligibleSource = (node, source) => {
    const parent = node.parentElement
    if (!node.isConnected || !parent || parent.closest(excluded) || !visibleElement(parent)) return false
    const trimmed = source.trim()
    if (!/[a-zA-Z]{2}/.test(trimmed) || /^(?:https?:\/\/|mailto:|file:|\/)/i.test(trimmed)) return false
    if (!/\s/.test(trimmed) && /[_/@\\]|\.[a-z0-9]{1,5}$/i.test(trimmed)) return false
    const link = parent.closest('a[href]')
    return !link || trimmed !== link.getAttribute('href')
  }
  const stop = () => {
    if (!state) return
    for (const item of state.entries.values()) {
      if (item.last !== null && item.node.data === item.last && eligibleSource(item.node, item.source))
        item.node.data = item.source
    }
    delete window[key]
  }
  if (command.action === 'status') return { token: state?.token || null, href }
  if (command.action === 'start') {
    // Reuse the snapshot without showing English again. Only explicit 'stop'
    // restores originals. No observer, lease or guest background work exists.
    if (state?.timer) clearInterval(state.timer)
    if (state?.stop) window.removeEventListener('pagehide', state.stop)
    state = state || { entries: new Map(), nodes: new WeakMap(), next: 1 }
    state.token = command.token
    state.href = href
    window[key] = state
    return { token: state.token, href }
  }
  if (!state || state.token !== command.token || state.href !== href || command.href !== href) return { stale: true }
  if (command.action === 'stop') {
    stop()
    return { stopped: true }
  }
  if (command.action === 'ping') return { alive: true }
  if (command.action === 'collect') {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    const items = []
    let chars = 0
    let node
    while ((node = walker.nextNode()) && items.length < 36 && chars < 7500) {
      const text = node.data
      if (!eligibleSource(node, text)) continue
      let item = state.nodes.get(node)
      if (!item || (node.data !== item.source && node.data !== item.last)) {
        if (item) state.entries.delete(item.id)
        item = { id: state.next++, node, source: text, last: null }
        state.nodes.set(node, item)
        state.entries.set(item.id, item)
      }
      if (item.last !== null && node.data === item.last) continue
      items.push({ id: item.id, text: item.source })
      chars += text.length
    }
    // Detached nodes must not retain entire old SPA screens indefinitely.
    for (const [id, item] of state.entries) if (!item.node.isConnected) state.entries.delete(id)
    return { token: state.token, href, items }
  }
  if (command.action === 'apply') {
    let applied = 0
    for (const translated of command.items || []) {
      const item = state.entries.get(translated.id)
      if (
        !item ||
        !eligibleSource(item.node, item.source) ||
        item.source !== translated.text ||
        item.node.data !== item.source ||
        typeof translated.out !== 'string' ||
        !translated.out.trim()
      )
        continue
      const leading = item.source.match(/^\s*/)[0]
      const trailing = item.source.match(/\s*$/)[0]
      item.last = leading + translated.out.trim() + trailing
      item.node.data = item.last
      applied++
    }
    return { applied }
  }
  return { error: 'Unknown page-translation command' }
}

export const guestScript = (command) => `(${guestCommand.toString()})(${JSON.stringify(command)})`
