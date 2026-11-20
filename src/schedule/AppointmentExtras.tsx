import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { dateOf, minutesOf, slotInstant, somText, timeOf, todayIn } from '../lib/time'
import { DurationField } from './DurationField'
import { TimePicker } from './TimePicker'
import { ChairTimeHint } from './ChairTimeHint'
import { ChairSelect } from './ChairSelect'
import { useChairChoice } from './chairChoice'
import { isChairError } from './chairTime'
import { useAppointmentAction } from './useAppointmentAction'
import { NOWHERE_TEXT } from './useRemind'
import { canEditServices, editableDoctors } from '../lib/roles'
import { openServiceLater } from '../lib/openService'
import { servicesOfDoctor } from '../lib/doctorServices'
import { DateInput } from '../layout/DateInput'
import { useFreeDays } from '../lib/freeDays'
import { Fold } from '../layout/Fold'
import { Select } from '../layout/Select'
import { ServicePicker } from '../clinic/ServicePicker'
import { expired, usePromoCodes } from '../lib/promo'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']


function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/**
 * «Перенести»: день, длительность, врач и время из сетки свободного (старое время приёма в ней
 * свободно). Тот же врач — /reschedule, другой — /transfer (как «Передать другому врачу»):
 * новому врачу придёт уведомление, пациенту из бота — сообщение. Занятое время не пустит база.
 */
export function Reschedule({ appointment: a, me, onDone }: { appointment: Appointment; me: Me; onDone: (text?: string) => void }) {
  const action = useAppointmentAction(a)
  // Передать можно только врачу, чьё расписание мне можно менять (ассистенту — его врачи)
  const doctors = editableDoctors(me, (me.doctors ?? []).filter((d) => d.active !== false))
  const minutes = (minutesOf(a.endAt) - minutesOf(a.startAt) + 24 * 60) % (24 * 60) || 30
  const [date, setDate] = useState(dateOf(a.startAt))
  const [time, setTime] = useState(timeOf(a.startAt))
  const [duration, setDuration] = useState(minutes)
  const [doctorId, setDoctorId] = useState(a.doctorId)
  const [calMonth, setCalMonth] = useState((a.startAt ? dateOf(a.startAt) : todayIn()).slice(0, 7))
  const freeDays = useFreeDays(doctorId, calMonth, duration)
  const [problem, setProblem] = useState('')
  // Кресло (V210): у того же врача — кресло приёма (выбранное вручную остаётся), у другого — его кресло
  const newStart = /^\d{2}:\d{2}$/.test(time) ? slotInstant(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) : null
  const chair = useChairChoice(doctorId, doctorId === a.doctorId ? a.chairId ?? null : undefined, `${newStart ?? ''}|${duration}`)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!time) {
      setProblem('Выберите время')
      return
    }
    setProblem('')
    const [h, m] = time.split(':').map(Number)
    const startAt = slotInstant(date, (h ?? 0) * 60 + (m ?? 0))
    const body = { version: a.version, startAt, durationMinutes: duration, chairId: chair.picked }
    const other = doctors.find((d) => d.id === doctorId)
    if (doctorId === a.doctorId) action.mutate({ kind: 'reschedule', body }, { onSuccess: () => onDone('Время изменилось — напомните пациенту заново') })
    else action.mutate({ kind: 'transfer', body: { ...body, doctorId } }, { onSuccess: () => onDone(`Приём передан: ${other?.fullName ?? 'другой врач'}`) })
  }

  return (
    <form className="form sub-form" aria-label="Перенос записи" onSubmit={submit}>
      {doctors.length > 1 && (
        <div className="field"><span>Врач</span>
          <div className="segments wrap" role="group" aria-label="Врач">
            {doctors.map((d) => (
              <button key={d.id} type="button" aria-pressed={d.id === doctorId} onClick={() => { if (d.id !== doctorId) setTime(''); setDoctorId(d.id) }}>
                {d.fullName}{d.id === a.doctorId ? ' (сейчас)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row">
        <label className="field"><span>День</span>
          <DateInput weekday value={date} required marks={freeDays} onMonthView={setCalMonth}
            onChange={(e) => { setDate(e.target.value); setTime('') }} />
        </label>
        {/* Другая длительность — выбранное время могло перестать помещаться: выбрать заново */}
        <DurationField value={duration} onChange={(d) => { if (d !== duration) setTime(''); setDuration(d) }} />
      </div>
      <TimePicker key={`${date}-${doctorId}`} date={date} doctorId={doctorId} duration={duration} exclude={doctorId === a.doctorId ? a.id : undefined}
        value={time} onChange={(t) => { setTime(t); setProblem('') }} error={problem || errorText(action.error)} />
      {/* Новое время — кресло занято (приёмом или часами коллеги): сказать до «Перенести» и предложить свободные */}
      {newStart && (
        <ChairTimeHint doctorId={doctorId} startAt={newStart} duration={duration} chairId={chair.checkId}
          appointmentId={doctorId === a.doctorId ? a.id : undefined} multi={chair.multi} picked={chair.picked}
          onPickChair={chair.pick} onReset={chair.reset}
          action={doctorId === a.doctorId ? 'Перенести' : 'Передать'} hidden={isChairError(action.error)} />
      )}
      {doctorId !== a.doctorId && <p className="hint small">Новому врачу придёт уведомление, а пациенту, если он записан через бота, — сообщение с именем врача и временем.</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={action.isPending}>{doctorId === a.doctorId ? 'Перенести' : 'Передать'}</button>
        <button type="button" className="btn ghost" onClick={() => onDone()}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * Кресло приёма (V210) в карточке — только у приёма не в кресле врача (chair_manual): поле «Кресло»; время то же. Кресло врача — снова «по креслу
 * врача». Занято — сервер ответит 409 с предложением свободного (withChairConfirm спросит «записать туда?»).
 */
export function ChairEdit({ appointment: a, onDone }: { appointment: Appointment; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const chair = useChairChoice(a.doctorId, a.chairId ?? null)
  const duration = a.startAt && a.endAt ? Math.round((Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000) : 30
  return (
    <form className="form sub-form" aria-label="Кресло приёма" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'chair', body: { version: a.version, chairId: chair.chosen } }, { onSuccess: onDone })
    }}>
      <ChairSelect doctorId={a.doctorId} startAt={a.startAt} duration={duration} appointmentId={a.id} value={chair.chosen} onChange={chair.pick} />
      {/* Кресло сменили — что ответит сервер (занято, часы коллеги, «врачу кресла придёт уведомление») */}
      {a.startAt && chair.chosen !== (a.chairId ?? undefined) && (
        <ChairTimeHint doctorId={a.doctorId} startAt={a.startAt} duration={duration} chairId={chair.chosen} appointmentId={a.id}
          action="Сохранить" multi onPickChair={chair.pick} hidden={isChairError(action.error)} />
      )}
      {action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={action.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

/** Услуга приёма: выбрать из услуг врача приёма (выбраны — только они, иначе все услуги клиники); «—» — без услуги. */
export function ServiceEdit({ appointment: a, me, onDone, prices = true }: { appointment: Appointment; me: Me; onDone: () => void; prices?: boolean }) {
  const action = useAppointmentAction(a)
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
  })
  // Текущая услуга приёма — и если её уже убрали из прайса: остаётся в списке текущим значением
  const all = services.data ?? []
  const current = (all.find((s) => s.name === a.serviceName && s.active !== false) ?? all.find((s) => s.name === a.serviceName))?.id ?? ''
  const [serviceId, setServiceId] = useState<number | ''>('')
  const chosen = serviceId === '' ? current : serviceId
  // Выбрать — только из прайса (скрытые — «в справочнике клиники»)
  const offered = servicesOfDoctor(all.filter((s) => s.active !== false || s.id === current), me.doctorServices, a.doctorId, current)
  return (
    <form className="form sub-form" aria-label="Услуга приёма" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'service', body: { serviceTypeId: chosen === '' ? undefined : chosen } }, { onSuccess: onDone })
    }}>
      <label className="field"><span>Услуга</span>
        {/* Тот же выбор услуги, что в «Новой записи»: поиск, «Частые», разделы прайса */}
        <ServicePicker aria-label="Услуга" services={offered} value={chosen} clearable prices={prices}
          note={(s) => (s.active === false ? 'не в прайсе' : null)} onChange={(id) => setServiceId(id)} />
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
 * Промокод записи: пациент назвал его по телефону или на приёме. Выбор из кодов клиники —
 * действующих и того, что уже стоит; «Без промокода» — убрать.
 */
export function PromoEdit({ appointment: a, onDone }: { appointment: Appointment; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const codes = usePromoCodes()
  const [code, setCode] = useState(a.promoCode ?? '')
  const offered = (codes.data ?? []).filter((p) => p.code === a.promoCode || (p.active !== false && !expired(p, todayIn())))
  return (
    <form className="form sub-form" aria-label="Промокод записи" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'promo', body: { promoCode: code } }, { onSuccess: onDone })
    }}>
      <label className="field"><span>Промокод</span>
        <Select value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Без промокода</option>
          {offered.map((p) => <option key={p.id} value={p.code}>{`🎟 ${p.code}${p.description ? ` · ${p.description}` : ''}`}</option>)}
        </Select>
      </label>
      {codes.data?.length === 0 && <p className="hint small">Промокодов нет — их заводят в «Настройки → Откуда приходят пациенты → Промокоды».</p>}
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
export function Supplies({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const client = useQueryClient()
  const used = useQuery({
    queryKey: ['appointment-supplies', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/supplies', { params: { path: { id: a.id } } })),
  })
  const stock = useQuery({
    queryKey: ['supplies', a.doctorId],
    queryFn: () => unwrap(api.GET('/api/supplies', { params: { query: { doctorId: a.doctorId } } })),
  })
  const [pick, setPick] = useState<number | ''>('')
  // Ничего не предложено: подсказать, где задать «Обычно уходит» для услуги приёма
  const suggested = useQuery({
    queryKey: ['appointment-supplies-suggested', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/supplies/suggested', { params: { path: { id: a.id } } })),
    enabled: !!a.serviceName && canEditServices(me),
  })
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    enabled: !!a.serviceName && canEditServices(me),
  })
  const serviceId = services.data?.find((s) => s.name === a.serviceName)?.id
  const move = useMutation<Schemas['SupplyControllerSpent'], ApiError, { supplyId: number; delta: number }>({
    mutationFn: ({ supplyId, delta }) => unwrap(api.POST('/api/appointments/{id}/supplies/{supplyId}', {
      params: { path: { id: a.id, supplyId } }, body: { delta },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['appointment-supplies', a.id] })
      void client.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
  const list = used.data ?? []
  // Во сколько обошлось — сервер отдаёт только тем, кто видит деньги этого приёма (seesMoneyOf), по средней цене покупки
  const costed = list.filter((u) => u.costSom != null)
  const costTotal = costed.reduce((s, u) => s + (u.costSom ?? 0), 0)
  return (
    <Fold title="Материалы" label="Материалы на приёме" meta={list.length ? String(list.length) : 'не списаны'}>
    <div className="supplies-box">
      {/* Ничего ещё не списали — предложить материалы услуги; списывает врач сам, кнопкой */}
      {used.isSuccess && list.length === 0 && <SuggestedSupplies appointment={a} />}
      {used.isSuccess && list.length === 0 && suggested.isSuccess && suggested.data.length === 0 && serviceId != null && (
        <p className="hint small supplies-setup">Готового списка у услуги нет —{' '}
          <a href="#/clinic/services" onClick={() => openServiceLater(serviceId)}>настроить материалы услуги</a></p>
      )}
      {list.length > 0 && (
        <ul className="visits">
          {list.map((u) => (
            <li key={u.supplyId} className="spent">
              <span>{u.name} — <b className="num">{u.used}</b> {u.unit}
                {u.costSom != null && <span className="hint small num"> · ≈ {somText(u.costSom)}</span>}</span>
              <span className="actions">
                <button type="button" className="btn small" disabled={move.isPending} aria-label={`Списать ещё 1: ${u.name}`}
                  onClick={() => move.mutate({ supplyId: u.supplyId, delta: -1 })}>−1</button>
                <button type="button" className="btn small ghost" disabled={move.isPending} aria-label={`Вернуть 1: ${u.name}`}
                  onClick={() => move.mutate({ supplyId: u.supplyId, delta: 1 })}>вернуть</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {costed.length > 0 && (
        <p className="hint small" aria-label="Материалы в деньгах">≈ {somText(costTotal)} по средней цене покупки
          {costed.length < list.length ? ` · без цены: ${list.length - costed.length}` : ''}</p>
      )}
      <div className="row add-supply">
        <Select aria-label="Материал со склада" value={pick} onChange={(e) => setPick(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Материал со склада…</option>
          {stock.data?.filter((x) => x.quantity > 0).map((x) => (
            <option key={x.id} value={x.id}>{x.name} · осталось {x.quantity} {x.unit}</option>
          ))}
        </Select>
        <button type="button" className="btn" disabled={pick === '' || move.isPending}
          onClick={() => pick !== '' && move.mutate({ supplyId: pick, delta: -1 }, { onSuccess: () => setPick('') })}>Списать 1</button>
      </div>
      {move.error && <p className="error" role="alert">{errorText(move.error)}</p>}
    </div>
    </Fold>
  )
}

type SuggestedRow = { supplyId: number; name: string; unit: string; quantity: string; inStock: number }

/**
 * «Обычно уходит»: материалы по умолчанию услуги приёма (Клиника → Услуги и цены), готовым списком.
 * Врач правит количество, убирает лишнее и нажимает «Списать всё» — всё или ничего, как «−1»
 * по каждому (остатки, «заканчивается», «вернуть»). «Не нужно» — скрыть до следующего открытия.
 */
function SuggestedSupplies({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const suggested = useQuery({
    queryKey: ['appointment-supplies-suggested', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/supplies/suggested', { params: { path: { id: a.id } } })),
  })
  const [draft, setDraft] = useState<SuggestedRow[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const rows = draft ?? (suggested.data ?? []).map((i) => ({
    supplyId: i.supplyId, name: i.name ?? '', unit: i.unit ?? '', quantity: String(i.quantity), inStock: i.inStock,
  }))
  const spend = useMutation<Schemas['SupplyQueryUsed'][], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/supplies', {
      params: { path: { id: a.id } },
      body: { items: rows.map((r) => ({ supplyId: r.supplyId, quantity: Number(r.quantity) })) },
    })),
    onSuccess: (used) => {
      client.setQueryData(['appointment-supplies', a.id], used)
      void client.invalidateQueries({ queryKey: ['appointment-supplies', a.id] })
      void client.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
  if (hidden || !suggested.data?.length) return null
  const invalid = rows.some((r) => !/^\d+$/.test(r.quantity) || Number(r.quantity) < 1 || Number(r.quantity) > 1000)
  const summary = (suggested.data ?? []).map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(', ')
  return (
    <div className="suggested-supplies" aria-label="Обычно уходит">
      <p className="hint">Обычно уходит: {summary}</p>
      {rows.length > 0 && (
        <ul className="supply-rows">
          {rows.map((r, i) => (
            <li key={r.supplyId}>
              <span>{r.name}{Number(r.quantity) > r.inStock && <span className="tone-wait"> · на складе {r.inStock} {r.unit}</span>}</span>
              <span className="actions">
                <input type="number" min={1} max={1000} inputMode="numeric" aria-label={`Сколько списать: ${r.name}`} value={r.quantity}
                  onChange={(e) => setDraft(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <span className="hint">{r.unit}</span>
                <button type="button" className="btn small ghost" aria-label={`Не списывать: ${r.name}`}
                  onClick={() => setDraft(rows.filter((_, j) => j !== i))}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {invalid && <p className="error">Сколько — целое число от 1 до 1000</p>}
      {spend.error && <p className="error" role="alert">{errorText(spend.error)}</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!rows.length || invalid || spend.isPending} onClick={() => spend.mutate()}>Списать всё</button>
        <button type="button" className="btn ghost" onClick={() => setHidden(true)}>Не нужно</button>
      </div>
    </div>
  )
}

const REPLIES = [['CONFIRMED', 'Подтвердил'], ['RESCHEDULE', 'Перенос'], ['NO_ANSWER', 'Нет ответа']] as const

/**
 * Ответ пациента на напоминание — «Подтвердил / Перенос / Нет ответа» (то же «Подтвердил», что в статусе карточки):
 * ответил по телефону или в WhatsApp — отметьте, коллеги увидят; повторное нажатие снимает. Сами напоминания
 * (бот, WhatsApp, SMS) — в «📞 Связаться ▾» (useAppointmentContacts). Ни бота, ни номера — подсказка.
 */
export function Remind({ appointment: a, nowhere }: { appointment: Appointment; nowhere?: boolean }) {
  const action = useAppointmentAction(a)
  return (
    <section className="remind" aria-label="Напоминание">
      {nowhere && <p className="hint small" role="note">{NOWHERE_TEXT}</p>}
      <div className="segments" role="group" aria-label="Ответ пациента">
        {REPLIES.map(([reply, title]) => (
          <button key={reply} type="button" aria-pressed={a.reply === reply} disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'reply', body: { version: a.version, reply: a.reply === reply ? 'NONE' : reply } })}>
            {title}
          </button>
        ))}
      </div>
      {action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
    </section>
  )
}

export { VisitNote } from './VisitNote'
