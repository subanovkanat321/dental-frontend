import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { CHANNEL_LABELS } from '../lib/channels'
import { changeOf, datesText } from '../lib/compare'
import { somText } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { HBars } from './HBars'

const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long' })
const monthName = (m: string) => MONTH_LONG.format(new Date(`${m}-01T00:00:00Z`))

/** 1 новый пациент, 2 новых пациента, 5 новых пациентов. */
function patientsWord(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'новый пациент'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'новых пациента'
  return 'новых пациентов'
}

/**
 * «Пациенты от Tish» (бэкенд `/api/appointments/from-tish`, V232): одна крупная цифра — сколько новых пациентов за
 * месяц пришло через Tish (бот, Mini App, сайт, ссылки с меткой), под ней — сколько из них пришли на приём и
 * сколько заплатили, по каналам и в сравнении с прошлым месяцем (текущий месяц — с теми же днями). Только агрегаты,
 * считает сервер. Видит руководитель: в ответе выручка клиники.
 *
 * @param month 'YYYY-MM'; null — текущий месяц
 */
export function TishChart({ month }: { month: string | null }) {
  const data = useQuery({
    queryKey: ['from-tish', month],
    queryFn: () => unwrap(api.GET('/api/appointments/from-tish', { params: { query: month ? { month } : {} } })),
  })
  const r = data.data
  return (
    <section className="card-block chart tish" aria-label="Пациенты от Tish">
      <h2>Пациенты от Tish{r ? ` · ${monthName(r.month)}` : ''}</h2>
      {data.isPending ? <Loading /> : data.error ? <p className="error">{data.error.message}</p> : r && (
        <>
          <p className="tish-big" aria-label="Новых пациентов через Tish">
            <b className="num">{r.current.newPatients}</b>
            <span>{patientsWord(r.current.newPatients)} через Tish{r.partial ? ' — месяц идёт' : ''}</span>
          </p>
          <ul className="tish-facts" aria-label="Итоги месяца">
            <li>Пришли: <b>{r.current.came}</b></li>
            <li>Выручка: <b>{somText(r.current.revenueSom)}</b></li>
            {r.current.allNewPatients > 0 && <li className="hint">из всех новых: {r.current.newPatients} из {r.current.allNewPatients}</li>}
          </ul>
          <Returned r={r.returned} />
          <Compare now={r.current} was={r.previous} label={r.partial ? 'к тем же дням прошлого месяца' : 'к прошлому месяцу'}
            dates={datesText({ from: r.previousFrom, to: r.previousTo })} />
          {r.channels.length > 0 ? (
            <HBars label="Новые пациенты по каналам" format={(n) => `${n} чел.`}
              rows={r.channels.filter((c) => c.newPatients > 0).map((c) => ({
                name: CHANNEL_LABELS[c.channel], value: c.newPatients,
                note: `пришли ${c.came} · ${somText(c.revenueSom)} · раньше ${c.previousNewPatients}`,
              }))} />
          ) : null}
          {r.current.newPatients === 0 && (
            <EmptyState compact title="Пока никого через Tish">
              Поставьте ссылки записи в Instagram, 2ГИС и QR на ресепшн — «Клиника → О клинике → Ссылки для записи». Каждая со своей
              меткой: здесь будет видно, какая приводит пациентов.
            </EmptyState>
          )}
          <p className="hint small tish-how">
            Как считали: новый пациент — первый приём в клинике в этом месяце ({datesText({ from: r.from, to: r.to })}), а первую запись он
            сделал сам через Tish — бот, Mini App, сайт клиники или ссылку с меткой. Записанных по телефону регистратурой здесь нет.
            «Пришли» — был хотя бы один состоявшийся приём. Выручка — оплачено за их приёмы этого месяца. «Вернули» — прежние
            пациенты, которые записались не позже 30 дней после приглашения «Позвать снова» (от вас или от самого Tish), и
            оплачено за эти записи.
          </p>
        </>
      )}
    </section>
  )
}

/** 1 пациент, 2 пациента, 5 пациентов. */
function plainPatients(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'пациент'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'пациента'
  return 'пациентов'
}

/**
 * «Вернули: 3 пациента · 27 000 сом» (идея 2 «Рост клиник»): записались не позже 30 дней после приглашения «Позвать снова» —
 * сотрудника или самого Tish; деньги — оплачено за эти записи. Никого не звали — строки нет.
 */
function Returned({ r }: { r: Schemas['RecallResultsReturned'] }) {
  if (r.invited === 0 && r.patients === 0) return null
  return (
    <p className="tish-returned" aria-label="Вернули пациентов">
      Вернули: <b className="num">{r.patients}</b> {plainPatients(r.patients)} · <b className="num">{somText(r.revenueSom)}</b>
      <span className="hint small"> — позвали {r.invited}{r.autoInvited > 0 ? `, из них Tish сам — ${r.autoInvited}` : ''}, записались в течение 30 дней</span>
    </p>
  )
}

type Totals = { newPatients: number; came: number; revenueSom: number }

/** «▲ 25% к прошлому месяцу (было 4 · пришли 3 · 12 000 сом)». */
function Compare({ now, was, label, dates }: { now: Totals; was: Totals; label: string; dates: string }) {
  const change = changeOf(now.newPatients, was.newPatients)
  return (
    <p className="hint" aria-label="Сравнение с прошлым месяцем">
      <span className={`tone-${change.tone}`}>{change.text}</span> {label} ({dates}): было {was.newPatients}, пришли {was.came},{' '}
      {somText(was.revenueSom)}
    </p>
  )
}
