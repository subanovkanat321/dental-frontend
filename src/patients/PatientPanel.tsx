import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlerts } from '../medical/Anamnesis'
import { useClose } from '../lib/useClose'
import { canEditDoctor, isAssistant, seesMoneyOf, seesAllMoney } from '../lib/roles'
import { debtLine } from '../lib/debt'
import { formatPhone, shortDate, somText, todayIn } from '../lib/time'
import { ContactButtons } from '../schedule/Contact'
import { statusOf } from '../schedule/status'
import { PatientForm } from './PatientForm'
import { VisitDocs } from '../print/VisitDocs'
import { WaitlistBox } from './WaitlistTab'
import { SourceLine } from './SourceLine'
import { FamilyBox } from './FamilyBox'
import { PatientExpenses } from './PatientExpenses'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Сколько прошлых визитов показать сразу: остальные — «Показать все». */
const PAST = 5

type Tab = 'visits' | 'medical' | 'money' | 'more'

/** «34 года»: полных лет на сегодня по дате рождения 'YYYY-MM-DD'. */
function ageText(birth: string, today = todayIn()): string {
  const years = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0)
  const n = years % 100
  const word = n >= 11 && n <= 14 ? 'лет' : years % 10 === 1 ? 'год' : [2, 3, 4].includes(years % 10) ? 'года' : 'лет'
  return `${years} ${word}`
}

/**
 * Карточка пациента справа — сверху вниз: шапка (имя, телефон, возраст, бот или WhatsApp) → аллергии
 * → «＋ Записать» и связаться → сводка (визиты, неявки, следующий приём, долг) → вкладки: «Визиты»
 * (записан, история — первые 5 и «Показать все»), «Медкарта» (карта зубов и план лечения, анкета,
 * снимки — во всю ширину), «Деньги» (долги, расходы), «Прочее» (данные, откуда узнал, лист
 * ожидания, семья).
 */
export function PatientPanel({ patientId, me, onClose, onBook, onMedical, onOpenAppointment, onOpenPatient }: {
  patientId: number
  me: Me
  onClose: () => void
  onBook: (p: Patient) => void
  onMedical: (p: Patient) => void
  /** Визит или долг → карточка приёма в «Расписании». */
  onOpenAppointment?: (appointmentId: number) => void
  /** Родственник из «Семьи» → его карточка. */
  onOpenPatient?: (patientId: number) => void
}) {
  useClose(onClose)
  const [editing, setEditing] = useState(false)
  const [allPast, setAllPast] = useState(false)
  // Вкладка карточки: визиты, медкарта, деньги, прочее — одна за раз
  const [tab, setTab] = useState<Tab>('visits')
  // Визит, у которого открыты «Памятка и квитанция» — один за раз
  const [docsOf, setDocsOf] = useState<number | null>(null)
  // Деньги и заметки — админу и врачу; регистратуре сервер их не отдаст
  const staff = Boolean(me.admin || me.doctorId != null)
  // Медкарту сервер (ChartService) открывает админу клиники, врачам и ассистентам; регистратуре — никогда
  const clinical = seesAllMoney(me) || me.doctorId != null || isAssistant(me)

  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId } } })),
  })
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
  })
  // Заметки о приёмах — медданные: сервер отдаст тем, кто видит медкарту (заметки всех врачей пациента), иначе — без них
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
    return <aside className="panel" aria-label="Карточка пациента"><Loading /></aside>
  }
  if (card.error) {
    return (
      <aside className="panel" aria-label="Карточка пациента">
        <p className="error">{card.error.message}</p>
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </aside>
    )
  }
  const { patient, done, noShow, upcoming = [], past = [] } = card.data
  // Ассистент меняет пациента и лист ожидания только у пациентов своих врачей (или ещё ни разу не
  // записанных) — как сервер (PatientAccess); чужого он только смотрит
  const visits = [...upcoming, ...past]
  const mine = !isAssistant(me) || visits.length === 0 || visits.some((a) => a.doctorId != null && me.assistantOf!.includes(a.doctorId))
  const shownPast = allPast ? past : past.slice(0, PAST)
  // Сводка: ближайшая запись и общий долг — с одного взгляда, подробности во вкладках
  const next = upcoming.filter((a) => a.status === 'SCHEDULED' || a.status === 'REQUESTED')
    .sort((x, y) => Date.parse(x.startAt!) - Date.parse(y.startAt!))[0]
  const debtRows = (debts.data ?? []).filter((d) => debtLine(d))
  const debtTotal = debtRows.reduce((sum, d) => sum + (d.debtSom ?? 0), 0)
  const overdue = debtRows.some((d) => debtLine(d)?.tone === 'bad')
  const tabs: [Tab, string][] = [
    ['visits', 'Визиты'],
    ...(clinical ? [['medical', 'Медкарта'] as [Tab, string]] : []),
    ...(staff || debtRows.length ? [['money', 'Деньги'] as [Tab, string]] : []),
    ['more', 'Прочее'],
  ]
  const shown = tabs.some(([key]) => key === tab) ? tab : 'visits'
  const about = [
    patient?.birthDate ? `${shortDate(`${patient.birthDate}T12:00:00Z`)} (${ageText(patient.birthDate)})` : null,
    patient?.workplace ? `💼 ${patient.workplace}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <aside className="panel patient-card" aria-label="Карточка пациента">
      {/* Шапка: имя, телефон, возраст и как ему пишем */}
      <header className="panel-head">
        <div>
          <h2>{patient?.fullName}</h2>
          <span className="hint">
            {patient?.phone && <span className="num">{formatPhone(patient.phone)}</span>}
            {patient?.birthDate && ` · ${ageText(patient.birthDate)}`}
            {` · ${patient?.telegram ? 'пишет боту' : 'без бота — WhatsApp'}`}
          </span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <MedAlerts an={anamnesis.data} />
      <div className="patient-actions">
        <button type="button" className="btn primary" onClick={() => patient && onBook(patient)}>＋ Записать</button>
        <ContactButtons phone={patient?.phone} />
      </div>

      {/* Сводка: визиты (и неявки), ближайшая запись, долг */}
      <dl className="patient-summary">
        <div><dt>Визитов</dt><dd><span className="num">{done ?? 0}</span>
          {(noShow ?? 0) > 0 && <span className="summary-bad">не пришёл <span className="num">{noShow}</span></span>}</dd></div>
        <div><dt>Следующий</dt><dd>{next ? <span className="num">{shortDate(next.startAt!, true)}</span> : 'не записан'}</dd></div>
        {debtTotal > 0 && <div className={overdue ? 'tone-bad' : 'tone-wait'}><dt>Долг</dt><dd className="num">{somText(debtTotal)}</dd></div>}
      </dl>

      {/* «Откуда узнал» не указано — видно сразу и выбирается одним нажатием; указано — в «Прочем» */}
      {patient && patient.sourceId == null && <SourceLine patient={patient} canEdit={Boolean(mine)} />}

      <div className="segments tabs" role="tablist" aria-label="Разделы карточки пациента">
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={shown === key} aria-pressed={shown === key} onClick={() => setTab(key)}>{title}</button>
        ))}
      </div>

      {shown === 'visits' && (
        <>
          <section>
            <h3>Записан</h3>
            {upcoming.length ? <ul className="visits">{upcoming.map(line)}</ul> : <p className="hint">Нет будущих записей</p>}
          </section>
          <section>
            <h3>История</h3>
            {past.length ? <ul className="visits">{shownPast.map(line)}</ul> : <EmptyState compact title="Визитов ещё не было" />}
            {past.length > shownPast.length && <button type="button" className="link" onClick={() => setAllPast(true)}>Показать все ({past.length})</button>}
          </section>
        </>
      )}

      {/* Медкарта — одна точка входа: карта зубов и план лечения, анкета, заметки, снимки */}
      {shown === 'medical' && (
        <section className="patient-medical">
          <p>Карта зубов и план лечения, анкета, заметки о визитах, снимки.</p>
          <button type="button" className="btn" onClick={() => patient && onMedical(patient)}>Открыть медкарту</button>
        </section>
      )}

      {shown === 'money' && (
        <section className="patient-money">
          {debtRows.length === 0 && <EmptyState compact title="Долгов нет" />}
          {debtRows.map((d) => {
            const debt = debtLine(d)!
            const text = `🧾 ${debt.text} — приём ${d.startAt ? shortDate(d.startAt) : ''}`
            return onOpenAppointment
              ? <button key={d.appointmentId} type="button" className={`btn debt-line tone-${debt.tone}`} onClick={() => onOpenAppointment(d.appointmentId!)}>{text}</button>
              : <p key={d.appointmentId} className={`tone-${debt.tone}`}>{text}</p>
          })}
          {staff && patient && <PatientExpenses patient={patient} me={me} />}
        </section>
      )}

      {shown === 'more' && (
        <section className="patient-more">
          {editing && patient ? <PatientForm patient={patient} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : (
            <>
              {about && <p>{about}</p>}
              {mine && <button type="button" className="link" onClick={() => setEditing(true)}>Изменить данные пациента</button>}
            </>
          )}
          {patient && patient.sourceId != null && <SourceLine patient={patient} canEdit={Boolean(mine)} />}
          {patient && mine && <WaitlistBox patient={patient} me={me} />}
          {patient && mine && <FamilyBox patient={patient} me={me} onOpenPatient={onOpenPatient} />}
        </section>
      )}
    </aside>
  )
}
