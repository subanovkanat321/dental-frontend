import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { changeOf } from '../lib/compare'
import { saveCsv } from '../lib/csv'
import { shortDate, somText } from '../lib/time'
import { Select } from '../layout/Select'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { HeadTools } from '../layout/PageHead'

type Analytics = Schemas['PlatformAnalyticsAnalytics']

const PERIODS = [7, 30, 90, 365] as const

const STEPS: Record<string, string> = {
  CREATED: 'Заведена',
  ADMIN: 'Руководитель пришёл по ссылке',
  CONFIGURED: 'Настроена: врач и часы',
  FIRST_VISIT: 'Первый приём',
  MONTH: 'Работает месяц после первого приёма',
  PAID: 'Оплатила',
}

const FEATURES: Record<string, string> = {
  BOT: 'Самозапись в боте',
  WEB: 'Запись с сайта',
  REMINDERS: 'Напоминания пациентам',
  PLAN: 'План лечения пациенту',
  QUESTIONS: 'Вопросы пациентов',
  PHOTOS: 'Фото до / после',
  CASH: 'Касса: отмечают оплаты',
  STOCK: 'Склад',
  PUSH: 'Пуш-уведомления сотрудникам',
}

const DUE: Record<string, [string, string]> = {
  PILOT_ENDS: ['Кончается пилот', 'tone-wait'],
  PAID_ENDS: ['Кончается оплата', 'tone-wait'],
  OVERDUE: ['Просрочена', 'tone-bad'],
}

const PLAN: Record<string, string> = { PILOT: 'пилот', PAYING: 'платит', OVERDUE: 'просрочила' }

const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shortMonth = (m: string) => MONTH_SHORT.format(new Date(`${m}-01T00:00:00Z`)).replace('.', '')
const longMonth = (m: string) => MONTH_LONG.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** Доля в процентах; из нуля — «—». */
function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}

function Block({ title, label, hint, csv, children }: {
  title: string
  label: string
  hint?: ReactNode
  csv?: () => void
  children: ReactNode
}) {
  return (
    <section className="card-block chart" aria-label={label}>
      <div className="stats-head">
        <h2>{title}</h2>
        {csv && <button type="button" className="btn ghost small" onClick={csv}>CSV</button>}
      </div>
      {hint && <p className="hint small">{hint}</p>}
      {children}
    </section>
  )
}

/**
 * «Платформа → Аналитика» (только владелец): по блоку на решение — сколько клиник и сколько
 * платят, кому звонить про оплату, кто уходит, где теряем новых, откуда клиники, растут ли деньги,
 * держатся ли клиники, чем пользуются. Считает сервер (/api/platform/analytics) — здесь только рисуем.
 */
export function AnalyticsTab() {
  const [days, setDays] = useState<number>(30)
  const [city, setCity] = useState('')
  const query = useQuery({
    queryKey: ['platform-analytics', days, city],
    queryFn: () => unwrap(api.GET('/api/platform/analytics', { params: { query: { days, city: city || undefined } } })),
  })
  const a = query.data
  return (
    <>
      <HeadTools>
        <div className="analytics-filter" role="group" aria-label="Период и город">
          <div className="segments">
            {PERIODS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? 'Год' : `${d} дней`}</button>
            ))}
          </div>
          <Select aria-label="Город" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Все города</option>
            {(a?.cities ?? (city ? [city] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      </HeadTools>
      {query.error && <p className="error">{query.error.message}</p>}
      {query.isPending ? <Loading /> : a && <Report a={a} />}
    </>
  )
}

function Report({ a }: { a: Analytics }) {
  const s: Partial<NonNullable<Analytics['summary']>> = a.summary ?? {}
  const period = a.days === 365 ? 'за год' : `за ${a.days} дней`
  const change = changeOf(s.appointments ?? 0, s.appointmentsBefore ?? 0)
  if (!s.clinics) return <EmptyState fill title={a.city ? 'В этом городе клиник нет' : 'Клиник пока нет'} />
  return (
    <>
      <section className="card-block" aria-label="Сводка">
        <div className="survey-tiles">
          <Tile title="Клиник" value={s.clinics} />
          <Tile title="Работают" value={s.working ?? 0} note="приёмы за 7 дней" />
          <Tile title="В пилоте" value={s.pilot ?? 0} />
          <Tile title="Платят" value={s.paying ?? 0} />
          <Tile title="Просрочили" value={s.overdue ?? 0} tone={s.overdue ? 'tone-bad' : undefined} />
          <Tile title="В месяц (MRR)" value={somText(s.mrrSom ?? 0)} hero />
          <Tile title={`Приёмов ${period}`} value={s.appointments ?? 0}
            note={<span className={`tone-${change.tone}`}>{change.text}</span>} />
        </div>
      </section>
      <DueBlock a={a} />
      <RiskBlock a={a} />
      <FunnelBlock a={a} period={period} />
      <GeoBlock a={a} period={period} />
      <MoneyBlock a={a} />
      <CohortBlock a={a} />
      <FeaturesBlock a={a} period={period} />
      <PatientsBlock a={a} period={period} />
    </>
  )
}

function Tile({ title, value, note, tone, hero }: { title: string; value: ReactNode; note?: ReactNode; tone?: string; hero?: boolean }) {
  return (
    <div className={hero ? 'survey-tile hero' : 'survey-tile'}>
      <span className="hint">{title}</span>
      <b className={tone}>{value}</b>
      {note && <span className="hint small">{note}</span>}
    </div>
  )
}

function dueText(d: Schemas['PlatformAnalyticsDue']): string {
  const left = d.daysLeft
  return left < 0 ? `${-left} дн. назад` : left === 0 ? 'сегодня' : `через ${left} дн.`
}

/** Кому звонить про оплату: пилот или оплата кончаются в 30 дней, или уже просрочено. */
function DueBlock({ a }: { a: Analytics }) {
  const due = a.money?.due ?? []
  const csv = () => saveCsv('оплата-кому-звонить', [['Клиника', 'Город', 'Что', 'Дата', 'Тариф', 'Сом в месяц', 'Приёмов за период'],
    ...due.map((d) => [d.name ?? '', d.city ?? '', DUE[d.kind ?? '']?.[0] ?? '', d.date ?? '', d.tariff ?? '', d.monthSom, d.appointments])])
  return (
    <Block title="Кому звонить про оплату" label="Кому звонить про оплату" csv={due.length ? csv : undefined}
      hint="Пилот или оплата заканчиваются в ближайшие 30 дней, или срок уже прошёл. Пилот без даты — по акции с подключения.">
      {due.length ? (
        <div className="table-scroll">
          <table className="table" aria-label="Оплата: кому звонить">
            <thead><tr><th>Клиника</th><th>Что</th><th>Когда</th><th>Тариф</th><th>Приёмов</th><th>Заходили</th></tr></thead>
            <tbody>
              {due.map((d) => {
                const [title, tone] = DUE[d.kind ?? ''] ?? ['', '']
                return (
                  <tr key={d.clinicId}>
                    <td>{d.name}<span className="hint"> · {d.city}</span></td>
                    <td className={tone}>{title}{d.payPending ? <span className="hint"> · сообщила об оплате</span> : null}</td>
                    <td className="nowrap">{d.date ? shortDate(d.date) : ''}<span className="hint"> · {dueText(d)}</span></td>
                    <td className="nowrap">{d.tariff}<span className="hint"> · {somText(d.monthSom)}</span></td>
                    <td className="num">{d.appointments}</td>
                    <td className="hint nowrap">{d.staffSeenAt ? shortDate(d.staffSeenAt) : 'ни разу'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="hint">В ближайшие 30 дней ни у кого не кончается.</p>}
    </Block>
  )
}

/** Кто уходит: причины по каждой клинике; платящие — сверху. */
function RiskBlock({ a }: { a: Analytics }) {
  const risks = a.risks ?? []
  const csv = () => saveCsv('клиники-риск', [['Клиника', 'Город', 'Оплата', 'Приёмов 2 недели', 'Приёмов 2 недели до', 'Причины'],
    ...risks.map((r) => [r.name ?? '', r.city ?? '', PLAN[r.plan ?? ''] ?? '', r.last14, r.prev14, (r.reasons ?? []).map((x) => x.text).join('; ')])])
  return (
    <Block title="Кто может уйти" label="Риск ухода" csv={risks.length ? csv : undefined}
      hint="Клиники старше двух недель: не заходят неделю, не было приёмов, приёмов заметно меньше, чем две недели назад.">
      {risks.length ? (
        <div className="table-scroll">
          <table className="table" aria-label="Клиники в зоне риска">
            <thead><tr><th>Клиника</th><th>Почему</th><th>Приёмов: 2 нед. / до</th></tr></thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.clinicId}>
                  <td>{r.name}<span className="hint"> · {r.city} · {PLAN[r.plan ?? '']}</span></td>
                  <td className="tone-bad">{(r.reasons ?? []).map((x) => x.text).join('; ')}</td>
                  <td className="num nowrap">{r.last14} / {r.prev14}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tone-ok">Все клиники работают ровно.</p>}
    </Block>
  )
}

/** Воронка клиник, заведённых за период: где теряем новых. */
function FunnelBlock({ a, period }: { a: Analytics; period: string }) {
  const steps = a.funnel?.steps ?? []
  const apps: Partial<NonNullable<NonNullable<Analytics['funnel']>['applications']>> = a.funnel?.applications ?? {}
  const first = steps[0]?.clinics ?? 0
  return (
    <Block title="Где теряем новые клиники" label="Воронка клиник"
      hint={<>Заявок с сайта {period}: <b>{apps.total ?? 0}</b> — одобрено {apps.approved ?? 0}, отклонено {apps.rejected ?? 0}, ждут {apps.waiting ?? 0}.
        Ниже — клиники, заведённые {period}; поздние шаги набираются со временем — смотрите период длиннее.</>}>
      {first ? (
        <ul className="hbars" aria-label="Шаги воронки">
          {steps.map((step, i) => {
            const n = step.clinics
            const prev = i ? steps[i - 1]?.clinics ?? 0 : n
            return (
              <li key={step.key} title={`${STEPS[step.key ?? '']}: ${n}`}>
                <span className="hbar-name">{STEPS[step.key ?? '']}</span>
                <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${(n / first) * 100}%` }} /></span>
                <span className="hbar-value num">{n}{i > 0 && prev > 0 && <span className="hint"> · {pct(n, prev)}</span>}</span>
              </li>
            )
          })}
        </ul>
      ) : <p className="hint">Новых клиник {period} не заводили.</p>}
    </Block>
  )
}

function GeoBlock({ a, period }: { a: Analytics; period: string }) {
  const rows = a.geography ?? []
  const csv = () => saveCsv('клиники-по-городам', [['Город', 'Клиник', 'Работают', 'Платят', 'Пациентов', `Заявок ${period}`],
    ...rows.map((r) => [r.city ?? '', r.clinics, r.working, r.paying, r.patients, r.applications])])
  return (
    <Block title="Города" label="Клиники по городам" csv={csv}
      hint="Все города, без фильтра. Заявки из города без клиник — спрос, куда идти дальше.">
      <div className="table-scroll">
        <table className="table" aria-label="Клиники по городам">
          <thead><tr><th>Город</th><th>Клиник</th><th>Работают</th><th>Платят</th><th>Пациентов</th><th>Заявок {period}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.city}>
                <td>{r.city}</td><td className="num">{r.clinics}</td><td className="num">{r.working}</td>
                <td className="num">{r.paying}</td><td className="num">{r.patients}</td><td className="num">{r.applications}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

/** Оплаты по месяцам — столбики; MRR на конец месяца — подписью. */
function MoneyBlock({ a }: { a: Analytics }) {
  const months = a.money?.months ?? []
  const max = Math.max(1, ...months.map((m) => m.paidSom))
  const [picked, setPicked] = useState(months.length - 1)
  const m = months[picked]
  const csv = () => saveCsv('оплаты-по-месяцам', [['Месяц', 'Оплачено, сом', 'Оплат', 'MRR, сом'],
    ...months.map((x) => [x.month ?? '', x.paidSom, x.payments, x.mrrSom])])
  return (
    <Block title="Деньги по месяцам" label="Оплаты по месяцам" csv={csv}
      hint="Столбик — сколько клиники заплатили в месяце. MRR — сколько в месяц приносят оплаты, срок которых идёт: годовая оплата — 1/12 в каждый месяц.">
      {!months.some((x) => x.paidSom) ? <EmptyState compact title="Оплат за год ещё не было" /> : <>
      <div className="vbars" role="img" aria-label={months.map((x) => `${longMonth(x.month ?? '')}: ${somText(x.paidSom)}`).join('; ')}>
        {months.map((x, k) => (
          <button key={x.month} type="button" className={k === picked ? 'vbar picked' : 'vbar'} onClick={() => setPicked(k)}
            title={`${longMonth(x.month ?? '')}: ${somText(x.paidSom)}`}>
            <span className="vbar-value num">{x.paidSom ? Math.round((x.paidSom) / 1000) || '<1' : ''}</span>
            <span className="vbar-fill" style={{ height: `${(x.paidSom / max) * 100}%` }} />
            <span className="vbar-label">{shortMonth(x.month ?? '')}</span>
          </button>
        ))}
      </div>
      {m && <p className="hint small">{longMonth(m.month ?? '')}: оплачено <b className="num">{somText(m.paidSom)}</b>
        {m.payments ? ` · оплат ${m.payments}` : ''} · MRR <b className="num">{somText(m.mrrSom)}</b> · подписи столбиков — тыс. сом</p>}
      </>}
    </Block>
  )
}

/** Когорты по месяцу подключения: держатся ли клиники. */
function CohortBlock({ a }: { a: Analytics }) {
  const rows = a.cohorts ?? []
  if (!rows.length) return null
  const cell = (c?: Schemas['PlatformAnalyticsCell']) => (c?.eligible ? `${pct(c.active, c.eligible)} (${c.active} из ${c.eligible})` : '—')
  const csv = () => saveCsv('когорты', [['Подключились', 'Клиник', 'Через 1 мес', 'Через 2 мес', 'Через 3 мес'],
    ...rows.map((r) => [r.month ?? '', r.clinics, ...[0, 1, 2].map((k) => cell(r.after?.[k]))])])
  return (
    <Block title="Держатся ли клиники" label="Когорты клиник" csv={csv}
      hint="Месяц подключения и доля клиник, у которых были приёмы через 1, 2 и 3 месяца. «—» — ещё не дожили.">
      <div className="table-scroll">
        <table className="table" aria-label="Когорты по месяцу подключения">
          <thead><tr><th>Подключились</th><th>Клиник</th><th>Через 1 мес</th><th>Через 2 мес</th><th>Через 3 мес</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td>{longMonth(r.month ?? '')}</td><td className="num">{r.clinics}</td>
                {[0, 1, 2].map((k) => <td key={k} className="num nowrap">{cell(r.after?.[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

/** Чем пользуются: доля клиник с приёмами за период. */
function FeaturesBlock({ a, period }: { a: Analytics; period: string }) {
  const f: Partial<NonNullable<Analytics['features']>> = a.features ?? {}
  const active = f.activeClinics ?? 0
  const items = [...(f.items ?? [])].sort((x, y) => y.clinics - x.clinics)
  return (
    <Block title="Чем пользуются" label="Использование функций"
      hint={!active ? 'Какие функции включают клиники, у которых были приёмы.' : <>Из {active} клиник с приёмами {period}. Пациенты записались сами (бот и сайт): <b>{pct(f.selfBooked ?? 0, f.appointments ?? 0)}</b> приёмов.{f.aiBooked ? <> ИИ записал: <b>{f.aiBooked}</b>.</> : null}</>}>
      {active ? (
        <ul className="hbars" aria-label="Функции">
          {items.map((x) => (
            <li key={x.key} title={`${FEATURES[x.key ?? '']}: ${x.clinics} из ${active}`}>
              <span className="hbar-name">{FEATURES[x.key ?? ''] ?? x.key}</span>
              <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${(x.clinics / active) * 100}%` }} /></span>
              <span className="hbar-value num">{pct(x.clinics, active)}<span className="hint"> · {x.clinics}</span></span>
            </li>
          ))}
        </ul>
      ) : <p className="hint">Приёмов {period} не было.</p>}
    </Block>
  )
}

function PatientsBlock({ a, period }: { a: Analytics; period: string }) {
  const p: Partial<NonNullable<Analytics['patients']>> = a.patients ?? {}
  const months = p.newByMonth ?? []
  const max = Math.max(1, ...months.map((m) => m.count))
  const visits = (p.done ?? 0) + (p.noShow ?? 0)
  return (
    <Block title="Пациенты платформы" label="Пациенты платформы"
      hint="Только числа — без имён и телефонов.">
      <div className="survey-tiles">
        <Tile title="Пациентов" value={p.total ?? 0} />
        <Tile title="Подключили бота" value={pct(p.withBot ?? 0, p.total ?? 0)} note={`${p.withBot ?? 0}`} />
        <Tile title={`Неявки ${period}`} value={pct(p.noShow ?? 0, visits)} note={`${p.noShow ?? 0} из ${visits}`} />
      </div>
      {/* Ни одного нового пациента за год — не рисуем двенадцать пустых столбиков на полэкрана */}
      {!months.some((m) => m.count) ? <EmptyState compact title="Новых пациентов за год ещё не было" /> : <>
      <p className="hint small">Новых пациентов по месяцам</p>
      <div className="vbars" role="img" aria-label={months.map((m) => `${longMonth(m.month ?? '')}: ${m.count}`).join('; ')}>
        {months.map((m) => (
          <span key={m.month} className="vbar" title={`${longMonth(m.month ?? '')}: ${m.count}`}>
            <span className="vbar-value num">{m.count || ''}</span>
            <span className="vbar-fill" style={{ height: `${(m.count / max) * 100}%` }} />
            <span className="vbar-label">{shortMonth(m.month ?? '')}</span>
          </span>
        ))}
      </div>
      </>}
    </Block>
  )
}
