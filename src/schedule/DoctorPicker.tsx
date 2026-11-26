import { useQueries } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { DoctorFilter } from '../layout/DoctorFilter'
import { doctorOptions } from '../layout/doctorOptions'
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

/**
 * Чьё расписание (телефон; компьютер — больше 6 врачей): общий выбор врача (layout/DoctorFilter.tsx) — кнопка
 * с выбранным врачом, список карточками: фото или инициалы, имя, «я», сколько записей в выбранный день, заявки
 * из бота; «Все врачи» — последним. Здесь — только своё для расписания: счётчики, «показано 4 из 10», 📅 и
 * «Врачи в расписании…».
 */
export function DoctorPicker({ me, doctors, view, date, onChange, colorDoctors = doctors, onOrder, shownCount, compact = false, onCalendar }: {
  me: Me
  /** Врачи в порядке на экране (schedule/doctorOrder.ts) */
  doctors: Doctor[]
  view: View
  date: string
  onChange: (view: View) => void
  /** Врачи клиники в исходном порядке — по ним цвет врача (colorOf), он не зависит от порядка */
  colorDoctors?: Doctor[]
  /** «Врачи в расписании…» — окно с галочками и ↑ ↓ */
  onOrder?: () => void
  /** Сколько врачей колонками в «Все врачи» (скрытые и выходные — не в счёт): меньше всех — «Врачи: 4 из 10» */
  shownCount?: number
  /** Компьютер, больше 6 врачей: кнопка в строке над сеткой вместо ряда чипов */
  compact?: boolean
  /** 📅 рядом с выбранным врачом — его мини-календарь на месяц (DoctorCalendar); у «Все врачи» кнопки нет */
  onCalendar?: (doctorId: number) => void
}) {
  // Сколько записей у каждого врача в этот день — тот же запрос, что у ленты дней раньше
  const counts = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['counts', d.id, date, 1],
      queryFn: () => unwrap(api.GET('/api/appointments/counts', { params: { query: { from: date, days: 1, doctorId: d.id } } })),
      staleTime: 60_000,
    })),
  })
  const booked = (i: number) => counts[i]?.data?.[0]?.booked ?? 0
  const requested = (i: number) => counts[i]?.data?.[0]?.requested ?? 0
  const total = doctors.reduce((sum, _, i) => sum + booked(i), 0)
  const day = date === todayIn() ? 'сегодня' : 'в этот день'
  const index = doctors.findIndex((d) => d.id === view)
  // Записей — по всем врачам (как в заголовке дня), а «из скольких» — сколько колонок на экране
  const partial = shownCount != null && shownCount < doctors.length
  const options = doctorOptions(doctors, { me, colorDoctors, sub: (_, i) => `${appointmentsText(booked(i))} ${day}` })
    .map((o, i) => (requested(i) > 0 ? { ...o, badge: <span className="chip small s-request" title="Заявки из бота">🆕 {requested(i)}</span> } : o))

  return (
    <DoctorFilter label="Чьё расписание" options={options} value={view === 'all' ? null : view} onChange={(next) => onChange(next ?? 'all')}
      variant={compact ? 'pill' : 'card'} className={compact ? 'compact' : undefined}
      buttonSub={`${appointmentsText(index >= 0 ? booked(index) : total)} ${day}`}
      all={{
        sub: `${appointmentsText(total)} ${day}${partial ? ` · показано ${shownCount} из ${doctors.length}` : ''}`,
        buttonName: partial ? `Врачи: ${shownCount} из ${doctors.length}` : undefined,
        buttonLabel: `Все врачи${partial ? `, показано ${shownCount} из ${doctors.length}` : ''}`,
      }}
      side={onCalendar && index >= 0 ? (close) => (
        <button type="button" className="pick-calendar" aria-haspopup="dialog" aria-label={`Календарь врача: ${doctors[index]!.fullName ?? ''}`}
          title="Рабочие дни и свободное время на месяц" onClick={() => { close(); onCalendar(doctors[index]!.id) }}>📅</button>
      ) : undefined}
      footer={onOrder ? (close) => (
        <button type="button" className="pick-order" onClick={() => { close(); onOrder() }}>
          <span aria-hidden="true">⇅</span> Врачи в расписании…
        </button>
      ) : undefined} />
  )
}
