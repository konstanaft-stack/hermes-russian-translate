/** Display-only Cron blueprint surface. Does not read or change job form values. */
export const CRON_UI = new Map(Object.entries({
  'Morning briefing':'Утренний обзор', 'Important mail monitor':'Проверка важных писем',
  'Weekly review':'Еженедельный обзор', 'Weekday start reminder':'Напоминание о начале рабочего дня',
  'Custom reminder':'Своё напоминание', 'Evening wind-down':'Вечернее подведение итогов',
  'Topic news digest':'Обзор новостей по теме', 'Bills & renewals reminder':'Напоминание об оплате и продлении',
  'Price & availability watch':'Отслеживание цены и наличия', 'Competitor news watch':'Новости конкурентов',
  'Habit check-in':'Проверка привычек', 'Hydration & movement nudge':'Напоминание о воде и разминке',
  'Weekly meal plan':'План питания на неделю', 'Daily learning drip':'Ежедневное обучение',
  'Gratitude & reflection prompt':'Благодарность и размышления', 'On-this-day discovery':'Этот день в истории',
  'What time?':'Во сколько?', 'Which day?':'В какой день?', 'Where to deliver?':'Куда отправить результат?',
  '24h local time, e.g. 08:00':'Местное время в 24-часовом формате, например 08:00',
  'monday':'понедельник', 'tuesday':'вторник', 'wednesday':'среда', 'thursday':'четверг',
  'friday':'пятница', 'saturday':'суббота', 'sunday':'воскресенье',
  'Monday':'Понедельник', 'Tuesday':'Вторник', 'Wednesday':'Среда', 'Thursday':'Четверг',
  'Friday':'Пятница', 'Saturday':'Суббота', 'Sunday':'Воскресенье',
  'Start from':'Начать с', 'New scheduled job':'Новая запланированная задача',
  'Schedule':'Запланировать', 'Cancel':'Отмена', 'This desktop':'Это приложение',
  'Bot Chat (default)':'Чат бота (по умолчанию)',
  "A weekly recap: what got done, what's still open, and what's coming up.":'Итоги недели: что сделано, что ещё осталось и что предстоит.'
}))
const PRIVATE = 'input,textarea,select,option,pre,code,kbd,samp,script,style,svg,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-hermes-ru-translator]'
const EDITOR_CONTROL = '#cron-template,#cron-name,#cron-prompt'
const isAllowedSelect = el => el?.matches('[data-slot="select-trigger"]') && (el.id === 'cron-template' || el.id.startsWith('blueprint-'))

function cronRoute(doc) {
  const win=doc.defaultView
  return new URL(win.location.hash.slice(1) || win.location.pathname,'http://hermes.invalid').pathname === '/cron'
}
function editors(doc) {
  return [...doc.querySelectorAll('[role="dialog"]')].filter(root => root.querySelector(EDITOR_CONTROL))
}
function selectScopes(doc, dialogs) {
  const scopes=new Set()
  for (const dialog of dialogs) {
    for (const trigger of dialog.querySelectorAll('[data-slot="select-trigger"][aria-controls]')) {
      if (!isAllowedSelect(trigger)) continue
      for (const id of trigger.getAttribute('aria-controls').split(/\s+/)) {
        const content=doc.getElementById(id)
        if (content?.matches('[data-slot="select-content"],[role="listbox"]')) scopes.add(content)
      }
    }
  }
  return scopes
}
export function collectCronRoots(doc) {
  if (!cronRoute(doc)) return new Set()
  const dialogs=editors(doc)
  return new Set([...doc.querySelectorAll('[data-panel-row^="blueprint-"]'),...dialogs,...selectScopes(doc,dialogs)])
}
export function isCronText(node,doc) {
  const el=node?.parentElement
  if (!cronRoute(doc) || !node.isConnected || !el || el.closest(PRIVATE)) return false
  const row=el.closest('[data-panel-row^="blueprint-"]')
  if (row) return Boolean(el.closest('span.font-medium'))
  const dialogs=editors(doc)
  const menu=el.closest('[data-slot="select-content"],[role="listbox"]')
  if (menu) return selectScopes(doc,dialogs).has(menu) && Boolean(el.closest('[data-slot="select-item"],[role="option"]'))
  const dialog=el.closest('[role="dialog"]')
  if (!dialogs.includes(dialog)) return false
  const trigger=el.closest('[data-slot="select-trigger"]')
  if (trigger) return isAllowedSelect(trigger) && Boolean(el.closest('[data-slot="select-value"]'))
  return Boolean(el.closest('label,p,h1,h2,h3,h4,button:not([role="combobox"])'))
}
