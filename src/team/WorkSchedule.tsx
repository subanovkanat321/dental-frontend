import { useQueries, useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { isAssistant } from '../lib/roles'
import { rowOpen } from '../lib/rowClick'
import { addDays, todayIn, weekLabel, weekStart } from '../lib/time'
import { useMedia } from '../lib/useMedia'
import { ClinicHoursCard } from '../settings/ClinicHours'
import { SubHeader } from '../settings/SubHeader'
import { AddStaffPanel } from './AddStaff'
import { useTimeOff, weeklyDaysOff } from './dayOffHours'
import { WeekEditor } from './HoursEditor'
import { CopyWeek, DayOffForm, ShiftForm, type DayOffEditing, type Editing } from './ShiftForms'
import { WEEK } from './texts'
import { plannedOn, weekdayOf } from './weekly'
import { dayHours, dayLong, offOnDate, SHIFT_ROLE, shiftHours, shortHours, weekSummary, type DayHours, type Who } from './workWeek'
import './shifts.css'

type Me = Schemas['BookingViewsMe']
type Schedule = Schemas['ShiftControllerSchedule']

/** «Обычная неделя» — шаблон каждого; «Неделя по датам» — конкретная неделя с исключениями поверх шаблона. */
export type ScheduleMode = 'template' | 'week'

/** Человек клиники в «Графике»: врач или сотрудник без кресла — одной строкой, роль серым. */
type Person = {
  key: string
  who: Who
  role: string
  /** Это вы — строка подсвечена */
  mine: boolean
  /** Можно менять его неделю и исключения на дату */
  canEdit: boolean
  /** false — «как у клиники»; undefined — ещё грузится */
  custom?: boolean
  hours?: DayHours
}

/** «пн 2» — шапка колонки дня. */
const dayShort = (date: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
  .format(new Date(`${date}T00:00:00Z`))

/**
 * Люди «Графика»: сначала врачи (их часы — doctor_hours: по ним свободное время в записи), потом персонал
 * без кресла (staff_hours и смены на даты). Права — как у прежних «Врачей» и «Смен персонала»: врачей
 * видит руководитель и регистратура (и меняют их часы), врач — только себя; персонал видят все, меняет
 * руководитель. Ассистент только смотрит.
 */
function usePeople(me: Me, data: Schedule | undefined): Person[] {
  const timeOff = useTimeOff()
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
    .filter((d) => me.admin || me.reception || d.id === me.doctorId)
  const hours = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['doctor-hours', d.id],
      queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: d.id } } })),
    })),
  })
  const editsDoctors = !isAssistant(me)
  return [
    ...doctors.map((d, i): Person => {
      const h = hours[i]?.data
      return {
        key: `d${d.id}`, who: { kind: 'doctor', id: d.id, name: d.fullName ?? '' }, role: 'врач', mine: d.id === me.doctorId,
        canEdit: editsDoctors && Boolean(me.admin || me.reception || d.id === me.doctorId),
        custom: h?.custom, hours: h && dayHours(h.days, weeklyDaysOff(timeOff.data, d.id)),
      }
    }),
    ...(data?.people ?? []).map((p): Person => {
      const w = (data?.weekly ?? []).find((x) => x.telegramId === p.telegramId)
      return {
        key: `s${p.telegramId}`, who: { kind: 'staff', telegramId: p.telegramId, name: p.fullName ?? '' }, role: SHIFT_ROLE[p.role ?? ''] ?? '',
        mine: p.telegramId === data?.me, canEdit: Boolean(data?.canEdit), custom: w ? w.custom : false, hours: dayHours(w?.days),
      }
    }),
  ]
}

/**
 * «Клиника → Рабочее время → График» — один график для всех людей клиники (с 2026-11-13, просьба владельца:
 * «у врачей своё время, а тут смены для других — сделаем универсальное»). Вверху часы клиники; «Обычная
 * неделя» — у каждого (врач и сотрудник вместе) дни и часы, нажатие на строку — редактор недели
 * ({@link WeekEditor}: сам сохранит врача в doctor_hours, сотрудника — в staff_hours). «Неделя по датам» —
 * сетка люди × дни: серым шаблон, поверх исключения на дату — смены сотрудника (staff_shift) и перерывы
 * или выходные врача («Перерывы и выходные» на дату: смен у врача модель не знает, он «не работает»).
 */
export function WorkSchedule({ me, mode, onMode, onTimeOff, title, onBack, tabs }: {
  me: Me; mode: ScheduleMode; onMode: (m: ScheduleMode) => void; onTimeOff: () => void; title: string; onBack: () => void; tabs: React.ReactNode
}) {
  const [monday, setMonday] = useState(() => weekStart(todayIn()))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const loaded = useQuery({
    queryKey: ['shifts', monday, days[6]!],
    queryFn: () => unwrap(api.GET('/api/shifts', { params: { query: { from: monday, to: days[6]! } } })),
  })
  const data = loaded.data
  const people = usePeople(me, data)
  const phone = useMedia('(max-width: 760px)')
  const [open, setOpen] = useState<string | null>(me.doctorId != null ? `d${me.doctorId}` : null)
  const [shift, setShift] = useState<Editing | null>(null)
  const [dayOff, setDayOff] = useState<DayOffEditing | null>(null)
  const [adding, setAdding] = useState(false)
  const closeForms = () => { setShift(null); setDayOff(null) }
  const go = (week: string) => { setMonday(week); closeForms() }
  // Из ячейки врача — к его недельному графику (рабочие часы — там)
  const toWeek = (key: string) => { closeForms(); setOpen(key); onMode('template') }
  const add = me.admin ? <button type="button" className="btn" onClick={() => setAdding(true)}>+ Добавить сотрудника</button> : null

  return (
    <div className={adding ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main shifts-page work-schedule">
        <SubHeader title={title} onBack={onBack}>{tabs}</SubHeader>
        <div className="sched-tools">
          <div className="segments" role="group" aria-label="Вид графика">
            <button type="button" aria-pressed={mode === 'template'} onClick={() => { closeForms(); onMode('template') }}>Обычная неделя</button>
            <button type="button" aria-pressed={mode === 'week'} onClick={() => onMode('week')}>Неделя по датам</button>
          </div>
          {mode === 'week' && (
            <div className="shifts-nav" role="group" aria-label="Неделя">
              <button type="button" className="btn ghost" aria-label="Прошлая неделя" onClick={() => go(addDays(monday, -7))}>‹</button>
              <strong className="num">{weekLabel(monday)}</strong>
              <button type="button" className="btn ghost" aria-label="Следующая неделя" onClick={() => go(addDays(monday, 7))}>›</button>
              {monday !== weekStart(todayIn()) && <button type="button" className="btn small" onClick={() => go(weekStart(todayIn()))}>Эта неделя</button>}
            </div>
          )}
        </div>
        {mode === 'template' && <ClinicHoursCard me={me} onTimeOff={onTimeOff} />}
        {loaded.error && <p className="error" role="alert">{loaded.error.message}</p>}
        {loaded.isPending ? <Loading /> : people.length === 0 ? (
          <section className="card-block">
            <EmptyState title="В графике пока никого" action={add && <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Добавить сотрудника</button>}>
              Здесь дни и часы всех в клинике — врачей, регистратуры, ассистентов. Добавьте сотрудника — и задайте его неделю.
            </EmptyState>
          </section>
        ) : mode === 'template' ? (
          <section className="card-block" aria-label="Обычная неделя">
            <h2>Кто когда работает</h2>
            <p className="hint">Обычная неделя каждого. Серым — «как у клиники»: по часам клиники выше.
              {people.some((p) => p.canEdit) ? ' Нажмите на человека, чтобы поменять дни и часы.' : ''} Обед и намаз — в «Перерывах и выходных», замены и выходы на дату — в «Неделе по датам».</p>
            {phone
              ? <PeopleList people={people} open={open} onOpen={setOpen} onTimeOff={onTimeOff} />
              : <PeopleTable people={people} open={open} onOpen={setOpen} onTimeOff={onTimeOff} />}
            {add && <div className="actions">{add}</div>}
          </section>
        ) : data && (
          <>
            <p className="hint">
              {people.some((p) => p.canEdit)
                ? 'Серым — обычная неделя. Поверх — исключения на дату: у сотрудников смены, у врачей перерывы и выходные. Нажмите на ячейку, чтобы добавить или изменить.'
                : 'График ведёт руководитель клиники: серым — обычная неделя, поверх — смены и выходные на дату. Ваша строка подсвечена.'}
            </p>
            <WeekGrid people={people} data={data} days={days}
              onShift={(e) => { setDayOff(null); setShift(e) }} onDayOff={(e) => { setShift(null); setDayOff(e) }} />
            {shift && (
              <ShiftForm key={`${shift.shift?.id ?? 'new'}-${shift.telegramId}-${shift.day}`} editing={shift} people={data.people ?? []} onDone={() => setShift(null)} />
            )}
            {dayOff && (
              <DayOffForm key={`${dayOff.entry?.id ?? 'new'}-${dayOff.doctorId}-${dayOff.day}`} editing={dayOff}
                canDelete={dayOff.entry?.doctorId == null ? Boolean(me.admin) : people.some((p) => p.key === `d${dayOff.doctorId}` && p.canEdit)}
                onDone={() => setDayOff(null)} onWeek={() => toWeek(`d${dayOff.doctorId}`)} onTimeOff={onTimeOff} />
            )}
            {data.canEdit && (data.shifts ?? []).length > 0 && <CopyWeek monday={monday} />}
          </>
        )}
      </section>
      {adding && <AddStaffPanel me={me} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </div>
  )
}

/** Имя (кнопка, если можно менять), роль серым, «как у клиники». */
function PersonCell({ p, open, onToggle }: { p: Person; open: boolean; onToggle: () => void }) {
  const name = `${p.who.name}${p.mine ? ' (вы)' : ''}`
  return (
    <span className="shift-person">
      {p.canEdit
        ? <button type="button" className="row-link" aria-expanded={open} onClick={onToggle}>{name}</button>
        : <span className="strong">{name}</span>}
      <span className="hint small">{p.role}{p.custom === false ? ' · как у клиники' : ''}</span>
    </span>
  )
}

type ListProps = { people: Person[]; open: string | null; onOpen: (key: string | null) => void; onTimeOff: () => void }

/** Компьютер: люди строками, дни недели колонками; нажатие на строку — редактор недели под ней. */
function PeopleTable({ people, open, onOpen, onTimeOff }: ListProps) {
  return (
    <div className="shifts-scroll">
      <table className="table sched-people" aria-label="Обычная неделя">
        <thead>
          <tr><th>Кто</th>{WEEK.map(([code, name, short]) => <th key={code} title={name}>{short}</th>)}</tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const toggle = () => onOpen(open === p.key ? null : p.key)
            return (
              <Fragment key={p.key}>
                <tr {...rowOpen(p.canEdit && toggle, p.mine && 'mine', open === p.key && 'active', p.custom === false && 'by-clinic')}
                  aria-current={p.mine ? 'true' : undefined}>
                  <th scope="row"><PersonCell p={p} open={open === p.key} onToggle={toggle} /></th>
                  {WEEK.map(([code]) => (
                    <td key={code} className="num">{!p.hours ? '…' : p.hours[code] ?? <span className="sched-off">выходной</span>}</td>
                  ))}
                </tr>
                {open === p.key && (
                  <tr className="sched-edit">
                    <td colSpan={8}><WeekEditor who={p.who} canEdit={p.canEdit} onTimeOff={onTimeOff} /></td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Телефон: компактные строки — имя, роль, «Пн–Пт 9–18, Сб 10–14»; нажатие — редактор недели под строкой. */
function PeopleList({ people, open, onOpen, onTimeOff }: ListProps) {
  return (
    <ul className="sched-list" aria-label="Обычная неделя">
      {people.map((p) => {
        const toggle = () => onOpen(open === p.key ? null : p.key)
        return (
          <li key={p.key} className={p.mine ? 'mine' : undefined} aria-current={p.mine ? 'true' : undefined}>
            <div {...rowOpen(p.canEdit && toggle, 'sched-line', p.custom === false && 'by-clinic')}>
              <PersonCell p={p} open={open === p.key} onToggle={toggle} />
              <span className="sched-sum num">{p.hours ? weekSummary(p.hours) : '…'}</span>
            </div>
            {open === p.key && <div className="sched-edit"><WeekEditor who={p.who} canEdit={p.canEdit} onTimeOff={onTimeOff} /></div>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Неделя по датам: люди × дни. Сотрудник — серым по недельному графику, смена на дату — поверх (как
 * прежние «Смены персонала»). Врач — серым его часы, поверх — перерыв или выходной на эту дату. На
 * телефоне таблица листается вбок внутри себя, страница не шире экрана.
 */
function WeekGrid({ people, data, days, onShift, onDayOff }: {
  people: Person[]; data: Schedule; days: string[]; onShift: (e: Editing) => void; onDayOff: (e: DayOffEditing) => void
}) {
  const today = todayIn()
  const timeOff = useTimeOff().data
  return (
    <div className="sched-scroll">
      <table className="sched-grid" aria-label="График на неделю">
        <thead>
          <tr>
            <th>Кто</th>
            {days.map((d) => <th key={d} className={d === today ? 'today' : undefined}>{dayShort(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.key} className={p.mine ? 'mine' : undefined} aria-current={p.mine ? 'true' : undefined}>
              <th scope="row">
                <span className="shift-person"><span className="strong">{p.who.name}{p.mine ? ' (вы)' : ''}</span><span className="hint small">{p.role}</span></span>
              </th>
              {days.map((d) => (
                <td key={d} className={d === today ? 'today' : undefined}>
                  {p.who.kind === 'staff'
                    ? <StaffDay p={p} telegramId={p.who.telegramId} data={data} day={d} onOpen={p.canEdit ? onShift : undefined} />
                    : <DoctorDay p={p} doctorId={p.who.id} day={d} timeOff={timeOff} onOpen={p.canEdit ? onDayOff : undefined} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StaffDay({ p, telegramId, data, day, onOpen }: {
  p: Person; telegramId: number; data: Schedule; day: string; onOpen?: (e: Editing) => void
}) {
  const list = (data.shifts ?? []).filter((s) => s.telegramId === telegramId && s.day === day)
  const planned = plannedOn(data, telegramId, day)
  return (
    <>
      {list.length === 0 && planned && (
        <span className="shift-chip shift-planned num" title="По недельному графику">{shortHours(planned.start, planned.end)}</span>
      )}
      {list.map((s) => onOpen ? (
        <button key={s.id} type="button" className="shift-chip num" title={s.note}
          aria-label={`${p.who.name}, ${dayLong(day)}: смена ${shiftHours(s)} — изменить`}
          onClick={() => onOpen({ shift: s, telegramId, day })}>{shortHours(s.startTime, s.endTime)}</button>
      ) : (
        <span key={s.id} className="shift-chip num" title={s.note}>{shortHours(s.startTime, s.endTime)}</span>
      ))}
      {onOpen && (
        <button type="button" className="shift-add" aria-label={`Добавить смену: ${p.who.name}, ${dayLong(day)}`}
          onClick={() => onOpen({ telegramId, day })}>+</button>
      )}
    </>
  )
}

function DoctorDay({ p, doctorId, day, timeOff, onOpen }: {
  p: Person; doctorId: number; day: string; timeOff: Schemas['TimeOffView'][] | undefined; onOpen?: (e: DayOffEditing) => void
}) {
  const offs = offOnDate(timeOff, doctorId, day)
  const planned = p.hours?.[weekdayOf(day)]
  const wholeDay = offs.some((t) => !t.startTime)
  const name = p.who.name
  return (
    <>
      {!wholeDay && (planned
        ? <span className="shift-chip shift-planned num" title="По недельному графику">{planned}</span>
        : p.hours && <span className="sched-off">выходной</span>)}
      {offs.map((t) => {
        const text = `${t.emoji ?? ''} ${t.title ?? ''}`.trim()
        const when = t.startTime ? ` ${shortHours(t.startTime, t.endTime)}` : ''
        // Общий выходной клиники тоже открывается: удалит руководитель, остальным — где его убрать
        return onOpen ? (
          <button key={t.id} type="button" className="shift-chip shift-off" title={t.doctorId == null ? 'Вся клиника' : undefined}
            aria-label={`${name}, ${dayLong(day)}: ${t.title}${when} — открыть`} onClick={() => onOpen({ doctorId, name, day, entry: t })}>
            {text}{when}</button>
        ) : <span key={t.id} className="shift-chip shift-off" title={t.doctorId == null ? 'Вся клиника' : undefined}>{text}{when}</span>
      })}
      {onOpen && (
        <button type="button" className="shift-add" aria-label={`Перерыв или выходной: ${name}, ${dayLong(day)}`}
          onClick={() => onOpen({ doctorId, name, day })}>+</button>
      )}
    </>
  )
}
