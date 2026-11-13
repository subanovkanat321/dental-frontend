import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useReminderText } from '../api/settings'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { canEditDoctor, isAssistant } from '../lib/roles'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { addDays, dateOf, dayTitle, timeOf, todayIn } from '../lib/time'
import { statusOf } from '../schedule/status'
import { Loading } from '../layout/Loading'
import { HeadTools } from '../layout/PageHead'
import { CalmRow } from './CalmList'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/**
 * Период списка: с какого дня (0 — сегодня) и сколько дней (сервер отдаёт до 31 дня одним запросом
 * на врача). «Сегодня» и «Завтра» — для обзвона: туда ведёт кнопка сводки «📲 Напомнить (N)».
 */
const PERIODS = [['today', 'Сегодня', 0, 1], ['tomorrow', 'Завтра', 1, 1], ['7', 'Неделя', 0, 7], ['14', '2 недели', 0, 14],
  ['31', 'Месяц', 0, 31]] as const

type Period = (typeof PERIODS)[number][0]

/**
 * Фильтры из ссылки бота (?screen=booked&day=…&unconfirmed=1&doctor=…; «Отметить (N)» — &unmarked=1:
 * прошедшие без отметки «явка / неявка»).
 */
export type BookedFilter = { date?: string; unconfirmed?: boolean; unmarked?: boolean; doctorId?: number }

/**
 * «Пациенты → Записаны»: все будущие записи одним списком по дням — обзвонить, увидеть, кто не
 * подтвердил, загрузку на неделю (на телефоне «Недели» нет). Те же приёмы, что в «Расписании»
 * (/api/appointments/range по каждому видимому врачу), без отменённых и прошедших. Нажали строку —
 * карточка приёма в «Расписании»; у неподтверждённых — «WhatsApp» с готовым текстом напоминания.
 */
export function BookedTab({ me, initial, onOpenAppointment }: {
  me: Me
  initial?: BookedFilter
  onOpenAppointment?: (id: number) => void
}) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id)))
  const today = todayIn()
  // Врач из ссылки — если он в списке (скрытого врача или чужого ассистенту не выбираем)
  const [doctorId, setDoctorId] = useState<number | null>(() =>
    initial?.doctorId != null && doctors.some((d) => d.id === initial.doctorId) ? initial.doctorId : null)
  const [period, setPeriod] = useState<Period>(() =>
    initial?.date === today ? 'today' : initial?.date === addDays(today, 1) ? 'tomorrow' : '7')
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(Boolean(initial?.unconfirmed))
  // «Не отмечено»: прошедшие запланированные без «Приём состоялся» / «Неявка» (как «не отмечено» в сводках бота)
  const [onlyUnmarked, setOnlyUnmarked] = useState(Boolean(initial?.unmarked))
  // «Сейчас» — на момент открытия вкладки: закончившиеся сегодня приёмы в список не идут
  const [now] = useState(() => Date.now())
  const shown = doctorId == null ? doctors : doctors.filter((d) => d.id === doctorId)
  const [, , offset, days] = PERIODS.find(([key]) => key === period)!
  const from = addDays(today, offset)
  const lists = useQueries({
    queries: shown.map((d) => ({
      queryKey: ['appointments', 'range', from, days, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments/range', { params: { query: { from, days, doctorId: d.id } } })),
    })),
  })
  const nameOf = new Map(doctors.map((d) => [d.id, d.fullName ?? '']))
  const all = lists.flatMap((q) => q.data ?? [])
    // Будущие: заявки и запланированные, ещё не закончившиеся; «Не отмечено» — наоборот, закончившиеся без отметки
    .filter((a) => onlyUnmarked
      ? a.status === 'SCHEDULED' && Boolean(a.endAt) && Date.parse(a.endAt!) < now
      : (a.status === 'SCHEDULED' || a.status === 'REQUESTED') && (!a.endAt || Date.parse(a.endAt) >= now))
    .filter((a) => onlyUnmarked || !onlyUnconfirmed || (a.status === 'REQUESTED' || a.reply !== 'CONFIRMED'))
    .sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))
  const byDay = new Map<string, Appointment[]>()
  for (const a of all) {
    const day = dateOf(a.startAt)
    byDay.set(day, [...(byDay.get(day) ?? []), a])
  }
  const pending = lists.some((q) => q.isPending)
  const failed = lists.find((q) => q.error)?.error

  return (
    <section className="booked" aria-label="Записанные пациенты">
      {/* Период, врач и отбор — в строку шапки «Пациентов»; сколько записей — мелко там же */}
      <HeadTools>
        <div className="segments tabs" role="group" aria-label="Период">
          {PERIODS.map(([key, title]) => (
            <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{title}</button>
          ))}
        </div>
        {doctors.length > 1 && (
          <Select aria-label="Врач" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</option>)}
          </Select>
        )}
        {!onlyUnmarked && (
          <label className="check">
            <input type="checkbox" checked={onlyUnconfirmed} onChange={(e) => setOnlyUnconfirmed(e.target.checked)} />
            Только кто не подтвердил
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyUnmarked} onChange={(e) => setOnlyUnmarked(e.target.checked)} />
          Не отмечено
        </label>
      </HeadTools>
      {failed && <p className="error">{failed.message}</p>}
      {pending ? <Loading /> : !all.length ? (
        <EmptyState fill title={onlyUnmarked ? 'Все прошедшие приёмы отмечены' : onlyUnconfirmed ? 'Все записанные подтвердили приход' : 'Записей на этот период нет'} />
      ) : (
        <div className="calm-stack">
          {[...byDay].map(([day, list]) => (
            <div key={day} className="calm-day">
              <h3>{day === today ? `Сегодня, ${dayTitle(day).toLowerCase()}` : dayTitle(day)} <span className="hint">· {list.length}</span></h3>
              <ul className="calm-list" aria-label={dayTitle(day)}>
                {list.map((a) => (
                  <BookedRow key={a.id} a={a} canEdit={canEditDoctor(me, a.doctorId)} past={onlyUnmarked} onOpen={onOpenAppointment}
                    doctor={doctors.length > 1 && doctorId == null && a.doctorId != null ? nameOf.get(a.doctorId) : undefined} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Строка записи. Не подтвердил (запланирован, без «приду») — рядом «WhatsApp»: тот же готовый текст,
 * что «Напомнить в WhatsApp» в карточке приёма, и та же отметка «напомнили» (reminder-opened). Пациенту
 * с Telegram, который молчит после бота, — тоже: бот уже писал, WhatsApp — второй шанс.
 */
function BookedRow({ a, doctor, canEdit, past, onOpen }: {
  a: Appointment
  /** Уже закончился («Не отмечено»): напоминать поздно — только отметить в карточке */
  past: boolean
  doctor?: string
  canEdit: boolean
  onOpen?: (id: number) => void
}) {
  const client = useQueryClient()
  const text = useReminderText()
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const s = statusOf(a)
  const canRemind = canEdit && !past && a.status === 'SCHEDULED' && a.reply !== 'CONFIRMED' && Boolean(a.patient.phone)
  const whatsapp = () => {
    if (!text) return
    opened.mutate()
    // openLink: в Telegram ссылка откроется в WhatsApp, а не внутри Mini App
    openLink(whatsappUrl(contactPhone(a.patient) ?? '', text(a)))
  }
  // Значок — только заявке (её надо подтвердить); остальное — тихим словом справа: «придёт», «нет ответа»
  return (
    <CalmRow open={onOpen ? () => onOpen(a.id) : null} lead={timeOf(a.startAt)} name={a.patient.fullName}
      flags={a.status === 'REQUESTED' && <span className="chip calm-flag s-request">Заявка</span>}
      sub={[a.serviceName ?? 'Услуга не выбрана', doctor].filter(Boolean).join(' · ')}
      meta={a.status !== 'REQUESTED' && <span className={s.kind === 'ok' ? 'tone-ok' : undefined}>{s.label.toLowerCase()}</span>}
      action={canRemind && (
        <button type="button" className="btn" disabled={!text || opened.isPending} onClick={whatsapp}
          aria-label={`Напомнить в WhatsApp: ${a.patient.fullName}, ${timeOf(a.startAt)}`}>WhatsApp</button>
      )}>
      {opened.error && <p className="error" role="alert">{opened.error.message}</p>}
    </CalmRow>
  )
}
