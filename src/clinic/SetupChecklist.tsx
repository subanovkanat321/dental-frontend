import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'
import { clinicRequest } from '../settings/clinicUpdate'
import { WEEK } from '../team/texts'

type Me = Schemas['BookingViewsMe']

/** «Пн–Сб, 09:00–18:00»: новой клинике часы ставятся сами (пн–сб) — показать, какие, чтобы проверили. */
function hoursText(c?: Schemas['ClinicView']): string {
  if (!c?.workDays?.length || !c.workStart || !c.workEnd) return 'Заданы'
  const on = WEEK.filter(([code]) => c.workDays!.includes(code))
  const run = on.length > 1 && WEEK.findIndex(([code]) => code === on.at(-1)![0]) - WEEK.findIndex(([code]) => code === on[0]![0]) === on.length - 1
  const days = on.length === 7 ? 'Без выходных' : run ? `${on[0]![2]}–${on.at(-1)![2]}` : on.map(([, , short]) => short).join(', ')
  return `${days}, ${c.workStart.slice(0, 5)}–${c.workEnd.slice(0, 5)}`
}

/**
 * Новая клиника ещё не видна пациентам (V95 бэкенда): админу — что настроить и кнопка «Показать
 * пациентам». Без работающего врача кнопка выключена (и сервер не даст: записаться не к кому);
 * часы и цены — только предупреждение: клиника может открыться и так.
 */
export function SetupChecklist({ me }: { me: Me }) {
  const client = useQueryClient()
  const shown = Boolean(me.admin && me.clinic?.settingUp)
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: shown })
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: shown })
  const open = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic', { body: clinicRequest(clinic.data!, { listed: true }) })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['clinic'] })
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  if (!shown) return null
  const hours = Boolean(me.clinic?.ownHours)
  const active = (services.data ?? []).filter((s) => s.active !== false)
  const prices = active.some((s) => s.priceSom != null)
  const doctors = (me.doctors ?? []).some((d) => d.active !== false)
  const steps: { done: boolean; title: string; hint: string; item: string }[] = [
    { done: hours, title: 'Часы работы', hint: hours ? `${hoursText(clinic.data)} — поменяйте, если работаете иначе` : 'Сейчас — часы по умолчанию: проверьте дни и время', item: 'hours' },
    { done: prices, title: 'Услуги с ценами', hint: prices ? `Услуг: ${active.length}` : 'Типовой список без цен: уберите лишнее, поставьте цены', item: 'services' },
    { done: doctors, title: 'Врачи', hint: doctors ? 'Есть кому записывать' : 'Добавьте хотя бы одного врача', item: 'doctors' },
  ]
  const error = open.error ? Object.values(open.error.fieldErrors)[0] ?? open.error.message : null
  return (
    <section className="card-block setup-checklist" aria-label="Настройка клиники">
      <h2>Клиника пока не видна пациентам</h2>
      <p className="hint">Настройте главное и нажмите «Показать пациентам» — тогда клиника появится в каталоге и в боте, по ссылке клиники можно будет записаться.</p>
      <ol className="setup-steps">
        {steps.map((s) => (
          <li key={s.item} className={s.done ? 'done' : 'todo'}>
            <span className="setup-mark" aria-label={s.done ? 'готово' : 'не сделано'}>{s.done ? '✓' : '✗'}</span>
            <button type="button" className="link" onClick={() => openSettings(s.item)}>{s.title}</button>
            <span className="hint"> — {s.hint}</span>
          </li>
        ))}
        <li>
          <span className="setup-mark" aria-hidden="true">4</span>
          <button type="button" className="btn primary" disabled={!doctors || !clinic.data || open.isPending} onClick={() => open.mutate()}>
            Показать пациентам
          </button>
          {!doctors && <span className="hint"> — сначала добавьте врача</span>}
          {doctors && (!hours || !prices) && <span className="tone-wait"> — часы или цены ещё по умолчанию, пациенты увидят их такими</span>}
        </li>
      </ol>
      <p className="hint">Пациенты и цены уже в таблице?{' '}
        <button type="button" className="link" onClick={() => openSettings('data')}>Загрузить из Excel</button> — перенесём без ручного ввода.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}
