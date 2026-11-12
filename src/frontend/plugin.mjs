import { atom, useValue, TITLEBAR_AREAS, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'
import { createPluginsTranslator } from './adapter.mjs'
import { registerBrowserTranslation, BROWSER_TRANSLATION_CAPABILITY } from '../browser/register.mjs'

const LEGACY_PROFILE = { id: 'q8', label: 'HY-MT Q8', device: 'gpu', role: 'Точный перевод' }

export default {
  id: 'hermes-ru-translator',
  name: 'Hermes Russian Translate',
  capabilities: [BROWSER_TRANSLATION_CAPABILITY],
  register(ctx) {
    const state = atom({ enabled: true, active: false, busy: false, translated: 0, error: '', loaded: false, paused: true, engineBusy: 'checking', engineError: '', profiles: [LEGACY_PROFILE], selected: 'q8', variant: 'q8', device: 'gpu' })
    const patch = next => state.set({ ...state.get(), ...next })
    let translator = null
    let activeEpoch = ''
    let disposed = false
    let wanted = true
    let desiredInitialized = false
    const applyStatus = status => {
      if (disposed) return
      if (!status || typeof status.loaded !== 'boolean' || typeof status.cache_epoch !== 'string' || !status.cache_epoch) throw new Error('Invalid translator status')
      const offered = Array.isArray(status.profiles) ? status.profiles : [LEGACY_PROFILE]
      const enabledIds = Array.isArray(status.enabled_variants) ? new Set(status.enabled_variants) : null
      const profiles = offered.filter(profile => profile && typeof profile.id === 'string' && typeof profile.label === 'string' && (!enabledIds || enabledIds.has(profile.id)))
      const variant = typeof status.variant === 'string' ? status.variant : 'q8'
      let selected = desiredInitialized ? state.get().selected : variant
      if (!profiles.some(profile => profile.id === selected)) selected = profiles[0]?.id || ''
      desiredInitialized = true
      patch({ loaded: status.loaded, variant, selected, profiles, device: status.device || 'gpu', model: status.model_label || status.model || 'HY-MT2 Q8', engineError: '' })
      if (!translator || activeEpoch !== status.cache_epoch) {
        translator?.dispose()
        activeEpoch = status.cache_epoch
        translator = createPluginsTranslator({
          document, cacheStorage: ctx.storage, cacheEngine: activeEpoch,
          cacheKey: `public-catalog-ru-${activeEpoch}`, engineLoaded: status.loaded,
          rest: (path, options) => ctx.rest(path, options), onState: patch
        })
        translator.setEnabled(wanted)
      } else translator.setEngineLoaded(status.loaded)
    }
    const toggle = () => {
      wanted = !wanted
      patch({ enabled: wanted })
      translator?.setEnabled(wanted)
    }
    const changeEngine = async () => {
      const current = state.get()
      if (disposed || current.engineBusy || !current.profiles.some(profile => profile.id === current.selected)) return
      const loading = !current.loaded || current.variant !== current.selected
      const switching = current.loaded && loading
      patch({ engineBusy: switching ? 'switching' : loading ? 'loading' : 'unloading', engineError: '' })
      translator?.setEngineLoaded(false)
      try {
        const status = await ctx.rest(loading ? '/engine/start' : '/engine/stop', {
          method: 'POST', ...(loading ? { body: { variant: current.selected } } : {}), timeoutMs: 180000
        })
        if (!disposed) applyStatus(status)
      } catch {
        if (!disposed) {
          translator?.setEngineLoaded(false)
          patch({ engineError: loading ? 'Не удалось загрузить переводчик. Повторите загрузку.' : 'Не удалось подтвердить выгрузку переводчика.' })
        }
      } finally { if (!disposed) patch({ engineBusy: '' }) }
    }
    function Controls() {
      const current = useValue(state)
      const device = String(current.device).toUpperCase()
      const selectedProfile = current.profiles.find(profile => profile.id === current.selected)
      const selectedLabel = selectedProfile?.label || 'Переводчик'
      const matching = current.loaded && current.variant === current.selected
      const label = !current.enabled ? 'Перевод: выкл.'
        : current.error ? 'Перевод: ошибка'
        : current.paused ? `Перевод: пауза · ${device}`
        : !current.active ? `Перевод: готов · ${device}`
        : current.busy ? `Перевод: ${current.pending}… · ${device}` : `Перевод: русский · ${device}`
      const engineLabel = current.engineBusy === 'checking' ? 'Проверяю модель…'
        : current.engineBusy === 'loading' ? `${selectedLabel}: загружаю…`
        : current.engineBusy === 'switching' ? `${selectedLabel}: переключаю…`
        : current.engineBusy === 'unloading' ? `${selectedLabel}: выгружаю…`
        : matching ? `${selectedLabel}: выгрузить`
        : current.loaded ? `${selectedLabel}: переключить` : `${selectedLabel}: загрузить`
      const className = 'inline-flex h-7 shrink-0 items-center rounded px-2 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
      return jsx('div', {
        'data-hermes-ru-translator': true, className: 'inline-flex items-center gap-1',
        style: { WebkitAppRegion: 'no-drag' },
        children: [
          jsx('button', {
            type: 'button', 'aria-pressed': current.enabled,
            'aria-label': `${label}. ${current.enabled ? 'Выключить' : 'Включить'} перевод плагинов, навыков и задач по расписанию`,
            title: current.error || 'Перевод плагинов, навыков и задач. Инструменты и чат не переводятся. Готовые переводы доступны и после выгрузки модели.',
            className, onClick: toggle, children: label
          }, 'translation'),
          jsx('select', {
            'aria-label': 'Модель переводчика', value: current.selected,
            disabled: Boolean(current.engineBusy) || !current.profiles.length,
            title: `${selectedProfile?.role || 'Выбор модели'}; выбор не запускает модель. Сейчас: ${current.model || 'не загружена'} · ${device}`,
            className: 'h-7 max-w-44 rounded px-1 text-[0.6875rem] text-(--ui-text-secondary)',
            onChange: event => patch({ selected: event.target.value }),
            children: current.profiles.map(profile => jsx('option', { value: profile.id, children: `${profile.label} · ${String(profile.device || 'gpu').toUpperCase()}` }, profile.id))
          }, 'profile'),
          jsx('button', {
            type: 'button', 'data-hermes-ru-engine': true, disabled: Boolean(current.engineBusy) || !selectedProfile,
            'aria-label': engineLabel,
            title: current.engineError || `Только локальная модель переводчика. Сейчас: ${current.model || 'не загружена'} · ${device}. Основная модель чата не меняется.`,
            className, onClick: changeEngine, children: current.engineError ? `${engineLabel} · ошибка` : engineLabel
          }, 'engine')
        ]
      })
    }
    ctx.register({ id: 'toggle', area: TITLEBAR_AREAS.right, order: 130, render: () => jsx(Controls, {}) })
    ctx.register({
      id: 'toggle-command', area: PALETTE_AREA,
      data: {
        id: 'hermes-ru-translator.toggle', label: 'Включить / выключить русский перевод плагинов, навыков и задач',
        keywords: ['plugins', 'skills', 'cron', 'translate', 'перевод', 'русский', 'плагины', 'навыки', 'задачи'],
        detail: () => state.get().enabled ? 'включено' : 'выключено', detailVariant: 'state', run: toggle
      }
    })
    if (typeof ctx.preview?.executeJavaScript === 'function' && typeof ctx.preview?.isAvailable === 'function') registerBrowserTranslation(ctx)
    ctx.onDispose(() => { disposed = true; translator?.dispose() })
    // Reading status never loads a model. Only the explicit engine control calls start.
    void ctx.rest('/status', { method: 'GET', timeoutMs: 15000 }).then(status => {
      if (!disposed) { applyStatus(status); patch({ engineBusy: '' }) }
    }).catch(() => { if (!disposed) patch({ engineBusy: '', engineError: 'Не удалось проверить локальный переводчик. Нажмите загрузку для повтора.' }) })
  }
}
