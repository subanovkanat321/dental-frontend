import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { openMine, openSettings } from '../lib/route'
import { telegram } from '../lib/telegram'
import { appInstalled } from '../pwa/pwa'
import { WEEK } from '../team/texts'

type Me = Schemas['BookingViewsMe']

/** «Что настроить» над расписанием закрыли крестиком — помним на этом устройстве (не ПДн). */
export const SETUP_HINT_CLOSED = 'crm.setupHintClosed'

/** «Пн–Сб, 09:00–18:00»: новой клинике часы ставятся сами (пн–сб) — показать, какие, чтобы проверили. */
function hoursText(c?: Schemas['ClinicView']): string {
  if (!c?.workDays?.length || !c.workStart || !c.workEnd) return 'Заданы'
  const on = WEEK.filter(([code]) => c.workDays!.includes(code))
  const run = on.length > 1 && WEEK.findIndex(([code]) => code === on.at(-1)![0]) - WEEK.findIndex(([code]) => code === on[0]![0]) === on.length - 1
  const days = on.length === 7 ? 'Без выходных' : run ? `${on[0]![2]}–${on.at(-1)![2]}` : on.map(([, , short]) => short).join(', ')
  return `${days}, ${c.workStart.slice(0, 5)}–${c.workEnd.slice(0, 5)}`
}

/**
 * Пункт «Что настроить». `optional` — по желанию («Пригласите коллег (если есть)»): не сделан — знак «+», не ✗.
 */
export type Step = { key: string; done: boolean; optional?: boolean; title: string; hint: string; open: () => void }

/**
 * Что настроить новой клинике — руководителю. Шага «Показать пациентам» у саморегистрации нет (с 2026-11-16):
 * клиника сразу открыта по своей ссылке и в боте. Остался он только у клиник, заведённых на платформе
 * (settingUp, V95) — их «Показать пациентам» в «О клинике». Кто зарегистрировал клинику — руководитель и врач:
 * «Врачи» не спрашиваем, пока работающий врач есть; «Пригласите коллег» — по желанию; «Установите приложение» —
 * ✓, если открыто как приложение (в Telegram — не показываем: там Tish уже как приложение).
 */
export function useSetupSteps(me: Me) {
  const shown = Boolean(me.admin && me.clinic)
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: shown })
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: shown })
  const hours = Boolean(me.clinic?.ownHours)
  const active = (services.data ?? []).filter((s) => s.active !== false)
  const prices = active.some((s) => s.priceSom != null)
  const working = (me.doctors ?? []).filter((d) => d.active !== false)
  const doctors = working.length > 0
  const colleagues = working.length > 1
  const steps: Step[] = [
    { key: 'hours', done: hours, title: 'Часы работы', hint: hours ? `${hoursText(clinic.data)} — поменяйте, если работаете иначе` : 'Сейчас — часы по умолчанию: проверьте дни и время', open: () => openSettings('hours') },
    { key: 'services', done: prices, title: 'Услуги с ценами', hint: prices ? `Услуг: ${active.length}` : 'Типовой список без цен: уберите лишнее, поставьте цены', open: () => openSettings('services') },
  ]
  if (!doctors) steps.push({ key: 'doctors', done: false, title: 'Врачи', hint: 'Добавьте хотя бы одного врача — иначе записать не к кому', open: () => openSettings('doctors') })
  steps.push({ key: 'staff', done: colleagues, optional: true, title: 'Пригласите коллег (если есть)', hint: colleagues ? `Врачей: ${working.length}` : 'Врачи, регистратура, ассистенты — «+ Добавить сотрудника»', open: () => openSettings('staff') })
  if (telegram() == null) {
    const app = appInstalled()
    steps.push({ key: 'app', done: app, title: 'Установите приложение', hint: app ? 'Tish уже на экране' : 'Значок Tish на экране телефона или компьютера', open: () => openMine('me', 'install') })
  }
  return { shown, steps, done: steps.filter((s) => s.done).length, clinic, doctors }
}
