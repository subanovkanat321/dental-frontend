import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlerts } from '../medical/Anamnesis'
import { useClose } from '../lib/useClose'
import { canEditDoctor, isAssistant, seesMoneyOf } from '../lib/roles'
import { debtLine } from '../lib/debt'
import { sourceChoices, sourceText, useSources } from '../lib/sources'
import { formatPhone, shortDate, somText, todayIn } from '../lib/time'
import { ContactButtons } from '../schedule/Contact'
import { statusOf } from '../schedule/status'
import { PatientForm } from './PatientForm'
import { VisitDocs } from '../print/VisitDocs'
import { WaitlistBox } from './WaitlistTab'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Сколько прошлых визитов показать сразу: остальные — «Показать все». */
const PAST = 10

/** «34 года»: полных лет на сегодня по дате рождения 'YYYY-MM-DD'. */
function ageText(birth: string, today = todayIn()): string {
  const years = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0)
  const n = years % 100
  const word = n >= 11 && n <= 14 ? 'лет' : years % 10 === 1 ? 'год' : [2, 3, 4].includes(years % 10) ? 'года' : 'лет'
  return `${years} ${word}`
}

/**
 * Карточка пациента справа: контакты, сколько раз был / не пришёл, ближайшие записи, история,
 * долги. «Записать» — «Новая запись» в «Расписании» на него; «Медкарта» — карта зубов, план,
 * заметки и снимки во всю ширину.
 */
export function PatientPanel({ patientId, me, onClose, onBook, onMedical, onOpenAppointment }: {
  patientId: number
  me: Me
  onClose: () => void
  onBook: (p: Patient) => void
  onMedical: (p: Patient) => void
  /** Визит или долг → карточка приёма в «Расписании». */
  onOpenAppointment?: (appointmentId: number) => void
}) {
  useClose(onClose)
  const [editing, setEditing] = useState(false)
  const [allPast, setAllPast] = useState(false)
  // Визит, у которого открыты «Памятка и квитанция» — один за раз
  const [docsOf, setDocsOf] = useState<number | null>(null)
  // Деньги и заметки — админу и врачу; регистратуре сервер их не отдаст
  const staff = Boolean(me.admin || me.doctorId != null)
  // Медкарту сервер (ChartService) открывает админу клиники, врачам и ассистентам; регистратуре — никогда
  const clinical = Boolean(me.admin && !me.clinic?.independentDoctors) || me.doctorId != null || isAssistant(me)

  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId } } })),
  })
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
  })
  // Заметки о приёмах — медданные: сервер отдаст только его врачу и админу, иначе — без них
  const notes = useQuery({
    // Тот же ключ, что у медкарты: заметку сохранили на приёме (['notes']) — обновятся оба экрана
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId } } })),
    enabled: staff,
    retry: false,
  })
  const noteOf = new Map((notes.data ?? []).map((n) => [n.appointmentId, n.note]))

  // Плашка из анкеты — только тем, кто видит медкарту (врач и админ); регистратуре сервер не отдаст
  const anamnesis = useAnamnesis(patientId, Boolean(me.admin || me.doctorId != null))
  const doctorName = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName
  const many = (me.doctors ?? []).length > 1
  const line = (a: Appointment) => {
    const s = statusOf(a)
    const note = noteOf.get(a.id)
    const body = (
      <>
        <span className="nowrap num">{shortDate(a.startAt!, true)}</span>
        {' '}<span className={`chip small s-${s.kind}`}><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</span>
        {a.serviceName && <span className="hint"> · {a.serviceName}</span>}
        {many && <span className="hint"> · {doctorName(a.doctorId)}</span>}
        {note && <span className="visit-note">📝 {note}</span>}
      </>
    )
    return (
      <li key={a.id} className={a.status === 'NO_SHOW' || a.status === 'CANCELLED' ? 'struck' : undefined}>
        {onOpenAppointment ? <button type="button" className="visit-link" onClick={() => onOpenAppointment(a.id!)}>{body}</button> : body}
        {a.status === 'DONE' && canEditDoctor(me, a.doctorId) && (
          <button type="button" className="link small" aria-expanded={docsOf === a.id}
            onClick={() => setDocsOf(docsOf === a.id ? null : a.id!)}>
            {seesMoneyOf(me, a.doctorId) && (a.paidSom != null || a.chargeSom != null) ? '📋 Памятка и квитанция' : '📋 Памятка'}</button>
        )}
        {docsOf === a.id && <VisitDocs appointment={a} me={me} />}
      </li>
    )
  }

  if (card.isPending) {
    return <aside className="panel" aria-label="Карточка пациента"><p className="hint">Загрузка…</p></aside>
  }
  if (card.error) {
    return (
      <aside className="panel" aria-label="Карточка пациента">
        <p className="error">{card.error.message}</p>
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </aside>
    )
  }
  const { patient, done, noShow, cancelled, upcoming = [], past = [] } = card.data
  // Ассистент меняет пациента и лист ожидания только у пациентов своих врачей (или ещё ни разу не
  // записанных) — как сервер (PatientAccess); чужого он только смотрит
  const visits = [...upcoming, ...past]
  const mine = !isAssistant(me) || visits.length === 0 || visits.some((a) => a.doctorId != null && me.assistantOf!.includes(a.doctorId))
  const shownPast = allPast ? past : past.slice(0, PAST)

  return (
    <aside className="panel" aria-label="Карточка пациента">
      <header className="panel-head">
        <div>
          <h2>{patient?.fullName}</h2>
          {patient?.phone && <span className="hint num">{formatPhone(patient.phone)}</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {editing && patient ? <PatientForm patient={patient} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : mine && (
        <button type="button" className="link" onClick={() => setEditing(true)}>Изменить данные пациента</button>
      )}
      <p className="hint">
        {patient?.telegram ? 'Пишет боту — напоминания в Telegram' : 'Без бота — напоминание в WhatsApp'}
        {patient?.birthDate ? ` · ${shortDate(`${patient.birthDate}T12:00:00Z`)} (${ageText(patient.birthDate)})` : ''}
        {patient?.workplace ? ` · 💼 ${patient.workplace}` : ''}
      </p>
      {patient && <SourceLine patient={patient} canEdit={Boolean(mine)} />}
      <p className="stats">
        <span className="chip small s-done">Был: <b className="num">{done ?? 0}</b></span>
        <span className={`chip small ${noShow ? 's-bad' : 's-quiet'}`}>Не пришёл: <b className="num">{noShow ?? 0}</b></span>
        <span className="chip small s-quiet">Отмен: <b className="num">{cancelled ?? 0}</b></span>
      </p>
      <MedAlerts an={anamnesis.data} />

      <button type="button" className="btn primary" onClick={() => patient && onBook(patient)}>＋ Записать</button>
      <ContactButtons phone={patient?.phone} />
      {patient && mine && <WaitlistBox patient={patient} me={me} />}
      {(debts.data ?? []).map((d) => {
        const debt = debtLine(d)
        if (!debt) return null
        const text = `🧾 ${debt.text} — приём ${d.startAt ? shortDate(d.startAt) : ''}`
        return onOpenAppointment
          ? <button key={d.appointmentId} type="button" className={`btn debt-line tone-${debt.tone}`} onClick={() => onOpenAppointment(d.appointmentId!)}>{text}</button>
          : <p key={d.appointmentId} className={`tone-${debt.tone}`}>{text}</p>
      })}
      {staff && patient && <PatientExpenses patient={patient} me={me} />}

      <section>
        <h3>Записан</h3>
        {upcoming.length ? <ul className="visits">{upcoming.map(line)}</ul> : <p className="hint">Нет будущих записей</p>}
      </section>
      <section>
        <h3>История</h3>
        {past.length ? <ul className="visits">{shownPast.map(line)}</ul> : <p className="hint">Визитов ещё не было</p>}
        {past.length > shownPast.length && <button type="button" className="link" onClick={() => setAllPast(true)}>Показать все ({past.length})</button>}
      </section>

      {clinical && <button type="button" className="btn" onClick={() => patient && onMedical(patient)}>Медкарта и снимки</button>}
    </aside>
  )
}

const LAB = 'Зуботехническая лаборатория'

/**
 * Расходы по пациенту (техник, лаборатория): итог и список; «＋ Расход по пациенту» — сумма,
 * статья (по умолчанию лаборатория), комментарий. Расход попадает в «Кассу → Расходы».
 */
function PatientExpenses({ patient, me }: { patient: Patient; me: Me }) {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: ['expenses', 'patient', patient.id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/expenses', { params: { path: { patientId: patient.id! } } })),
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(LAB)
  const [comment, setComment] = useState('')
  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/expenses', {
      body: {
        spentOn: todayIn(), amountSom: Number(amount), category: category.trim(), comment: comment.trim() || undefined,
        patientId: patient.id, doctorId: me.doctorId ?? undefined,
      },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['expenses'] })
      setOpen(false)
      setAmount('')
      setComment('')
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  const items = list.data ?? []
  const total = items.reduce((sum, x) => sum + (x.amountSom ?? 0), 0)
  return (
    <div className="patient-expenses">
      {items.length > 0 && (
        <p className="hint">💸 Расходы по пациенту: <b className="num">{somText(total)}</b> — {items.map((x) => `${(x.category ?? '').toLowerCase()} ${somText(x.amountSom ?? 0)}`).join(', ')}</p>
      )}
      {open ? (
        <form className="form sub-form" aria-label="Расход по пациенту" onSubmit={submit}>
          <label className="field"><span>Сумма, сом</span>
            <input type="number" min={1} inputMode="numeric" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span>Статья</span>
            <input maxLength={60} required value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label className="field"><span>Комментарий (необязательно)</span>
            <input maxLength={200} placeholder="Например: коронка, 2 зуба" value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          {add.error && <p className="error" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={add.isPending}>Добавить расход</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>💸 Расход по пациенту (техник)</button>
      )}
    </div>
  )
}

/**
 * «Откуда узнал о клинике» — отдельной строкой: не указано — видно сразу, выбрать — одним нажатием
 * (раньше только в «Изменить данные», и пустое в карточке не показывалось). По нему — «Касса →
 * Аналитика → Откуда пациенты».
 */
function SourceLine({ patient: p, canEdit }: { patient: Schemas['PatientView']; canEdit: boolean }) {
  const client = useQueryClient()
  const sources = useSources()
  const save = useMutation<Schemas['PatientView'], ApiError, string>({
    mutationFn: (source) => unwrap(api.PUT('/api/patients/{id}', {
      params: { path: { id: p.id! } },
      body: { fullName: p.fullName ?? '', phone: p.phone ? `+${p.phone}` : '', allowDuplicate: true, birthDate: p.birthDate || undefined, workplace: p.workplace ?? '', sourceId: source ? Number(source) : undefined },
    })),
    onSuccess: () => { for (const key of ['patients', 'patient-card', 'appointments', 'sources']) void client.invalidateQueries({ queryKey: [key] }) },
  })
  return (
    <div className="source-line">
      <span className="hint">Откуда узнал о клинике</span>
      {canEdit ? (
        <select aria-label="Откуда узнал о клинике" value={p.sourceId ?? ''} disabled={save.isPending}
          className={p.sourceId != null ? '' : 'empty'} onChange={(e) => save.mutate(e.target.value)}>
          <option value="">— не указано, выбрать</option>
          {sourceChoices(sources.data, p.sourceId).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : <strong>{sourceText(sources.data, p.sourceId)}</strong>}
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}
