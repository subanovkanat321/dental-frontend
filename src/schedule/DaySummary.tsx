import { useState } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { somText, timeOf } from '../lib/time'
import { initials } from '../lib/avatars'
import { statusOf } from './status'
import type { Earnings } from '../earnings/earnings'
import { EarningsSummary } from '../earnings/EarningsWidgets'
import { OnDuty } from '../team/OnDuty'

type Appointment = Schemas['AppointmentView']

export type FreeOf = { doctorId: number; name: string; color: string; minutes: number; first: number | null; canBook: boolean }

/** 150 → «2 ч 30 мин», 45 → «45 мин». */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин'
}

/**
 * Сводка дня справа от сетки (широкий экран, карточка приёма закрыта): кто следующий, что требует
 * действия, сколько свободного времени у врачей и выручка дня. Тот же ряд «Требует внимания», что над
 * сеткой на ноутбуке поуже, — только столбиком; нажатие ведёт туда же. Когда открыта карточка
 * приёма, она занимает это место.
 */
export function DaySummary({ date, today, all, doctorName, requests, waiting, toPay, revenueSom, earnings, onOpenEarnings, low, free, onOpen: openProp, onBook: bookProp, onNavigate: navigateProp, onClose }: {
  date: string
  today: string
  /** Приёмы дня без отменённых */
  all: Appointment[]
  doctorName: (id?: number) => string
  requests: Appointment[]
  waiting: Appointment[]
  toPay: number
  revenueSom: number | null
  /** «Мой заработок» врача (только у врача со своим креслом), null — не показываем */
  earnings?: Earnings | null
  onOpenEarnings?: () => void
  low: number
  free: FreeOf[]
  onOpen: (a: Appointment) => void
  onBook: (doctorId: number, minutes: number) => void
  onNavigate?: (page: Page) => void
  /** «×» вверху: скрыть сводку — колонки врачей на весь экран */
  onClose?: () => void
}) {
  // «На весь экран» — пока смотрят; открыли приём, запись или раздел — сводка снова сбоку
  const [full, setFull] = useState(false)
  const onOpen = (a: Appointment) => { setFull(false); openProp(a) }
  const onBook = (doctorId: number, minutes: number) => { setFull(false); bookProp(doctorId, minutes) }
  const onNavigate = navigateProp && ((page: Page) => { setFull(false); navigateProp(page) })
  const now = new Date().toISOString()
  const sorted = [...all].sort((a, b) => a.startAt!.localeCompare(b.startAt!))
  const isToday = date === today
  const open = sorted.filter((a) => a.status === 'SCHEDULED' || a.status === 'REQUESTED')
  const next = isToday ? open.find((a) => a.startAt! > now) : open[0]
  const current = isToday ? sorted.filter((a) => a.status === 'SCHEDULED' && a.startAt! <= now && a.endAt! > now) : []
  const done = all.filter((a) => a.status === 'DONE').length
  const first = (list: Appointment[]) => () => {
    const a = [...list].sort((x, y) => x.startAt!.localeCompare(y.startAt!))[0]
    if (a) onOpen(a)
  }
  const calm = !requests.length && !waiting.length && !toPay && !low

  return (
    <>
    {full && <div className="panel-backdrop" onClick={() => setFull(false)} aria-hidden="true" />}
    <aside className={full ? 'day-summary ds-full' : 'day-summary'} aria-label="Сводка дня">
      <button type="button" className="ds-expand" aria-pressed={full} onClick={() => setFull(!full)}
        aria-label={full ? 'Свернуть сводку' : 'Сводка на весь экран'} title={full ? 'Свернуть' : 'На весь экран'}>{full ? '⤡' : '⤢'}</button>
      {onClose && (
        <button type="button" className="ds-close" aria-label="Скрыть сводку" title="Скрыть сводку — больше места врачам" onClick={onClose}>×</button>
      )}
      <section className="ds-block">
        <h2 className="ds-title">{isToday ? 'Следующий пациент' : 'Первый приём'}</h2>
        {current.map((a) => (
          <button key={a.id} type="button" className="ds-next now" onClick={() => onOpen(a)}>
            <span className="ds-next-time num">сейчас · до {timeOf(a.endAt!)}</span>
            <span className="ds-next-name">{a.patient?.fullName}</span>
            <span className="hint small">{doctorName(a.doctorId)}{a.serviceName ? ` · ${a.serviceName}` : ''}</span>
          </button>
        ))}
        {next ? (
          <button type="button" className={`ds-next s-${statusOf(next).kind}`} onClick={() => onOpen(next)}>
            <span className="ds-next-time num">{timeOf(next.startAt!)}–{timeOf(next.endAt!)}</span>
            <span className="ds-next-name">{next.patient?.fullName}</span>
            <span className="ds-next-meta">{doctorName(next.doctorId)}{next.serviceName ? ` · ${next.serviceName}` : ''}</span>
            <span className="ds-next-state"><span aria-hidden="true">{statusOf(next).icon}</span> {statusOf(next).label}</span>
          </button>
        ) : (
          <p className="hint ds-empty">{isToday ? 'Больше записей на сегодня нет' : 'Записей нет'}</p>
        )}
        <dl className="ds-counts">
          <div><dt>Записей</dt><dd className="num">{all.length}</dd></div>
          <div><dt>Состоялось</dt><dd className="num">{done}</dd></div>
          <div><dt>Впереди</dt><dd className="num">{isToday ? open.filter((a) => a.startAt! > now).length : open.length}</dd></div>
        </dl>
      </section>
      <OnDuty date={date} />

      <section className="ds-block">
        <h2 className="ds-title">Требует внимания</h2>
        <div className="ds-stats" role="group" aria-label="Требует внимания">
          {requests.length > 0 && (
            <button type="button" className="stat s-request" onClick={first(requests)}>
              <b>{requests.length}</b> {requests.length === 1 ? 'заявка из бота' : 'заявки из бота'} — подтвердить
            </button>
          )}
          {waiting.length > 0 && (
            <button type="button" className="stat s-wait" onClick={first(waiting)}>
              <b>{waiting.length}</b> ждём ответа на напоминание
            </button>
          )}
          {toPay > 0 && (
            <button type="button" className="stat s-cashier" onClick={() => onNavigate?.('cash')}>
              <b>{toPay}</b> ждут оплаты на кассе
            </button>
          )}
          {low > 0 && (
            <button type="button" className="stat s-wait" onClick={() => onNavigate?.('stock')}>
              <b>{low}</b> на складе заканчивается
            </button>
          )}
          {calm && <span className="stat s-quiet calm">Всё под контролем: заявок и срочных дел нет</span>}
        </div>
      </section>

      {free.length > 0 && (
        <section className="ds-block">
          <h2 className="ds-title">Свободно {isToday ? 'сегодня' : 'в этот день'}</h2>
          <ul className="ds-free">
            {free.map((f) => (
              <li key={f.doctorId}>
                <span className="avatar" style={{ background: f.color }} aria-hidden="true">{initials(f.name)}</span>
                <span className="ds-free-text">
                  <span className="ds-free-name">{f.name}</span>
                  <span className="hint small">{f.minutes ? `${duration(f.minutes)} свободно` : 'свободных окон нет'}</span>
                </span>
                {f.canBook && f.first != null && (
                  <button type="button" className="btn small" aria-label={`Записать к врачу ${f.name} на ${String(Math.floor(f.first / 60)).padStart(2, '0')}:${String(f.first % 60).padStart(2, '0')}`}
                    onClick={() => onBook(f.doctorId, f.first!)}>
                    ＋ <span className="num">{String(Math.floor(f.first / 60)).padStart(2, '0')}:{String(f.first % 60).padStart(2, '0')}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Сегодняшний день, а не выбранный: заработок — «сегодня» и «за месяц» */}
      {earnings && <EarningsSummary e={earnings} onOpen={onOpenEarnings} />}

      {revenueSom != null && (
        <button type="button" className="ds-block ds-money" onClick={() => onNavigate?.('cash')}>
          <span className="ds-title">Выручка {isToday ? 'сегодня' : 'за день'}</span>
          <span className="ds-money-sum">{somText(revenueSom)}</span>
          <span className="hint small">по приёмам · открыть «Кассу» ›</span>
        </button>
      )}
    </aside>
    </>
  )
}
