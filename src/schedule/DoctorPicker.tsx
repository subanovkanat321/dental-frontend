import { useQueries } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { AVATARS, initials } from '../lib/avatars'
import { useBack } from '../lib/back'
import { todayIn } from '../lib/time'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorView']
type View = number | 'all'

/** «1 запись», «3 записи», «5 записей». */
function appointmentsText(n: number): string {
  const ten = n % 10
  const hundred = n % 100
  const word = ten === 1 && hundred !== 11 ? 'запись' : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? 'записи' : 'записей'
  return n ? `${n} ${word}` : 'записей нет'
}

function Avatar({ doctor, index }: { doctor: Doctor; index: number }) {
  return doctor.photoUrl
    ? <img className="pick-avatar" src={doctor.photoUrl} alt="" />
    : <span className="pick-avatar" style={{ background: AVATARS[index % AVATARS.length] }} aria-hidden="true">{initials(doctor.fullName)}</span>
}

/**
 * Чьё расписание (телефон, много врачей): кнопка с выбранным врачом, нажать — список врачей
 * карточками: фото или инициалы, имя, «я», сколько записей в выбранный день, заявки из бота;
 * «Все врачи» — последним. Свой список вместо системного: у системного — только текст.
 */
export function DoctorPicker({ me, doctors, view, date, onChange }: {
  me: Me
  doctors: Doctor[]
  view: View
  date: string
  onChange: (view: View) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useBack(open ? () => setOpen(false) : null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  // Сколько записей у каждого врача в этот день — тот же запрос, что у ленты дней раньше
  const counts = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['counts', d.id, date, 1],
      queryFn: () => unwrap(api.GET('/api/appointments/counts', { params: { query: { from: date, days: 1, doctorId: d.id! } } })),
      staleTime: 60_000,
    })),
  })
  const booked = (i: number) => counts[i]?.data?.[0]?.booked ?? 0
  const requested = (i: number) => counts[i]?.data?.[0]?.requested ?? 0
  const total = doctors.reduce((sum, _, i) => sum + booked(i), 0)
  const day = date === todayIn() ? 'сегодня' : 'в этот день'
  const index = doctors.findIndex((d) => d.id === view)
  const current = index >= 0 ? doctors[index] : undefined
  const pick = (next: View) => {
    onChange(next)
    setOpen(false)
  }
  const nameOf = (d: Doctor) => `${d.fullName ?? ''}${d.id === me.doctorId ? ' (я)' : ''}`

  return (
    <div ref={root} className="doctor-picker">
      <button type="button" className="pick-current" aria-haspopup="listbox" aria-expanded={open} aria-label={`Чьё расписание: ${current ? nameOf(current) : 'Все врачи'}`}
        onClick={() => setOpen(!open)}>
        {current ? <Avatar doctor={current} index={index} /> : <span className="pick-avatar all" aria-hidden="true">👥</span>}
        <span className="pick-text">
          <strong>{current ? nameOf(current) : 'Все врачи'}</strong>
          <span className="hint">{appointmentsText(current ? booked(index) : total)} {day}</span>
        </span>
        <span className="pick-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="pick-list" role="listbox" aria-label="Чьё расписание">
          {doctors.map((d, i) => (
            <li key={d.id} role="option" aria-selected={view === d.id} onClick={() => pick(d.id!)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick(d.id!)} tabIndex={0}>
              <Avatar doctor={d} index={i} />
              <span className="pick-text">
                <strong>{nameOf(d)}</strong>
                <span className="hint">{appointmentsText(booked(i))} {day}</span>
              </span>
              {requested(i) > 0 && <span className="chip small s-request" title="Заявки из бота">🆕 {requested(i)}</span>}
              <span className="pick-check" aria-hidden="true">{view === d.id ? '✓' : ''}</span>
            </li>
          ))}
          <li role="option" aria-selected={view === 'all'} onClick={() => pick('all')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick('all')} tabIndex={0}>
            <span className="pick-avatar all" aria-hidden="true">👥</span>
            <span className="pick-text">
              <strong>Все врачи</strong>
              <span className="hint">{appointmentsText(total)} {day}</span>
            </span>
            <span className="pick-check" aria-hidden="true">{view === 'all' ? '✓' : ''}</span>
          </li>
        </ul>
      )}
    </div>
  )
}
