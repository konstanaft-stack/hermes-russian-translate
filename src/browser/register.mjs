import { atom, useValue, TITLEBAR_AREAS } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'
import { createBrowserTranslator } from './controller.mjs'

/** Merge capability into the SAME default plugin export. No new plugin id. */
export const BROWSER_TRANSLATION_CAPABILITY = 'preview.executeJavaScript'

export function registerBrowserTranslation(ctx, options = {}) {
  const state = atom({
    available: Boolean(ctx.preview?.isAvailable?.()),
    active: false,
    busy: false,
    translated: 0,
    error: '',
    href: '',
  })
  const patch = (next) => state.set({ ...state.get(), ...next })
  const translator = createBrowserTranslator(ctx, {
    ...options,
    onState: (next) => {
      patch(next)
      options.onState?.(next)
    },
  })
  const refreshAvailability = () => {
    const available = Boolean(ctx.preview?.isAvailable?.())
    if (available !== state.get().available) patch({ available })
  }
  const stopAvailability = ctx.setInterval(refreshAvailability, 800)
  function BrowserTranslationButton() {
    const current = useValue(state)
    if (!current.available) return null
    let host = ''
    try {
      host = current.href ? new URL(current.href).hostname : ''
    } catch {}
    const label = current.error
      ? 'Перевод сайта: ошибка'
      : current.busy
        ? `Перевод сайта: ${current.translated}…`
        : current.active
          ? 'Оригинал сайта'
          : 'Перевести сайт'
    return jsx('button', {
      type: 'button',
      'data-hermes-ru-browser-translation': true,
      'aria-label': label,
      'aria-pressed': current.active,
      title:
        current.error ||
        `Перевод текста активной страницы встроенного браузера на месте${host ? ` · ${host}` : ''}. Локальный переводчик. Оригинал возвращается этой же кнопкой.`,
      className:
        'inline-flex h-7 shrink-0 items-center rounded px-2 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)',
      style: { WebkitAppRegion: 'no-drag' },
      onClick: () => void translator.toggle(),
      children: label,
    })
  }
  const unregister = ctx.register({
    id: 'browser-translation-button',
    area: TITLEBAR_AREAS.right,
    order: 60,
    render: () => jsx(BrowserTranslationButton, {}),
  })
  const dispose = () => {
    stopAvailability()
    unregister()
    void translator.dispose()
  }
  ctx.onDispose(dispose)
  return { ...translator, dispose }
}
