import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { reminderText, whatsappUrl } from '../lib/texts'
import { minutesOf, slotInstant, timeOf, ZONE } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]

function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/**
 * «Перенести»: день, время, длительность и врач. Тот же врач — /reschedule, другой — /transfer
 * (как «Передать другому врачу» в приложении). Занятое время не пустит база — покажем её ответ.
 */
export function Reschedule({ appointment: a, me, onDone }: { appointment: Appointment; me: Me; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const minutes = (minutesOf(a.endAt!) - minutesOf(a.startAt!) + 24 * 60) % (24 * 60) || 30
  const [date, setDate] = useState(dateOf(a.startAt!))
  const [time, setTime] = useState(timeOf(a.startAt!))
  const [duration, setDuration] = useState(minutes)
  const [doctorId, setDoctorId] = useState(a.doctorId!)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const [h, m] = time.split(':').map(Number)
    const startAt = slotInstant(date, (h ?? 0) * 60 + (m ?? 0))
    const body = { version: a.version ?? 0, startAt, durationMinutes: duration }
    action.mutate(doctorId === a.doctorId ? { kind: 'reschedule', body } : { kind: 'transfer', body: { ...body, doctorId } }, { onSuccess: onDone })
  }

  return (
    <form className="form sub-form" aria-label="Перенос записи" onSubmit={submit}>
      <div className="row">
        <label className="field"><span>День</span>
          <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field"><span>Время</span>
          <input type="time" step={900} value={time} required onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field"><span>Длительность</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[...new Set([...DURATIONS, duration])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d} мин</option>)}
          </select>
        </label>
        {doctors.length > 1 && (
          <label className="field"><span>Врач</span>
            <select value={doctorId} onChange={(e) => setDoctorId(Number(e.target.value))}>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </label>
        )}
      </div>
      {action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={action.isPending}>Перенести</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

/** Услуга приёма: выбрать из услуг клиники; «—» — без услуги. */
export function ServiceEdit({ appointment: a, onDone }: { appointment: Appointment; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    select: (list) => list.filter((s) => s.active !== false),
  })
  const current = services.data?.find((s) => s.name === a.serviceName)?.id ?? ''
  const [serviceId, setServiceId] = useState<number | ''>('')
  const chosen = serviceId === '' ? current : serviceId
  return (
    <form className="form sub-form" aria-label="Услуга приёма" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'service', body: { serviceTypeId: chosen === '' ? undefined : chosen } }, { onSuccess: onDone })
    }}>
      <label className="field"><span>Услуга</span>
        <select value={chosen} onChange={(e) => setServiceId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">—</option>
          {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.priceSom != null ? ` · ${s.priceSom} сом` : ''}</option>)}
        </select>
      </label>
      {action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={action.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

/** Комментарий к записи: пустой — убрать. */
export function CommentEdit({ appointment: a, onDone }: { appointment: Appointment; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const [comment, setComment] = useState(a.comment ?? '')
  return (
    <form className="form sub-form" aria-label="Комментарий к записи" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'comment', body: { comment: comment.trim() } }, { onSuccess: onDone })
    }}>
      <label className="field"><span>Комментарий</span>
        <textarea rows={2} maxLength={500} value={comment} autoFocus onChange={(e) => setComment(e.target.value)} />
      </label>
      {action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={action.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * Материалы на приёме: что списано и «−1» со склада врача приёма (и общего); «вернуть» — если
 * списали по ошибке. Остаток на складе меняет сервер.
 */
export function Supplies({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const used = useQuery({
    queryKey: ['appointment-supplies', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/supplies', { params: { path: { id: a.id! } } })),
  })
  const stock = useQuery({
    queryKey: ['supplies', a.doctorId],
    queryFn: () => unwrap(api.GET('/api/supplies', { params: { query: { doctorId: a.doctorId } } })),
  })
  const [pick, setPick] = useState<number | ''>('')
  const move = useMutation<Schemas['SupplyControllerSpent'], ApiError, { supplyId: number; delta: number }>({
    mutationFn: ({ supplyId, delta }) => unwrap(api.POST('/api/appointments/{id}/supplies/{supplyId}', {
      params: { path: { id: a.id!, supplyId } }, body: { delta },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['appointment-supplies', a.id] })
      void client.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
  const list = used.data ?? []
  return (
    <section className="supplies-box" aria-label="Материалы на приёме">
      <h3>Материалы</h3>
      {list.length > 0 && (
        <ul className="visits">
          {list.map((u) => (
            <li key={u.supplyId} className="spent">
              <span>{u.name} — <b className="num">{u.used}</b> {u.unit}</span>
              <span className="actions">
                <button type="button" className="btn small" disabled={move.isPending} aria-label={`Списать ещё 1: ${u.name}`}
                  onClick={() => move.mutate({ supplyId: u.supplyId!, delta: -1 })}>−1</button>
                <button type="button" className="btn small ghost" disabled={move.isPending} aria-label={`Вернуть 1: ${u.name}`}
                  onClick={() => move.mutate({ supplyId: u.supplyId!, delta: 1 })}>вернуть</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row add-supply">
        <select aria-label="Материал со склада" value={pick} onChange={(e) => setPick(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Материал со склада…</option>
          {stock.data?.filter((x) => (x.quantity ?? 0) > 0).map((x) => (
            <option key={x.id} value={x.id}>{x.name} · осталось {x.quantity} {x.unit}</option>
          ))}
        </select>
        <button type="button" className="btn" disabled={pick === '' || move.isPending}
          onClick={() => pick !== '' && move.mutate({ supplyId: pick, delta: -1 }, { onSuccess: () => setPick('') })}>Списать 1</button>
      </div>
      {move.error && <p className="error" role="alert">{errorText(move.error)}</p>}
    </section>
  )
}

const REPLIES = [['CONFIRMED', 'Придёт'], ['RESCHEDULE', 'Перенос'], ['NO_ANSWER', 'Нет ответа']] as const

/**
 * Напомнить о приёме и отметить ответ — как в «Дне» приложения:
 * - Telegram (пациент записывался через бота): сообщение с кнопками «Приду / Перенести» шлёт бот;
 *   отметку «напомнили» сервер ставит после доставки;
 * - WhatsApp: готовый текст в wa.me и отметка «напомнили» сразу (ответ придёт в WhatsApp);
 * - ответ пациента (по телефону, в WhatsApp) — «Придёт / Перенос / Нет ответа», повторное нажатие снимает.
 */
export function Remind({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => unwrap(api.GET('/api/settings')), staleTime: 10 * 60_000 })
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id! } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const canRemind = a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const whatsapp = () => {
    opened.mutate()
    window.open(whatsappUrl(a.patient?.phone ?? '', reminderText({ startAt: a.startAt!, patient: a.patient ?? {} },
      settings.data?.clinicSignature, settings.data?.botUrl)), '_blank', 'noopener')
  }
  return (
    <section className="remind" aria-label="Напоминание">
      {canRemind && (
        <div className="actions">
          {a.patient?.telegram && (
            <button type="button" className="btn primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'remindTelegram' })}>
              Напомнить в Telegram
            </button>
          )}
          {a.patient?.phone && (
            <button type="button" className={a.patient?.telegram ? 'btn' : 'btn primary'} onClick={whatsapp}>Напомнить в WhatsApp</button>
          )}
        </div>
      )}
      <div className="segments" role="group" aria-label="Ответ пациента">
        {REPLIES.map(([reply, title]) => (
          <button key={reply} type="button" aria-pressed={a.reply === reply} disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'reply', body: { version: a.version ?? 0, reply: a.reply === reply ? 'NONE' : reply } })}>
            {title}
          </button>
        ))}
      </div>
      {(action.error ?? opened.error) && <p className="error" role="alert">{errorText(action.error ?? opened.error)}</p>}
    </section>
  )
}

/**
 * «Заметка о приёме»: что сделали, что дальше — медданные, видят врач приёма и админ (403 — нет
 * блока). Сохраняется здесь же; в медкарте пациента — в «Заметках о визитах».
 */
export function VisitNote({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const note = useQuery({
    queryKey: ['note', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/note', { params: { path: { id: a.id! } } })),
    retry: false,
  })
  const [text, setText] = useState<string | null>(null)
  const save = useMutation<Schemas['ChartControllerNote'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/appointments/{id}/note', { params: { path: { id: a.id! } }, body: { note: (text ?? '').trim() } })),
    onSuccess: (saved) => {
      client.setQueryData(['note', a.id], saved)
      void client.invalidateQueries({ queryKey: ['notes'] })
      setText(null)
    },
  })
  if (note.isPending || note.error) return null
  const value = text ?? note.data.note ?? ''
  const changed = text != null && text.trim() !== (note.data.note ?? '')
  return (
    <form className="form" aria-label="Заметка о приёме" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Заметка о приёме — видят врач и администратор</span>
        <textarea rows={3} maxLength={2000} value={value} placeholder="Что сделали, что дальше"
          onChange={(e) => setText(e.target.value)} />
      </label>
      {changed && <button type="submit" className="btn" disabled={save.isPending}>Сохранить заметку</button>}
      {save.isSuccess && !changed && <p className="tone-ok small" role="status">Сохранено</p>}
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
    </form>
  )
}
