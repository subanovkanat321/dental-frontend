import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useEffect, useState } from 'react'

import { rowClick } from '../lib/rowClick'
import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings, useWaitlist } from '../api/settings'
import { agoText, recallText, whatsappUrl } from '../lib/texts'
import { formatPhone, shortDate } from '../lib/time'
import { openLink } from '../lib/telegram'
import { isAssistant } from '../lib/roles'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { dueText, monthsText } from '../clinic/services'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools } from '../layout/PageHead'

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
  if (!list.data.length) {
    return <><WaitlistAdd me={me} /><EmptyState fill title="Пока никто не ждёт">Добавьте пациента — когда освободится время, CRM подскажет, кого позвать.</EmptyState></>
  }
  return (
    <>
      <WaitlistAdd me={me} />
      <table className="table" aria-label="Лист ожидания">
        <thead><tr><th>Пациент</th><th>Телефон</th><th>Врач</th><th>Нужно</th><th>Сейчас записан</th><th>Ждёт с</th><th /></tr></thead>
        <tbody>
          {list.data.map((e) => (
            <tr key={e.id} className="clickable" onClick={rowClick(() => onOpen(e.patient!.id))}>
              <td><button type="button" className="row-link" onClick={() => onOpen(e.patient!.id)}>{e.patient?.fullName}</button></td>
              <td className="nowrap num">{e.patient?.phone ? formatPhone(e.patient.phone) : '—'}</td>
              <td>{doctor(e.doctorId)}</td>
              <td className="nowrap num">{e.durationMinutes} мин</td>
              <td className="nowrap">{e.upcoming?.startAt ? shortDate(e.upcoming.startAt, true) : <span className="hint">нет записи</span>}</td>
              <td className="nowrap hint">{e.createdAt ? agoText(e.createdAt) : ''}</td>
              <td className="r"><button type="button" className="btn small ghost" disabled={remove.isPending}
                onClick={() => void ask(`Убрать ${e.patient?.fullName ?? 'пациента'} из листа ожидания?`).then((ok) => ok && remove.mutate(e.id))}
                aria-label={`Убрать из листа: ${e.patient?.fullName}`}>Убрать</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      <p className="hint small">Освободилось время — нажмите на него в «Расписании»: «Новая запись» предложит этих пациентов.</p>
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
  const invite = (p: Patient, months?: number) => {
    // Отметка «позвали» — не ждём ответа: WhatsApp открывается сразу, как в приложении
    void api.POST('/api/patients/{id}/recall-invited', { params: { path: { id: p.id } } })
      // Только эта строка — «позвали сейчас»: весь список (у большой клиники — тысячи) заново не качаем
      .then(({ response }) => {
        if (!response.ok) return
        const now = new Date().toISOString()
        client.setQueriesData<Schemas['RecallView'][]>({ queryKey: ['recall'] }, (list) =>
          list?.map((r) => (r.patient?.id === p.id ? { ...r, invitedAt: now } : r)))
      })
    openLink(whatsappUrl(p.phone!, recallText(p.fullName, settings.data?.clinicSignature, months)))
  }

  if (due.isPending) return <Loading />
  if (due.error) return <p className="error">{due.error.message}</p>
  if (!due.data.length) return <EmptyState fill title="Звать некого — все записаны или были недавно" />
  const rows = due.data.slice(0, limit)
  const more = due.data.length > limit
  return (
    <>
    <table className="table" aria-label="Позвать на профосмотр">
      <thead><tr><th>Пациент</th><th>Телефон</th><th>Последний визит</th><th>Пора с</th><th>Позвали</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.patient?.id} className="clickable" onClick={rowClick(() => onOpen(r.patient!.id))}>
            <td><button type="button" className="row-link" onClick={() => onOpen(r.patient!.id)}>{r.patient?.fullName}</button></td>
            <td className="nowrap num">{r.patient?.phone ? formatPhone(r.patient.phone) : '—'}</td>
            <td>{r.lastVisit ? shortDate(r.lastVisit) : '—'}{r.serviceName && <span className="hint"> · {r.serviceName}</span>}</td>
            <td className="nowrap">{r.dueOn ? dueText(r.dueOn) : '—'}{r.months != null && <span className="hint small"> · через {monthsText(r.months)}</span>}</td>
            <td className="nowrap hint">{r.invitedAt ? agoText(r.invitedAt) : 'ещё не звали'}</td>
            <td className="r nowrap">
              <button type="button" className="btn small" onClick={() => invite(r.patient!, r.months)}>WhatsApp</button>{' '}
              <button type="button" className="btn small primary" onClick={() => onBook(r.patient!)}>Записать</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {more && (
      <button type="button" className="btn" disabled={due.isFetching} onClick={() => setLimit(limit + RECALL_PAGE)}>
        {due.isFetching ? <><Spinner />Загрузка…</> : 'Показать ещё'}</button>
    )}
    </>
  )
}

/**
 * В карточке пациента: «В лист ожидания» (к какому врачу и на сколько) или «Убрать» — как
 * кнопка в карточке приложения. Освободится окно — «Новая запись» предложит пациента.
 */
export function WaitlistBox({ patient, me, defaultMinutes = 30 }: { patient: Patient; me: Me; defaultMinutes?: number }) {
  const client = useQueryClient()
  const list = useWaitlist()
  const entry = list.data?.find((e) => e.patient?.id === patient.id)
  // Ассистент ставит в лист только к своим врачам (сервер ответит 403)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id)))
  const refresh = () => client.invalidateQueries({ queryKey: ['waitlist'] })
  const add = useMutation<unknown, ApiError, { doctorId?: number; durationMinutes: number }>({
    mutationFn: (body) => unwrap(api.POST('/api/waitlist', { body: { patientId: patient.id, ...body } })),
    onSuccess: refresh,
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/waitlist/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
  const error = add.error ?? remove.error

  if (list.isPending) return null
  if (entry) {
    return (
      <div className="waitlist-box">
        <span className="chip s-wait">В листе ожидания{entry.createdAt ? ` с ${shortDate(entry.createdAt)}` : ''} · {entry.durationMinutes} мин</span>
        <button type="button" className="link" disabled={remove.isPending} onClick={() => remove.mutate(entry.id)}>убрать</button>
        {error && <p className="error">{error.message}</p>}
      </div>
    )
  }
  return (
    <form className="waitlist-box" aria-label="В лист ожидания" onSubmit={(e) => {
      e.preventDefault()
      const form = new FormData(e.currentTarget)
      const doctor = String(form.get('doctor') ?? '')
      add.mutate({ doctorId: doctor ? Number(doctor) : undefined, durationMinutes: Number(form.get('minutes')) })
    }}>
      <Select name="minutes" aria-label="Сколько нужно времени" defaultValue={defaultMinutes}>
        {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} мин</option>)}
      </Select>
      {doctors.length > 1 && (
        <Select name="doctor" aria-label="К какому врачу" defaultValue="">
          <option value="">к любому врачу</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
        </Select>
      )}
      <button type="submit" className="btn" disabled={add.isPending}>В лист ожидания</button>
      {error && <p className="error">{error.message}</p>}
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
  if (!open) return <HeadTools><button type="button" className="btn head-end" onClick={() => setOpen(true)}>➕ Добавить в лист ожидания</button></HeadTools>
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
