import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useReminderText, useRepeatReminderText } from '../api/settings'
import { confirmRemind, isRepeat, remindedText } from './remindAgain'
import { smsUrl, whatsappUrl } from '../lib/texts'
import { isMobile } from '../pwa/pwa'
import { openLink, telegram } from '../lib/telegram'
import { dateOf, minutesOf, slotInstant, somText, timeOf, todayIn } from '../lib/time'
import { Dictation } from './Dictation'
import { DurationField } from './DurationField'
import { TimePicker } from './TimePicker'
import { ChairTimeHint } from './ChairTimeHint'
import { ChairSelect } from './ChairSelect'
import { useChairChoice } from './chairChoice'
import { isChairError } from './chairTime'
import { useAppointmentAction } from './useAppointmentAction'
import { canEditServices, editableDoctors } from '../lib/roles'
import { openServiceLater } from '../lib/openService'
import { servicesOfDoctor } from '../lib/doctorServices'
import { DateInput } from '../layout/DateInput'
import { Fold } from '../layout/Fold'
import { Select } from '../layout/Select'
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
  const [problem, setProblem] = useState('')
  // Кресло (V210): у того же врача — кресло приёма (выбранное вручную остаётся), у другого — его кресло
  const chair = useChairChoice(doctorId, doctorId === a.doctorId ? a.chairId ?? null : undefined)
  const newStart = /^\d{2}:\d{2}$/.test(time) ? slotInstant(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!time) {
      setProblem('Выберите время')
      return
    }
    setProblem('')
    const [h, m] = time.split(':').map(Number)
    const startAt = slotInstant(date, (h ?? 0) * 60 + (m ?? 0))
    const body = { version: a.version, startAt, durationMinutes: duration, chairId: chair.chairId }
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
          <DateInput weekday value={date} required onChange={(e) => { setDate(e.target.value); setTime('') }} />
        </label>
        {/* Другая длительность — выбранное время могло перестать помещаться: выбрать заново */}
        <DurationField value={duration} onChange={(d) => { if (d !== duration) setTime(''); setDuration(d) }} />
      </div>
      <TimePicker key={`${date}-${doctorId}`} date={date} doctorId={doctorId} duration={duration} exclude={doctorId === a.doctorId ? a.id : undefined}
        value={time} onChange={(t) => { setTime(t); setProblem('') }} error={problem || errorText(action.error)} />
      {chair.multi && (
        <ChairSelect doctorId={doctorId} startAt={newStart} duration={duration} appointmentId={doctorId === a.doctorId ? a.id : undefined}
          value={chair.chairId} onChange={chair.pick} />
      )}
      {/* Новое время — в часах коллеги по креслу: сказать до «Перенести», как в «Новой записи» */}
      {newStart && (
        <ChairTimeHint doctorId={doctorId} startAt={newStart} duration={duration} chairId={chair.chairId}
          appointmentId={doctorId === a.doctorId ? a.id : undefined} onPickChair={chair.multi ? chair.pick : undefined}
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
 * Кресло приёма (V210) в карточке: то же поле «Кресло», что в записи; время то же. Кресло врача — снова «по креслу
 * врача». Занято — сервер ответит 409 с предложением свободного (withChairConfirm спросит «записать туда?»).
 */
export function ChairEdit({ appointment: a, onDone }: { appointment: Appointment; onDone: () => void }) {
  const action = useAppointmentAction(a)
  const chair = useChairChoice(a.doctorId, a.chairId ?? null)
  const duration = a.startAt && a.endAt ? Math.round((Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000) : 30
  return (
    <form className="form sub-form" aria-label="Кресло приёма" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'chair', body: { version: a.version, chairId: chair.chairId } }, { onSuccess: onDone })
    }}>
      <ChairSelect doctorId={a.doctorId} startAt={a.startAt} duration={duration} appointmentId={a.id} value={chair.chairId} onChange={chair.pick} />
      {/* Кресло сменили — что ответит сервер (занято, часы коллеги, «врачу кресла придёт уведомление») */}
      {a.startAt && chair.chairId !== (a.chairId ?? undefined) && (
        <ChairTimeHint doctorId={a.doctorId} startAt={a.startAt} duration={duration} chairId={chair.chairId} appointmentId={a.id}
          action="Сохранить" onPickChair={chair.pick} hidden={isChairError(action.error)} />
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
        <Select value={chosen} onChange={(e) => setServiceId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">—</option>
          {offered.map((s) => <option key={s.id} value={s.id}>{s.name}{prices && s.priceSom != null ? ` · ${somText(s.priceSom)}` : ''}{s.active === false ? ' · не в прайсе' : ''}</option>)}
        </Select>
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

const REPLIES = [['CONFIRMED', 'Придёт'], ['RESCHEDULE', 'Перенос'], ['NO_ANSWER', 'Нет ответа']] as const

/**
 * Напомнить о приёме и отметить ответ — как в «Дне» приложения:
 * - Telegram (пациент записывался через бота): сообщение с кнопками «Приду / Перенести» шлёт бот;
 *   отметку «напомнили» сервер ставит после доставки;
 * - WhatsApp: готовый текст в wa.me и отметка «напомнили» сразу (ответ придёт в WhatsApp);
 * - SMS (телефон): у пациента нет ни Telegram, ни WhatsApp — «Сообщения» телефона врача с тем же
 *   текстом и ссылкой на бота (ответить и получать напоминания в Telegram); уходит с его номера;
 * - текст — свой текст клиники («Настройки» → «Напоминание о приёме») или стандартный (useReminderText);
 * - уже напоминали (reminderOpenedAt) — у кнопок «Уже напоминали: сегодня в 10:15», нажатие спрашивает
 *   «Отправить ещё раз?» (ответил «Приду» — «Всё равно напомнить?»), и уходит другой текст — повтор
 *   («Напоминаем ещё раз…»: бот сам, WhatsApp/SMS — useRepeatReminderText);
 * - ответ пациента (по телефону, в WhatsApp) — «Придёт / Перенос / Нет ответа», повторное нажатие снимает.
 */
export function Remind({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  const first = useReminderText()
  const again = useRepeatReminderText()
  // Повторный текст — когда уже напоминали; спрашиваем ещё и когда пациент уже ответил «Приду»
  const repeat = Boolean(a.reminderOpenedAt)
  const asks = isRepeat(a)
  const text = repeat ? again : first
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const smsText = text?.(a) ?? ''
  const canRemind = a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const telegramRemind = async () => {
    if (await confirmRemind(a)) action.mutate({ kind: 'remindTelegram' })
  }
  const whatsapp = async () => {
    // Повтор — сначала вопрос; первое напоминание — сразу, чтобы ссылка открылась по нажатию
    if (asks && !(await confirmRemind(a))) return
    opened.mutate()
    // openLink: в Telegram ссылка откроется во внешнем браузере / WhatsApp, а не внутри Mini App
    openLink(whatsappUrl(contactPhone(a.patient) ?? '', smsText))
  }
  const sms = (phone: string) => {
    opened.mutate()
    // В Telegram ссылка sms: молчит — своя страница в браузере телефона откроет «Сообщения»
    if (telegram()) openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: phone, body: smsText })}`)
    else window.location.href = smsUrl(phone, smsText)
  }
  return (
    <section className="remind" aria-label="Напоминание">
      {canRemind && a.reminderOpenedAt && (
        <p className="hint small remind-last">Уже напоминали: {remindedText(a.reminderOpenedAt)}
          {a.reply === 'CONFIRMED' ? ' · пациент ответил «Приду»' : ''}. Ещё раз — другим текстом: «Напоминаем ещё раз…»</p>
      )}
      {canRemind && (
        <div className="actions">
          {a.patient.telegram && (
            <button type="button" className="btn" disabled={action.isPending} onClick={() => void telegramRemind()}>
              Напомнить в Telegram
            </button>
          )}
          {contactPhone(a.patient) && (
            <button type="button" className="btn" disabled={!text || opened.isPending}
              onClick={() => void whatsapp()}>Напомнить в WhatsApp</button>
          )}
          {/* Ссылкой, а не из скрипта: так «Сообщения» открываются надёжнее; на компьютере SMS не отправить */}
          {contactPhone(a.patient) && isMobile() && text && (
            <a className="btn" href={smsUrl(contactPhone(a.patient)!, smsText)} onClick={(e) => {
              const phone = contactPhone(a.patient)!
              if (asks) {
                // Повтор: сначала вопрос, потом «Сообщения» сами
                e.preventDefault()
                void confirmRemind(a).then((ok) => ok && sms(phone))
                return
              }
              opened.mutate()
              // В Telegram ссылка sms: молчит — своя страница в браузере телефона откроет «Сообщения»
              if (!telegram()) return
              e.preventDefault()
              openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: phone, body: smsText })}`)
            }}>Напомнить по SMS</a>
          )}
        </div>
      )}
      <div className="segments" role="group" aria-label="Ответ пациента">
        {REPLIES.map(([reply, title]) => (
          <button key={reply} type="button" aria-pressed={a.reply === reply} disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'reply', body: { version: a.version, reply: a.reply === reply ? 'NONE' : reply } })}>
            {title}
          </button>
        ))}
      </div>
      {(action.error ?? opened.error) && <p className="error" role="alert">{errorText(action.error ?? opened.error)}</p>}
    </section>
  )
}

/**
 * «Заметка о приёме»: что сделали, что дальше — медданные. Пишут врач приёма и админ; ассистент и
 * другие врачи пациента только читают (`editable: false` — без поля и диктовки, с «Врач: …»);
 * регистратуре сервер не отдаёт (403 — нет блока). В медкарте пациента — в «Заметках о визитах».
 */
export function VisitNote({ appointment: a }: { appointment: Appointment }) {
  const client = useQueryClient()
  const note = useQuery({
    queryKey: ['note', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/note', { params: { path: { id: a.id } } })),
    retry: false,
  })
  const [text, setText] = useState<string | null>(null)
  const save = useMutation<Schemas['ChartControllerNoteView'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/appointments/{id}/note', { params: { path: { id: a.id } }, body: { note: (text ?? '').trim() } })),
    onSuccess: (saved) => {
      client.setQueryData(['note', a.id], saved)
      void client.invalidateQueries({ queryKey: ['notes'] })
      setText(null)
    },
  })
  // Пока идёт диктовка, поле заметки прячем: заметка — в экране «Проверьте», чтобы не было двух полей
  const [dictating, setDictating] = useState(false)
  if (note.isPending || note.error) return null
  if (note.data.editable === false) {
    // Чужой приём: только прочитать — менять заметку может врач приёма или админ (сервер ответит 403)
    if (!note.data.note) return null
    return (
      <section className="form" aria-label="Заметка о приёме">
        <span className="hint">Заметка о приёме{note.data.doctorName ? ` · Врач: ${note.data.doctorName}` : ''}</span>
        <p className="continue-note">{note.data.note}</p>
      </section>
    )
  }
  const value = text ?? note.data.note ?? ''
  const changed = text != null && text.trim() !== (note.data.note ?? '')
  return (
    <>
    {/* Диктовка — первой: врач говорит, ИИ раскладывает по зубам, плану и заметке */}
    {a.patient.id != null && <Dictation appointment={a} note={value} onActive={setDictating} />}
    {!dictating && <form className="form" aria-label="Заметка о приёме" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Заметка о приёме</span>
        <textarea rows={3} maxLength={2000} value={value} placeholder="Что сделали, что дальше — видят врач и руководитель"
          onChange={(e) => setText(e.target.value)} />
      </label>
      {changed && <button type="submit" className="btn" disabled={save.isPending}>Сохранить заметку</button>}
      {save.isSuccess && !changed && <p className="tone-ok small" role="status">Сохранено</p>}
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
    </form>}
    </>
  )
}
