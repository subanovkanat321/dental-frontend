import { useEffect, useRef } from 'react'

import type { Schemas } from '../api/client'
import { timeOf, todayIn } from '../lib/time'
import { bookingDays, breakNote, type Lang, type T } from './i18n'

type Slots = Schemas['BookingViewsSlots']

/**
 * Свободное и занятое время одной сеткой по порядку: занятое — серым «занято», его не нажать.
 * Перерывы и выходной — подписью над сеткой, чтобы было понятно, куда делось время.
 * Общая для записи в Telegram (PatientApp) и на сайте (site/WebBooking).
 */
export function SlotGrid({ t, lang, slots, chosen, onPick, empty }: {
  t: T; lang: Lang; slots: Slots; chosen: string; onPick: (time: string) => void; empty: string
}) {
  const notes = [...(slots.breaks ?? []), ...(slots.dayOff ? [slots.dayOff] : [])]
  const cells = [
    ...(slots.starts ?? []).map((s) => ({ at: s, free: true })),
    ...(slots.taken ?? []).map((s) => ({ at: s, free: false })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <div className="slots" role="group" aria-label={t('freeTime')}>
      {notes.map((b, i) => <div key={i} className="break-note">{breakNote(lang, b)}</div>)}
      {slots.starts?.length ? cells.map(({ at, free }) => free ? (
        <button key={at} type="button" className="slot time" aria-pressed={timeOf(at) === chosen} onClick={() => onPick(timeOf(at))}>{timeOf(at)}</button>
      ) : (
        <button key={at} type="button" className="slot time taken" disabled aria-label={`${timeOf(at)} — ${t('busySlot')}`}>{timeOf(at)}<small>{t('busySlot')}</small></button>
      )) : <div className="hint">{empty}</div>}
    </div>
  )
}

/** Лента дней «Сегодня, Завтра, Ср 3…» на {@code length} дней; выбранный — по центру. */
export function DayStrip({ t, lang, length, date, onPick }: { t: T; lang: Lang; length: number; date: string; onPick: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed=true]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [date])
  return (
    <div ref={ref} className="days" role="group" aria-label={t('day')}>
      {bookingDays(lang, todayIn(), length).map((d) => (
        <button key={d.date} type="button" className="day" aria-pressed={d.date === date} onClick={() => onPick(d.date)}>{d.label}</button>
      ))}
    </div>
  )
}
