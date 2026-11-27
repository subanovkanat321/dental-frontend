import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlertPill } from '../medical/Anamnesis'
import { useClose } from '../lib/useClose'
import { useBigByDefault } from '../lib/fullView'
import { canEditDoctor, isAssistant, seesAdvance, seesMoneyOf, seesAllMoney } from '../lib/roles'
import { debtLine, remindedText, seesDebts } from '../lib/debt'
import { DebtPromiseForm, DebtRemindForm } from '../cash/DebtRemind'
import { formatPhone, shortDate, somText } from '../lib/time'
import { ageYears, childText, yearsText } from '../lib/age'
import { ContactMenu } from '../schedule/ContactMenu'
import { talkItems, type ContactItem } from '../schedule/contactItems'
import { invitedHint } from '../schedule/botInvite'
import { useBotInvite } from '../schedule/useBotInvite'
import { statusOf } from '../schedule/status'
import { PatientForm } from './PatientForm'
import { VisitDocs } from '../print/VisitDocs'
import { WaitlistBox } from './WaitlistTab'
import { SourceLine } from './SourceLine'
import { FamilyBox } from './FamilyBox'
import { ReferralBox } from '../refer/ReferralBox'
import { AdvanceBox } from './AdvanceBox'
import { advanceText, useAdvance } from './advance'
import { PatientTasks } from '../tasks/PatientTasks'
import { PatientLab } from '../lab/PatientLab'
import { GuardianBox } from './GuardianBox'
import { KidInfo } from './KidInfo'
import { PatientExpenses } from './PatientExpenses'
import { ContractBox } from '../contract/ContractBox'
import { Loading } from '../layout/Loading'
import { OpeningDebtsBox } from '../cash/OpeningDebts'
import { EmptyState } from '../layout/EmptyState'
import { ActionMenu, type ActionItem } from '../layout/ActionMenu'
import { CloseButton } from '../layout/SheetHead'
import { PlanProgressLine } from '../medical/PlanProgress'
import { PatientTagsLine } from '../tags/TagDots'
import { serviceLabel } from '../schedule/lineLabel'
import { PatientHistory } from './PatientHistory'
import { DuplicatesLine } from './Duplicates'
import { MoneySummary } from './MoneySummary'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Сколько прошлых визитов показать сразу: остальные — «Показать все». */
const PAST = 5

type Tab = 'visits' | 'medical' | 'money' | 'history' | 'more'

/** «1 неявка», «3 неявки» — в строке денег шапки. */
function noShowText(n: number | undefined): string {
  const k = n ?? 0
  const m10 = k % 10
  const m100 = k % 100
  const word = m10 === 1 && m100 !== 11 ? 'неявка' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'неявки' : 'неявок'
  return `${k} ${word}`
}

/** «34 года»: полных лет на сегодня по дате рождения 'YYYY-MM-DD'. */
function ageText(birth: string): string {
  return yearsText(ageYears(birth) ?? 0)
}

/**
 * Карточка пациента справа — сверху вниз: шапка (имя, телефон, возраст, бот или WhatsApp; ⚠ аллергия пилюлей, как в
 * карточке приёма; метки; деньги и неявки строкой; лечащий врач; «Следующий визит ›») → «＋ Записать» и связаться →
 * прогресс плана → вкладки: «Визиты» (предстоящие, прошлые — первые 5 и «Показать все»), «Медкарта» (нажатие сразу
 * открывает её во всю ширину), «Деньги» (долги, расходы), «История» (живая лента, шаг 8А), «Прочее» (данные, откуда узнал, представитель, лист ожидания,
 * семья, договор). Ребёнок — бейдж «Ребёнок, 7 лет» и строка представителя в шапке. Редкое (задача, лаборатория,
 * договор) — в «⋯». Плиток «Визитов / Следующий» нет: они повторяли вкладку «Визиты» (UX-аудит 2026-11-20).
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
  // Компьютер — сразу большой, как карточка приёма (2026-11-23); свернули — запомнится на этом компьютере
  const [full, toggleFull] = useBigByDefault()
  const [editing, setEditing] = useState(false)
  const [allPast, setAllPast] = useState(false)
  // Вкладка карточки: визиты, медкарта, деньги, прочее — одна за раз
  const [tab, setTab] = useState<Tab>('visits')
  // Визит, у которого открыты «Памятка и квитанция» — один за раз
  const [docsOf, setDocsOf] = useState<number | null>(null)
  // Договор открыли кнопкой «⋯ → Оформить договор» (счётчик — нажали ещё раз — снова раскрыть)
  const [contractAsked, setContractAsked] = useState<{ id: number; n: number } | null>(null)
  // «Деньги»: открытая форма — напомнить о долге или «обещал оплатить» (напомнить можно и из «Связаться»)
  const [debtForm, setDebtForm] = useState<'remind' | 'promise' | null>(null)
  // Окно «＋ Задача» или «＋ Заказ в лабораторию» из строки ссылок
  const [adding, setAdding] = useState<'task' | 'lab' | null>(null)
  // «⋯ → Ссылка «Приведи друга»» — открыть «Прочее» со ссылкой для друзей (2026-11-24)
  const [referralLink, setReferralLink] = useState(false)
  // Деньги и заметки — админу и врачу; регистратуре сервер их не отдаст
  const staff = Boolean(me.admin || me.doctorId != null)
  // Медкарту сервер (ChartService) открывает админу клиники, врачам и ассистентам; регистратуре — никогда
  const clinical = seesAllMoney(me) || me.doctorId != null || isAssistant(me)

  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId } } })),
  })
  // Что ещё этому сотруднику можно открыть у пациента — говорит сервер в карточке (правила ChartService и денег клиники):
  // чужой пациент врача или «Врачи работают отдельно» — анкету, план, заметки и долги прежней программы не просим, а не ловим
  // 403 в консоли (QA 2026-11-25). Пока карточки нет — ждём её; старый ответ без access — как раньше
  const medicalOk = card.data != null && (card.data.access?.medical ?? true)
  const moneyOk = card.data?.access?.money ?? true
  // «📲 Пригласить в Telegram-бот» в «Связаться» — пациенту без бота (хук — до ранних return)
  const botInviteOf = useBotInvite(card.data?.patient)
  // Аванс (V243): остаток счёта пациента или его семьи — в строке денег шапки и во вкладке «Деньги»
  const advance = useAdvance(patientId, seesAdvance(me))
  const advanceSom = advance.data?.balanceSom ?? 0
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
    // Ассистент денег не видит — сервер ответит 403, не спрашиваем (QA 2026-11-25)
    enabled: !isAssistant(me),
  })
  // Заметки о приёмах — медданные: сервер отдаст тем, кто видит медкарту (заметки всех врачей пациента), иначе — без них
  const notes = useQuery({
    // Тот же ключ, что у медкарты: заметку сохранили на приёме (['notes']) — обновятся оба экрана
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId } } })),
    enabled: staff && medicalOk,
    retry: false,
  })
  const noteOf = new Map((notes.data ?? []).map((n) => [n.appointmentId, n.note]))

  // Плашка из анкеты — только тем, кто видит медкарту (врач и админ); регистратуре сервер не отдаст
  const anamnesis = useAnamnesis(patientId, Boolean(me.admin || me.doctorId != null) && medicalOk)
  const doctorName = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName
  const many = (me.doctors ?? []).length > 1
  const line = (a: Appointment) => {
    const s = statusOf(a)
    const note = noteOf.get(a.id)
    const body = (
      <>
        <span className="nowrap num">{shortDate(a.startAt, true)}</span>
        {' '}<span className={`chip small s-${s.kind}`}><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</span>
        {a.serviceName && <span className="hint"> · {serviceLabel(a)}</span>}
        {many && <span className="hint"> · {doctorName(a.doctorId)}</span>}
        {note && <span className="visit-note">📝 {note}</span>}
      </>
    )
    // «Памятка и квитанция» — значком справа в строке визита, а не отдельной строкой под каждым (UX-аудит: шум)
    const docs = a.status === 'DONE' && canEditDoctor(me, a.doctorId)
    const docsLabel = seesMoneyOf(me, a.doctorId) && (a.paidSom != null || a.chargeSom != null) ? 'Памятка и квитанция' : 'Памятка'
    return (
      <li key={a.id} className={[a.status === 'NO_SHOW' || a.status === 'CANCELLED' ? 'struck' : '', docs ? 'with-docs' : ''].filter(Boolean).join(' ') || undefined}>
        {onOpenAppointment ? <button type="button" className="visit-link" onClick={() => onOpenAppointment(a.id)}>{body}</button> : <span className="visit-link">{body}</span>}
        {docs && (
          <button type="button" className="btn ghost small visit-docs-btn" aria-expanded={docsOf === a.id} aria-label={docsLabel} title={docsLabel}
            onClick={() => setDocsOf(docsOf === a.id ? null : a.id)}><span aria-hidden="true">📋</span></button>
        )}
        {docsOf === a.id && <VisitDocs appointment={a} me={me} />}
      </li>
    )
  }

  if (card.isPending) {
    return <aside className="panel" aria-label="Карточка пациента"><Loading /></aside>
  }
  if (card.error) {
    // Карточку объединили с другой (шаг 8А): старая ссылка ведёт на основную
    const merged = card.error instanceof ApiError && card.error.code === 'patient-merged' ? Number(card.error.problem.patientId) : null
    return (
      <aside className="panel" aria-label="Карточка пациента">
        <div className="panel-head-actions panel-x-only"><CloseButton onClick={onClose} /></div>
        {merged && onOpenPatient
          ? <EmptyState compact title="Эта карточка объединена с другой"
              action={<button type="button" className="btn primary" onClick={() => onOpenPatient(merged)}>Открыть основную карточку</button>} />
          : <p className="error">{card.error.message}</p>}
      </aside>
    )
  }
  const { patient, noShow, upcoming = [], past = [] } = card.data
  // Ассистент меняет пациента и лист ожидания только у пациентов своих врачей (или ещё ни разу не
  // записанных) — как сервер (PatientAccess); чужого он только смотрит
  const visits = [...upcoming, ...past]
  const mine = !isAssistant(me) || visits.length === 0 || visits.some((a) => a.doctorId != null && me.assistantOf!.includes(a.doctorId))
  const shownPast = allPast ? past : past.slice(0, PAST)
  // Сводка: ближайшая запись и общий долг — с одного взгляда, подробности во вкладках
  const next = upcoming.filter((a) => a.status === 'SCHEDULED' || a.status === 'REQUESTED')
    .sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))[0]
  const debtRows = (debts.data ?? []).filter((d) => debtLine(d))
  const debtTotal = debtRows.reduce((sum, d) => sum + d.debtSom, 0)
  // Просрочен (обещал и не оплатил) — тот же красный, но с подсказкой
  const overdue = debtRows.some((d) => debtLine(d)?.tone === 'bad')
  // Деньги одной строкой в шапке: «Долг 4 000 · оплачено 52 000». Оплачено — за все приёмы с сервера (null — денег этого
  // пациента не видно: ассистент, коллега без прав); долг — тот же, что во вкладке «Деньги»
  const paidTotal = card.data.paidSom ?? null
  const moneyLine = debtTotal > 0 || (paidTotal ?? 0) > 0 || advanceSom > 0
  // Лечащий врач — врач последнего состоявшегося приёма (past — последний первым). Только когда врачей больше одного
  const treating = many ? past.find((a) => a.status === 'DONE' && a.doctorId != null) : undefined
  const treatingName = treating ? doctorName(treating.doctorId) : undefined
  // «📞 Связаться ▾» — как в карточке приёма: позвонить, WhatsApp; есть долг — «Напомнить о долге» (форма во вкладке «Деньги»)
  const remindsDebt = debtRows.length > 0 && patient?.id != null && seesDebts(me)
  const contacts: ContactItem[] = [
    ...talkItems(patient),
    ...(remindsDebt ? [{ label: 'Напомнить о долге', group: 'send' as const, icon: 'debt', hint: `долг ${somText(debtTotal)}`,
      onSelect: () => { setTab('money'); setDebtForm('remind') } }] : []),
    ...(botInviteOf.item ? [botInviteOf.item] : []),
  ]
  const tabs: [Tab, string][] = [
    ['visits', 'Визиты'],
    ...(clinical ? [['medical', 'Медкарта'] as [Tab, string]] : []),
    ...(staff || debtRows.length || seesAdvance(me) ? [['money', 'Деньги'] as [Tab, string]] : []),
    ['history', 'История'],
    ['more', 'Прочее'],
  ]
  const shown = tabs.some(([key]) => key === tab) && tab !== 'medical' ? tab : 'visits'
  const child = childText(patient?.birthDate)
  // «＋ Заказ в лабораторию» — тем, кто лечит (регистратуре не нужен)
  const labs = Boolean(me.admin || me.doctorId != null || isAssistant(me))
  const about = [
    patient?.birthDate ? `${shortDate(`${patient.birthDate}T12:00:00Z`)} (${ageText(patient.birthDate)})` : null,
    patient?.workplace ? `💼 ${patient.workplace}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
    <aside className={full ? 'panel panel-full patient-card' : 'panel patient-card'} aria-label="Карточка пациента">
      {/* Шапка: имя, телефон, возраст и как ему пишем */}
      <header className="panel-head">
        <div>
          <h2>{patient?.fullName}{patient?.vip && <span className="patient-vip" role="img" aria-label="ВИП — особое внимание" title="ВИП — особое внимание"> ⭐</span>}</h2>
          {/* «+996 … · 38 лет · в боте»; без телефона — без «·» в начале; у ребёнка возраст — в бейдже «Ребёнок, 7 лет» */}
          <span className="hint">
            {[
              // Номер — он же «Связаться ▾» (как в карточке приёма): позвонить, WhatsApp, напомнить о долге, пригласить в бот
              patient?.phone ? (contacts.length
                ? <ContactMenu key="phone" items={contacts} className="link patient-phone" label={`Связаться: ${formatPhone(patient.phone)}`}
                    content={<span className="num">{formatPhone(patient.phone)}</span>} />
                : <span key="phone" className="num">{formatPhone(patient.phone)}</span>) : null,
              patient?.birthDate && !child ? <span key="age" className="nowrap">{ageText(patient.birthDate)}</span> : null,
              patient?.telegram ? <span key="bot" className="tone-ok nowrap">в боте</span>
                : <span key="bot">без бота — WhatsApp{patient?.botInvitedAt ? ` · ${invitedHint(patient.botInvitedAt)}` : ''}</span>,
            ].filter(Boolean).flatMap((part, i) => (i
              // «·» — в начале следующей части, а не в конце строки: перенос не оставляет висящую точку
              ? [' ·\u00a0', part] : [part]))}
          </span>
          {/* Важное из анкеты — той же пилюлей, что в карточке приёма (один вид предупреждения во всём продукте) */}
          <MedAlertPill an={anamnesis.data} onOpen={patient ? () => onMedical(patient) : undefined} />
          <KidInfo patient={patient} />
          {/* Свои метки клиники (V239): чипы; руководитель и регистратура нажимают — список с ✓ */}
          {patient && <PatientTagsLine patient={patient} me={me} />}
          {/* «Похожие карточки: 1» — возможный дубль (шаг 8А); руководитель объединяет из окна */}
          {patient && <DuplicatesLine patient={patient} me={me} onOpenPatient={onOpenPatient} />}
          {(moneyLine || treatingName || next || (noShow ?? 0) > 0) && (
            <div className="patient-facts">
              {moneyLine && (
                <p className="patient-money-line num">
                  {debtTotal > 0 && (
                    <button type="button" className="link patient-debt" onClick={() => setTab('money')}
                      title={overdue ? "Просрочен срок «обещал оплатить»" : undefined} aria-label={`Долг ${somText(debtTotal)} — открыть «Деньги»`}>Долг {somText(debtTotal)}</button>
                  )}
                  {debtTotal > 0 && (paidTotal ?? 0) > 0 && <span className="hint"> · </span>}
                  {(paidTotal ?? 0) > 0 && <span className="hint">оплачено {somText(paidTotal!)}</span>}
                  {advanceSom > 0 && (debtTotal > 0 || (paidTotal ?? 0) > 0) && <span className="hint"> · </span>}
                  {advanceSom > 0 && (
                    <button type="button" className="link patient-advance" onClick={() => setTab('money')}
                      aria-label={`${advanceText(advance.data!)} — открыть «Деньги»`}>{advanceText(advance.data!)}</button>
                  )}
                  {(noShow ?? 0) > 0 && <><span className="hint"> · </span><span className="summary-bad">{noShowText(noShow)}</span></>}
                </p>
              )}
              {!moneyLine && (noShow ?? 0) > 0 && <p className="patient-money-line"><span className="summary-bad">{noShowText(noShow)}</span></p>}
              {treatingName && <p className="hint patient-treating">Лечащий врач: {treatingName}</p>}
              {/* Ближайшая запись — строкой-ссылкой: нажать — карточка приёма */}
              {next && (onOpenAppointment
                ? <button type="button" className="link patient-next" onClick={() => onOpenAppointment(next.id)}>Следующий визит: <span className="num">{shortDate(next.startAt, true)}</span> ›</button>
                : <p className="hint patient-next">Следующий визит: <span className="num">{shortDate(next.startAt, true)}</span></p>)}
            </div>
          )}
        </div>
        <div className="panel-head-actions">
          {/* ✏️ — данные пациента на виду (2026-11-25, владелец: «добавь возможность редактировать данные пациента» — ссылка
              пряталась во вкладке «Прочее»): открывает ту же форму в «Прочем» */}
          {mine && patient && (
            <button type="button" className="btn ghost" aria-label="Изменить данные пациента" title="Изменить данные пациента"
              onClick={() => { setTab('more'); setEditing(true) }}>✏️</button>
          )}
          {/* Редкие действия — в «⋯»: договор с пациентом (по желанию клиники, V209) */}
          {patient && (
            <MoreActions title={patient.fullName ?? 'Пациент'} onTask={() => setAdding('task')} onLab={labs ? () => setAdding('lab') : undefined}
              onReferral={() => { setTab('more'); setReferralLink(true) }}
              onContract={mine && !isAssistant(me) ? () => {
                setTab('more')
                setContractAsked((a) => ({ id: patient.id, n: a?.id === patient.id ? a.n + 1 : 1 }))
              } : undefined} />
          )}
          <button type="button" className="btn ghost panel-expand" aria-pressed={full} onClick={toggleFull}
            aria-label={full ? 'Свернуть карточку' : 'Карточка на весь экран'} title={full ? 'Свернуть' : 'На весь экран'}>{full ? '⤡' : '⤢'}</button>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
      </header>
      <div className="patient-actions">
        <button type="button" className="btn primary" onClick={() => patient && onBook(patient)}>＋ Записать</button>
        {/* Есть представитель — звоним и пишем ему. Номер в шапке уже открывает «Связаться» — здесь значок, «＋ Записать» шире */}
        <ContactMenu items={contacts} className={patient?.phone ? 'btn contact-icon' : 'btn'} align="right"
          content={patient?.phone ? <span aria-hidden="true">📞</span> : undefined} />
      </div>
      {botInviteOf.sheet}

      {/* Прогресс плана лечения — тем, кто видит медкарту (сервер: ChartService); суммы — не ассистенту */}
      {patient && <PlanProgressLine patientId={patient.id} enabled={clinical && medicalOk} />}

      {/* «＋ Задача» и «＋ Заказ в лабораторию» — в «⋯» шапки; здесь — открытые задачи и работы техника, если есть */}
      {patient && <PatientTasks patient={{ id: patient.id, fullName: patient.fullName }} adding={adding === 'task'} onAdding={(on) => setAdding(on ? 'task' : null)} />}
      {patient && <PatientLab me={me} patient={{ id: patient.id, fullName: patient.fullName }} adding={adding === 'lab'} onAdding={(on) => setAdding(on ? 'lab' : null)} />}

      <div className="segments tabs" role="tablist" aria-label="Разделы карточки пациента">
        {/* «Медкарта» — сразу открывает медкарту во всю ширину: вкладка-заглушка с одной кнопкой была лишним нажатием */}
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={shown === key} aria-pressed={shown === key}
            onClick={() => (key === 'medical' ? patient && onMedical(patient) : setTab(key))}>{title}</button>
        ))}
      </div>

      {/* Новый пациент — одно спокойное пустое состояние вместо трёх («0 / не записан», «Нет будущих», «Визитов не было») */}
      {shown === 'visits' && visits.length === 0 && (
        <EmptyState compact title="Ещё не был в клинике"
          action={botInviteOf.item ? <button type="button" className="link" onClick={botInviteOf.item.onSelect}>📲 Пригласить в бот</button> : undefined} />
      )}
      {shown === 'visits' && visits.length > 0 && (
        <>
          <section>
            <h3>Предстоящие</h3>
            {upcoming.length ? <ul className="visits">{upcoming.map(line)}</ul> : <p className="hint">Не записан</p>}
          </section>
          {past.length > 0 && (
            <section>
              <h3>Прошлые визиты</h3>
              <ul className="visits">{shownPast.map(line)}</ul>
              {past.length > shownPast.length && <button type="button" className="link" onClick={() => setAllPast(true)}>Показать все ({past.length})</button>}
            </section>
          )}
        </>
      )}

      {shown === 'money' && (
        <section className="patient-money">
          {/* «Начислено · Оплачено · Баланс» — считает сервер по правилам видимости денег; нет сводки (ассистент) — нет блока */}
          {card.data.money && <MoneySummary money={card.data.money} />}
          {patient?.id != null && seesAdvance(me) && <AdvanceBox patientId={patient.id} me={me} />}
          {debtRows.length === 0 && <EmptyState compact title="Долгов нет" />}
          {/* Напомнить о долге (бот или WhatsApp) и «Обещал оплатить до…» — те же формы, что в «Должниках» */}
          {debtRows.length > 0 && patient?.id != null && seesDebts(me) && <DebtTools patientId={patient.id} name={patient.fullName} debts={debtRows} form={debtForm} setForm={setDebtForm} />}
          {staff && patient?.id != null && <OpeningDebtsBox patientId={patient.id} allowed={moneyOk} />}
          {debtRows.map((d) => {
            const debt = debtLine(d)!
            const text = `🧾 ${debt.text} — приём ${d.startAt ? shortDate(d.startAt) : ''}`
            return onOpenAppointment
              ? <button key={d.appointmentId} type="button" className={`btn debt-line tone-${debt.tone}`} onClick={() => onOpenAppointment(d.appointmentId)}>{text}</button>
              : <p key={d.appointmentId} className={`tone-${debt.tone}`}>{text}</p>
          })}
          {staff && patient && <PatientExpenses patient={patient} me={me} />}
        </section>
      )}

      {/* «История» — живая лента пациента (шаг 8А): записи, приёмы, оплаты, напоминания, отзывы, план, бот, задачи */}
      {shown === 'history' && patient && <PatientHistory patientId={patient.id} onOpenAppointment={onOpenAppointment} />}

      {shown === 'more' && (
        <section className="patient-more">
          {editing && patient ? <PatientForm patient={patient} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : (
            <>
              {about && <p>{about}</p>}
            </>
          )}
          {/* ⭐ ВИП — только меткой «ВИП» в шапке (одна дорога вместо двух, UX-аудит 2026-11-20); API /vip остаётся */}
          {/* «Откуда узнал» — всегда в «Прочем»: в шапке карточки занимал полэкрана */}
          {patient && <SourceLine patient={patient} canEdit={Boolean(mine)} admin={Boolean(mine && me.admin)} />}
          {/* «Приведи друга»: кто пригласил, кого привёл, ссылка для друзей (из «⋯») */}
          {patient && <ReferralBox key={`referral-${patient.id}`} patient={patient} canEdit={Boolean(mine)} link={referralLink}
            onCloseLink={() => setReferralLink(false)} onOpenPatient={onOpenPatient} />}
          {/* Лист ожидания — с подписью и пояснением: без заголовка «30 мин · к любому врачу» было непонятно, что это */}
          {patient && mine && (
            <section className="patient-waitlist" aria-label="Лист ожидания">
              <h3>Лист ожидания</h3>
              <p className="hint small">Хочет прийти раньше или ждёт места: освободится время — «Новая запись» предложит его.</p>
              <WaitlistBox patient={patient} me={me} />
            </section>
          )}
          {patient && <GuardianBox patient={patient} canEdit={Boolean(mine)} />}
          {patient && mine && <FamilyBox patient={patient} me={me} onOpenPatient={onOpenPatient} />}
          {/* Договор и согласие на лечение: печать, подпись на экране, отметка и скан */}
          {patient && mine && <ContractBox key={`contract-${patient.id}`} patient={patient} me={me} defaultDoctorId={(next ?? past[0])?.doctorId}
            offerAll={Boolean(me.clinic?.patientContracts)} opened={contractAsked?.id === patient.id ? contractAsked.n : 0} />}
        </section>
      )}
    </aside>
    {/* Подложка — после карточки: карточка остаётся на месте «Загружаем…» (тот же элемент), а подложка под ней по z-index */}
    {full && <div className="panel-backdrop" onClick={toggleFull} aria-hidden="true" />}
    </>
  )
}

/**
 * «⋯» в шапке карточки, рядом с ✕: редкие действия с пациентом — «Новая задача», «Заказ в лабораторию» (не регистратуре)
 * и «Оформить договор» (договор по желанию: строки договора у каждого пациента нет; не ассистенту). Сверху — имя пациента.
 * Закрывается нажатием мимо, Esc и «назад» телефона — карточка пациента при этом остаётся.
 */
function MoreActions({ title, onTask, onLab, onReferral, onContract }: {
  title: string; onTask: () => void; onLab?: () => void; onReferral: () => void; onContract?: () => void
}) {
  // Общее меню действий (layout/ActionMenu): компьютер — карточка у кнопки, телефон — лист; Esc закрывает только меню
  const items: ActionItem[] = [
    { label: 'Новая задача', hint: 'позвонить, напомнить', icon: 'task', onSelect: onTask },
    ...(onLab ? [{ label: 'Заказ в лабораторию', hint: 'работа технику', icon: 'lab' as const, onSelect: onLab }] : []),
    { label: 'Ссылка «Приведи друга»', hint: 'отправить пациенту в WhatsApp', icon: 'send' as const, onSelect: onReferral },
    ...(onContract ? [{ label: 'Оформить договор', hint: 'на подпись пациенту', icon: 'contract' as const, onSelect: onContract }] : []),
  ]
  return (
    <ActionMenu label="Ещё действия" buttonLabel="Ещё действия" className="btn ghost more-actions-btn" content="⋯" caret={false} align="right"
      title={title} items={items} />
  )
}

/** «Деньги» в карточке пациента: «Напомнить о долге», когда напоминали, и «Обещал оплатить до…». */
function DebtTools({ patientId, name, debts, form, setForm }: {
  patientId: number; name?: string; debts: Schemas['PaymentQueryDebt'][]
  form: 'remind' | 'promise' | null; setForm: (form: 'remind' | 'promise' | null) => void
}) {
  const reminded = debts.reduce<string | undefined>((max, d) => d.remindedAt && (!max || d.remindedAt > max) ? d.remindedAt : max, undefined)
  const due = debts.map((d) => d.dueOn).filter(Boolean).sort()[0]
  if (form === 'remind') return <DebtRemindForm patientId={patientId} name={name} onDone={() => setForm(null)} />
  if (form === 'promise') return <DebtPromiseForm patientId={patientId} dueOn={due} onDone={() => setForm(null)} />
  return (
    <div className="patient-debt-tools">
      <button type="button" className="btn" onClick={() => setForm('remind')}>Напомнить о долге</button>
      <button type="button" className="link" onClick={() => setForm('promise')}>{due ? 'Изменить «обещал оплатить»' : 'Обещал оплатить до…'}</button>
      {reminded && <span className="hint">{remindedText(reminded)}</span>}
    </div>
  )
}
