import '../schedule/attention.css'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useEffect, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings, useWaitlist } from '../api/settings'
import { agoText, recallText, recentlyInvited, whatsappUrl } from '../lib/texts'
import { formatPhone, shortDate } from '../lib/time'
import { openLink } from '../lib/telegram'
import { isAssistant } from '../lib/roles'
import { DateInput } from '../layout/DateInput'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { dueText, monthsText } from '../clinic/services'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { CalmRow, RowMenu } from './CalmList'
import { DAY_PARTS, dayPartOf, hhmm, WEEKDAYS, wishText, type Wish } from './wish'
import { EditButton } from '../layout/EditButton'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']

/**
 * «Лист ожидания»: кто хочет прийти раньше или ждёт свободного окна. Записать — в «Новой записи»
 * (там же предложит этих пациентов на выбранное время); здесь — список и «Убрать».
 */
export function WaitlistTab({ me, onOpen }: { me: Me; onOpen: (patientId: number) => void }) {
  const client = useQueryClient()
  const list = useWaitlist()
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/waitlist/{id}', { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['waitlist'] }),
  })
  const doctor = (id?: number) => (id == null ? 'любой' : (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? '—')

  if (list.isPending) return <Loading />
  if (list.error) return <p className="error">{list.error.message}</p>
  const help = <SubHelp title="Лист ожидания">Укажите, когда пациенту удобно (время дня, дни недели, даты). Освободится подходящее окно — в «Расписании» появится «🔔 Окна»
    с «Предложить» (бот или WhatsApp); «Новая запись» на это время тоже предложит пациента. Записали — уберите из листа в карточке или в «⋯».</SubHelp>
  if (!list.data.length) {
    return <>{help}<WaitlistAdd me={me} /><EmptyState fill title="Пока никто не ждёт" /></>
  }
  return (
    <>
      {help}
      <WaitlistAdd me={me} />
      <ul className="calm-list" aria-label="Лист ожидания">
        {list.data.map((e) => (
          <CalmRow key={e.id} open={() => onOpen(e.patient!.id)} name={e.patient?.fullName}
            sub={[`${e.durationMinutes} мин`, e.doctorId == null ? 'к любому врачу' : doctor(e.doctorId), wishText(e.wish) === 'когда угодно' ? null : wishText(e.wish),
              e.upcoming?.startAt ? `записан ${shortDate(e.upcoming.startAt, true)}` : null].filter(Boolean).join(' · ')}
            meta={e.createdAt ? `ждёт с ${shortDate(e.createdAt)}` : null}
            menu={<RowMenu label={`Ещё: ${e.patient?.fullName ?? 'пациент'}`} items={[{
              label: 'Убрать из листа', tone: 'bad', disabled: remove.isPending,
              onSelect: () => void ask(`Убрать ${e.patient?.fullName ?? 'пациента'} из листа ожидания?`).then((ok) => ok && remove.mutate(e.id)),
            }]} />} />
        ))}
      </ul>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
    </>
  )
}

/** Сколько пациентов «Профосмотра» за раз. */
const RECALL_PAGE = 50

/**
 * «Позвать на профосмотр»: срок после последнего визита прошёл (срок — у услуги визита, нет — у
 * клиники; считает сервер), и никуда не записаны; сначала — кого ещё не звали.
 * Выбора месяцев здесь нет: срок задаётся в «Клиника → Услуги и цены», чтобы список у всех был один. WhatsApp — отметка «позвали» и готовый текст; «Записать» — «Новая запись» на пациента.
 */
export function RecallTab({ onOpen, onBook }: { onOpen: (patientId: number) => void; onBook: (p: Patient) => void }) {
  const client = useQueryClient()
  const settings = useSettings()
  // По 50 за раз; просим на одного больше — так видно, есть ли ещё («Показать ещё»)
  const [limit, setLimit] = useState(RECALL_PAGE)
  const due = useQuery({
    queryKey: ['recall', limit],
    queryFn: () => unwrap(api.GET('/api/appointments/recall', { params: { query: { limit: limit + 1 } } })),
    placeholderData: keepPreviousData,
  })
  const invite = async (p: Patient, months?: number, invitedAt?: string) => {
    // Звали на этой неделе — сначала спросить: второе сообщение подряд раздражает пациента
    if (invitedAt && recentlyInvited(invitedAt) && !(await ask(`Звали ${agoText(invitedAt)}. Позвать ещё раз?`, { ok: 'Позвать ещё раз' }))) return
    // Отметка «позвали» — не ждём ответа: WhatsApp открывается сразу, как в приложении
    void api.POST('/api/patients/{id}/recall-invited', { params: { path: { id: p.id } } })
      // Только эта строка — «позвали сейчас»: весь список (у большой клиники — тысячи) заново не качаем
      .then(({ response }) => {
        if (!response.ok) return
        const now = new Date().toISOString()
        client.setQueriesData<Schemas['RecallView'][]>({ queryKey: ['recall'] }, (list) =>
          list?.map((r) => (r.patient?.id === p.id ? { ...r, invitedAt: now } : r)))
      })
    openLink(whatsappUrl(p.phone!, recallText(p.fullName, settings.data?.clinicSignature, months, { invitedAt })))
  }

  if (due.isPending) return <Loading />
  if (due.error) return <p className="error">{due.error.message}</p>
  if (!due.data.length) return <EmptyState fill title="Звать некого" />
  const rows = due.data.slice(0, limit)
  const more = due.data.length > limit
  return (
    <div className="calm-stack">
      <SubHelp title="Профосмотр">Срок после последнего визита прошёл, и пациент никуда не записан; сначала — кого ещё не звали. Срок — у услуги визита
        или у клиники. «WhatsApp» — готовый текст и отметка «позвали»; записать — в «⋯» или в карточке.</SubHelp>
      <ul className="calm-list" aria-label="Позвать на профосмотр">
        {rows.map((r) => (
          <CalmRow key={r.patient?.id} open={() => onOpen(r.patient!.id)} name={r.patient?.fullName}
            sub={[r.lastVisit ? `был ${shortDate(r.lastVisit)}` : null, r.serviceName,
              r.dueOn ? `пора с ${dueText(r.dueOn)}${r.months != null ? ` (через ${monthsText(r.months)})` : ''}` : null].filter(Boolean).join(' · ')}
            meta={r.invitedAt ? `звали ${agoText(r.invitedAt)}` : 'ещё не звали'}
            action={<button type="button" className="btn" onClick={() => void invite(r.patient!, r.months, r.invitedAt)}>WhatsApp</button>}
            menu={<RowMenu label={`Ещё: ${r.patient?.fullName ?? 'пациент'}`} items={[{ label: 'Записать', onSelect: () => onBook(r.patient!) }]} />} />
        ))}
      </ul>
      {more && (
        <button type="button" className="btn" disabled={due.isFetching} onClick={() => setLimit(limit + RECALL_PAGE)}>
          {due.isFetching ? <><Spinner />Загрузка…</> : 'Показать ещё'}</button>
      )}
    </div>
  )
}

/**
 * В карточке пациента: «В лист ожидания» (к какому врачу, на сколько и когда удобно) или «Убрать» / «изменить» — как
 * кнопка в карточке приложения. Освободится подходящее окно — «🔔 Окна» в «Расписании» и «Новая запись» предложат пациента.
 */
export function WaitlistBox({ patient, me, defaultMinutes = 30, onCancel }: {
  patient: Patient
  me: Me
  defaultMinutes?: number
  /** «Отмена» у новой строки (карточка приёма: форма открыта ссылкой «＋ В лист ожидания») */
  onCancel?: () => void
}) {
  const client = useQueryClient()
  const list = useWaitlist()
  const entry = list.data?.find((e) => e.patient?.id === patient.id)
  const [editing, setEditing] = useState(false)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['waitlist'] })
    void client.invalidateQueries({ queryKey: ['waitlist-windows'] })
  }
  const add = useMutation<unknown, ApiError, WishForm>({
    mutationFn: (body) => unwrap(api.POST('/api/waitlist', { body: { patientId: patient.id, ...body } })),
    onSuccess: refresh,
  })
  const update = useMutation<unknown, ApiError, WishForm>({
    mutationFn: (body) => unwrap(api.PUT('/api/waitlist/{id}', { params: { path: { id: entry!.id } }, body })),
    onSuccess: () => { setEditing(false); refresh() },
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/waitlist/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
  const error = add.error ?? remove.error ?? update.error

  if (list.isPending) return null
  if (entry && !editing) {
    return (
      <div className="waitlist-box">
        <span className="chip s-wait">В листе ожидания{entry.createdAt ? ` с ${shortDate(entry.createdAt)}` : ''} · {entry.durationMinutes} мин</span>
        <span className="hint small">{wishText(entry.wish)}</span>
        <EditButton label="Изменить лист ожидания" onClick={() => setEditing(true)} />
        <button type="button" className="link" disabled={remove.isPending} onClick={() => remove.mutate(entry.id)}>убрать</button>
        {error && <p className="error">{error.message}</p>}
      </div>
    )
  }
  return (
    <WishFormBox me={me} initial={entry} defaultMinutes={defaultMinutes} busy={add.isPending || update.isPending} error={error}
      submit={entry ? 'Сохранить' : 'В лист ожидания'} onCancel={entry ? () => setEditing(false) : onCancel}
      onSubmit={(body) => (entry ? update.mutate(body) : add.mutate(body))} />
  )
}

type WaitlistEntry = Schemas['WaitlistView']
type WishForm = { doctorId?: number; durationMinutes: number; wish: Wish }

/**
 * Форма строки листа: длительность, врач и «Когда удобно» — даты «с … по …», время дня («утро / день / вечер» или свои часы),
 * дни недели и услуга. Ничего не выбрали в «Когда удобно» — подходит любое время.
 */
function WishFormBox({ me, initial, defaultMinutes, busy, error, submit, onSubmit, onCancel }: {
  me: Me
  initial?: WaitlistEntry
  defaultMinutes: number
  busy: boolean
  error: ApiError | null
  submit: string
  onSubmit: (body: WishForm) => void
  onCancel?: () => void
}) {
  // Ассистент ставит в лист только к своим врачам (сервер ответит 403)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id)))
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const w = initial?.wish
  const [minutes, setMinutes] = useState(initial?.durationMinutes ?? defaultMinutes)
  const [doctor, setDoctor] = useState(initial?.doctorId != null ? String(initial.doctorId) : '')
  const [open, setOpen] = useState(Boolean(w && wishText(w) !== 'когда угодно'))
  const [part, setPart] = useState(dayPartOf(w))
  const [from, setFrom] = useState(hhmm(w?.timeFrom) ?? '')
  const [to, setTo] = useState(hhmm(w?.timeTo) ?? '')
  const [days, setDays] = useState<number[]>(w?.weekdays ?? [])
  const [dateFrom, setDateFrom] = useState(w?.desiredFrom ?? '')
  const [dateTo, setDateTo] = useState(w?.desiredTo ?? '')
  const [service, setService] = useState(w?.serviceTypeId != null ? String(w.serviceTypeId) : '')
  const fieldError = (k: string) => error?.fieldErrors[k] ?? error?.fieldErrors[`wish.${k}`]
  const minuteOptions = [15, 30, 45, 60, 90, 120]
  if (!minuteOptions.includes(minutes)) minuteOptions.push(minutes)
  return (
    <form className="waitlist-box waitlist-wish" aria-label={initial ? 'Лист ожидания: изменить' : 'В лист ожидания'} onSubmit={(e) => {
      e.preventDefault()
      const preset = DAY_PARTS.find((p) => p.key === part)
      const wish: Wish = {
        timeFrom: preset ? preset.from : part === 'custom' && from ? from : undefined,
        timeTo: preset ? preset.to : part === 'custom' && to ? to : undefined,
        weekdays: days,
        desiredFrom: dateFrom || undefined,
        desiredTo: dateTo || undefined,
        serviceTypeId: service ? Number(service) : undefined,
      }
      onSubmit({ doctorId: doctor ? Number(doctor) : undefined, durationMinutes: minutes, wish })
    }}>
      <Select name="minutes" aria-label="Сколько нужно времени" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
        {minuteOptions.map((m) => <option key={m} value={m}>{m} мин</option>)}
      </Select>
      {doctors.length > 1 && (
        <Select name="doctor" aria-label="К какому врачу" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
          <option value="">к любому врачу</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
        </Select>
      )}
      {!open && <button type="button" className="link" onClick={() => setOpen(true)}>Когда удобно…</button>}
      {open && (
        <fieldset className="wish-fields">
          <legend>Когда удобно</legend>
          <div className="segments" role="group" aria-label="Время дня">
            {[{ key: '', label: 'Любое' }, ...DAY_PARTS, { key: 'custom', label: 'Свои часы' }].map((p) => (
              <button key={p.key} type="button" aria-pressed={part === p.key} onClick={() => setPart(p.key)}>{p.label}</button>
            ))}
          </div>
          {part === 'custom' && (
            <span className="wish-row">
              <label>с <input type="time" aria-label="Удобно с" value={from} step={900} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>до <input type="time" aria-label="Удобно до" value={to} step={900} onChange={(e) => setTo(e.target.value)} /></label>
            </span>
          )}
          {fieldError('timeTo') && <p className="error small">{fieldError('timeTo')}</p>}
          <div className="segments wish-days" role="group" aria-label="Дни недели">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={days.includes(i + 1)}
                onClick={() => setDays(days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1])}>{d}</button>
            ))}
          </div>
          <span className="wish-row">
            <label>с <DateInput aria-label="Удобно с даты" placeholder="любой день" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
            <label>по <DateInput aria-label="Удобно по дату" placeholder="без конца" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          </span>
          {fieldError('desiredTo') && <p className="error small">{fieldError('desiredTo')}</p>}
          {(services.data?.length ?? 0) > 0 && (
            <Select aria-label="Услуга" value={service} onChange={(e) => {
              setService(e.target.value)
              const s = services.data!.find((x) => String(x.id) === e.target.value)
              if (s && !initial) setMinutes(s.durationMinutes)
            }}>
              <option value="">услуга — любая</option>
              {services.data!.filter((s) => s.active || String(s.id) === service).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </fieldset>
      )}
      <button type="submit" className="btn" disabled={busy}>{submit}</button>
      {onCancel && <button type="button" className="link" onClick={onCancel}>отмена</button>}
      {error && !fieldError('timeTo') && !fieldError('desiredTo') && <p className="error">{error.message}</p>}
    </form>
  )
}

/**
 * «➕ Добавить в лист ожидания» прямо во вкладке, как в прежнем приложении: найти пациента по
 * имени или номеру, дальше — длительность и врач (тот же блок, что в карточке пациента).
 */
function WaitlistAdd({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: open && search.length >= 2 && !patient,
  })
  // Кнопка — в строку шапки «Пациентов» справа; открытая форма — карточкой над списком
  if (!open) return <HeadTools><button type="button" className="btn head-end" onClick={() => setOpen(true)}>＋ Добавить в лист ожидания</button></HeadTools>
  return (
    <section className="card-block waitlist-add" aria-label="Добавить в лист ожидания">
      {patient ? (
        <>
          <p><strong>{patient.fullName}</strong>{patient.phone && <span className="hint"> · {formatPhone(patient.phone)}</span>}
            {' '}<button type="button" className="link" onClick={() => setPatient(null)}>другой</button></p>
          <WaitlistBox patient={patient} me={me} />
        </>
      ) : (
        <>
          <input type="search" aria-label="Найти пациента для листа ожидания" placeholder="Имя или номер" autoFocus value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {found.data?.length ? (
            <ul className="found">
              {found.data.map((p) => (
                <li key={p.id}><button type="button" onClick={() => setPatient(p)}>
                  <strong>{p.fullName}</strong>{p.phone && <span className="hint"> · {formatPhone(p.phone)}</span>}
                </button></li>
              ))}
            </ul>
          ) : found.data ? <p className="hint small">Не нашли «{search}» — добавьте пациента в «Пациентах».</p> : null}
        </>
      )}
      <button type="button" className="link" onClick={() => { setOpen(false); setPatient(null); setQuery('') }}>Закрыть</button>
    </section>
  )
}
