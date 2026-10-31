import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { periodOf, shortDate, somText, todayIn } from '../lib/time'
import { AppointmentPanel } from '../schedule/AppointmentPanel'

type Me = Schemas['BookingViewsMe']
type Debt = Schemas['PaymentQueryDebt']

const METHODS: Record<string, string> = { CASH: 'Наличные', TRANSFER: 'Перевод', CARD: 'Карта' }

type Period = 'day' | 'week' | 'month' | 'custom'

/**
 * «Касса»: выручка за период (по способам и по дням), «К оплате на кассе» и долги — таблицами.
 * Нажать на строку — карточка приёма справа с оплатой, как в «Расписании». Права — как на
 * сервере: всю клинику видит админ (если врачи не независимы), врач — свою; «К оплате» —
 * регистратура и клиники с регистратурой.
 */
export function CashPage({ me }: { me: Me }) {
  const seesAll = Boolean(me.admin && !me.clinic?.independentDoctors)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Чья касса: админ выбирает (пусто — вся клиника), врач — всегда своя
  const [doctorId, setDoctorId] = useState<number | null>(seesAll ? null : me.doctorId ?? null)
  const money = seesAll || me.doctorId != null
  const toPayShown = Boolean(me.reception || me.hasReception)

  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState(periodOf('month'))
  const range = period === 'custom' ? custom : periodOf(period)
  const [opened, setOpened] = useState<number | null>(null)
  const close = useCallback(() => setOpened(null), [setOpened])

  const doctorQuery = doctorId == null ? {} : { doctorId }
  const revenue = useQuery({
    queryKey: ['revenue', range.from, range.to, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...range, ...doctorQuery } } })),
    enabled: money && range.from <= range.to,
  })
  const debts = useQuery({
    queryKey: ['debts', 'cash', doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: doctorQuery } })),
    enabled: money,
  })
  const toPay = useQuery({
    queryKey: ['to-pay'],
    queryFn: () => unwrap(api.GET('/api/appointments/to-pay')),
    enabled: toPayShown,
  })

  const r = revenue.data
  const max = Math.max(1, ...(r?.days ?? []).map((d) => d.totalSom ?? 0))

  return (
    <div className={opened ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main cash">
        <header className="toolbar">
          <h1>Касса</h1>
          {seesAll && doctors.length > 1 && (
            <select aria-label="Чья касса" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Вся клиника</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          )}
        </header>

        {toPayShown && (
          <section className="card-block">
            <h2>💳 К оплате на кассе</h2>
            <DebtTable rows={toPay.data} pending={toPay.isPending} error={toPay.error?.message} empty="Никто не ждёт оплаты"
              money="chargeSom" onOpen={setOpened} active={opened} label="К оплате на кассе" />
          </section>
        )}

        {money && (
          <section className="card-block">
            <div className="block-head">
              <h2>Выручка</h2>
              <div className="segments" role="group" aria-label="Период">
                {([['day', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['custom', 'Период']] as const).map(([key, title]) => (
                  <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{title}</button>
                ))}
              </div>
            </div>
            {period === 'custom' && (
              <div className="row dates">
                <label className="field"><span>С</span>
                  <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
                </label>
                <label className="field"><span>По</span>
                  <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
                </label>
              </div>
            )}
            {revenue.error && <p className="error">{revenue.error.message}</p>}
            {r && (
              <>
                <p className="total" aria-label="Выручка за период">{somText(r.totalSom ?? 0)}</p>
                <p className="hint">
                  Оплачено приёмов: {r.paidCount ?? 0}
                  {r.unpaidCount ? <span className="tone-wait"> · без оплаты: {r.unpaidCount}</span> : null}
                  {Object.entries(r.byMethod ?? {}).filter(([, v]) => v).map(([k, v]) => ` · ${METHODS[k] ?? k}: ${somText(v)}`).join('')}
                </p>
                {(r.days?.length ?? 0) > 1 && (
                  <div className="bars" role="img" aria-label="Выручка по дням">
                    {r.days!.map((d) => (
                      <div key={d.date} className="bar" title={`${shortDate(`${d.date}T12:00:00Z`)}: ${somText(d.totalSom ?? 0)}`}>
                        <span style={{ height: `${((d.totalSom ?? 0) / max) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {money && (
          <section className="card-block">
            <h2>Долги пациентов {debts.data?.length ? `· ${somText(debts.data.reduce((s, d) => s + (d.debtSom ?? 0), 0))}` : ''}</h2>
            <DebtTable rows={debts.data} pending={debts.isPending} error={debts.error?.message} empty="Долгов нет"
              money="debtSom" onOpen={setOpened} active={opened} label="Долги пациентов" />
          </section>
        )}

        {!money && !toPayShown && <p className="hint">Касса — у администратора и врачей.</p>}
      </section>
      {opened && <OpenedAppointment id={opened} me={me} onClose={close} />}
    </div>
  )
}

function DebtTable({ rows, pending, error, empty, money, onOpen, active, label }: {
  rows?: Debt[]
  pending: boolean
  error?: string
  empty: string
  money: 'chargeSom' | 'debtSom'
  onOpen: (id: number) => void
  active: number | null
  label: string
}) {
  if (pending) return <p className="hint">Загрузка…</p>
  if (error) return <p className="error">{error}</p>
  if (!rows?.length) return <p className="hint">{empty}</p>
  const today = todayIn()
  return (
    <table className="table" aria-label={label}>
      <thead>
        <tr><th>Пациент</th><th>Приём</th><th>Врач</th><th>Услуга</th><th className="r">{money === 'debtSom' ? 'Долг' : 'Сумма'}</th>{money === 'debtSom' && <th>Доплатит до</th>}</tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.appointmentId} className={d.appointmentId === active ? 'active' : undefined}>
            <td><button type="button" className="row-link" onClick={() => onOpen(d.appointmentId!)}>{d.patient}</button></td>
            <td className="nowrap">{d.startAt ? shortDate(d.startAt, true) : ''}</td>
            <td>{d.doctor}</td>
            <td className="hint">{d.service ?? '—'}</td>
            <td className="nowrap strong num r">{somText(d[money] ?? 0)}</td>
            {money === 'debtSom' && (
              <td className={`nowrap${d.dueOn && d.dueOn < today ? ' tone-bad' : ''}`}>
                {d.dueOn ? shortDate(`${d.dueOn}T12:00:00Z`) : '—'}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Приём из строки таблицы — с сервера, и карточка с оплатой справа. */
function OpenedAppointment({ id, me, onClose }: { id: number; me: Me; onClose: () => void }) {
  const a = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}', { params: { path: { id } } })),
  })
  if (a.isPending) return <aside className="panel" aria-label="Карточка приёма"><p className="hint">Загрузка…</p></aside>
  if (a.error) return <aside className="panel" aria-label="Карточка приёма"><p className="error">{a.error.message}</p></aside>
  return <AppointmentPanel appointment={a.data} me={me} onClose={onClose} />
}
