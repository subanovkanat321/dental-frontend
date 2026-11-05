import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { PatientHistory } from './PatientHistory'
import { useReminderNotSent } from './useReminderNotSent'
import { useState } from 'react'

import { SourceLine } from '../patients/SourceLine'
import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlerts } from '../medical/Anamnesis'
import { PatientFiles } from '../medical/PatientFiles'
import { WaitlistBox } from '../patients/WaitlistTab'
import { agoText } from '../lib/texts'
import { bookedByText } from '../lib/relations'
import { useClose } from '../lib/useClose'
import { useFullView } from '../lib/fullView'
import { useNowMinutes } from './gridScale'
import { addDays, dayTitle, formatPhone, minutesOf, slotInstant, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { CommentEdit, PromoEdit, Remind, Reschedule, ServiceEdit, Supplies, VisitNote } from './AppointmentExtras'
import { ContactButtons } from './Contact'
import { ContinueTreatment } from './ContinueTreatment'
import { VisitTeeth } from './VisitTeeth'
import { DepositBox } from './DepositBox'
import { PaymentBox } from './PaymentBox'
import { PatientExpenses } from '../patients/PatientExpenses'
import type { Slot } from './NewAppointmentPanel'
import { statusOf } from './status'
import { refreshAppointmentData, useAppointmentAction } from './useAppointmentAction'
import { VisitDocs } from '../print/VisitDocs'
import { LessonPicker } from '../learn/LessonButton'
import { Fold } from '../layout/Fold'
import { AfterVisit } from '../print/VisitReport'
import { canEditDoctor, editableDoctors, isAssistant, seesMoneyOf, seesAllMoney } from '../lib/roles'
import { cancelledWhen } from './cancelled'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Patient = Schemas['PatientView']
type Status = NonNullable<Schemas['AppointmentRequestsChangeStatus']['status']>

/** День приёма по Бишкеку: 'YYYY-MM-DD'. */
function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/**
 * Карточка приёма — сверху вниз: шапка (время, врач, статус; 📖 «Показать пациенту») → пациент
 * (история одной строкой, аллергии) → услуга и комментарий → главное действие статуса (одна залитая
 * кнопка: «Подтвердить», «Приём состоялся», «Принять оплату», «Восстановить», «Записать снова») →
 * «Приём» для врача (продолжение лечения, диктовка и заметка, «Зубы», «Материалы», «Снимки» —
 * раскрывашками) → «Сообщение после приёма» → перенести / неявка / отменить → «Ещё» (редкое:
 * промокод, предоплата, лист ожидания, откуда узнал, квитанция, исправить статус, удалить).
 * Приём коллеги — только посмотреть и позвонить. Esc — закрыть.
 */
type Rare = 'promo' | 'deposit' | 'waitlist' | 'source'
const RARE_TEXT: Record<Rare, string> = { promo: 'промокод', deposit: 'предоплата', waitlist: 'лист ожидания', source: 'откуда узнал' }

export function AppointmentPanel({ appointment: a, me, onClose, onOpenPatient, onBook, onMedical }: {
  appointment: Appointment
  me: Me
  onClose: () => void
  /** Имя пациента → его карточка в «Пациентах». */
  onOpenPatient?: (patientId: number) => void
  /** «Записать снова» / «на следующий визит» — «Новая запись» на этого пациента. */
  onBook?: (slot: Slot, patient: Patient) => void
  /** «Карта зубов и план лечения ›» прямо с приёма — вся медкарта: зубы, план, анкета, снимки; «Назад» — к приёму. */
  onMedical?: (patient: Patient) => void
}) {
  useClose(onClose)
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  // Какая форма открыта внутри карточки: одна за раз, чтобы карточка не превращалась в анкету
  const [editing, setEditing] = useState<'move' | 'service' | 'comment' | 'promo' | null>(null)
  // Только что отметили неявку или отмену — «Вернуть», как было (сервер проверит версию)
  const [undo, setUndo] = useState<{ label: string; previous: Status } | null>(null)
  const close = () => setEditing(null)
  // После переноса или передачи — что сделать дальше (напомнить заново)
  const [moved, setMoved] = useState('')
  const s = statusOf(a)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const doctor = (me.doctors ?? []).find((d) => d.id === a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  // «Состоялся» сервер разрешает с дня приёма: будущий приём ещё не мог пройти
  const started = date <= todayIn()
  const [full, toggleFull] = useFullView('appointment')
  // Этап приёма: заметка, материалы и диктовка — когда приём начинается (за 15 минут) или прошёл;
  // утром карточка дневного приёма короткая: напомнить, перенести, связаться. «Показать сейчас» — если начали раньше
  const nowMinutes = useNowMinutes()
  const inChair = date < todayIn() || (date === todayIn() && nowMinutes >= minutesOf(a.startAt!) - 15)
  const [early, setEarly] = useState(false)
  const visitTools = a.status === 'DONE' || (a.status === 'SCHEDULED' && started && (inChair || early))
  const future = a.startAt ? new Date(a.startAt) > new Date() : false
  const canEdit = canEditDoctor(me, a.doctorId)
  // «📖 Показать пациенту» — строка выбора темы под шапкой, по значку
  const [lesson, setLesson] = useState(false)
  const active = a.status === 'REQUESTED' || a.status === 'SCHEDULED'
  const rare = ([
    canEditDoctor(me, a.doctorId) && a.status !== 'CANCELLED' && !a.promoCode && editing !== 'promo' ? 'promo' : null,
    active && seesMoneyOf(me, a.doctorId) && !a.depositStatus ? 'deposit' : null,
    active && future && a.patient ? 'waitlist' : null,
    // Откуда узнал о клинике — тоже под «Ещё»: в шапке занимал много места
    a.patient?.id != null ? 'source' : null,
  ] as const).filter((x): x is Rare => x != null)
  // Подпись «Ещё»: что внутри, кратко
  const more = [
    ...rare.map((r) => RARE_TEXT[r]),
    canEdit && a.status === 'DONE' ? 'квитанция' : null,
    canEdit && (a.status === 'DONE' || a.status === 'NO_SHOW') ? 'исправить' : null,
    me.owner ? 'удалить' : null,
  ].filter(Boolean)
  const moreMeta = more.join(', ')
  // Аллергия и важное из анкеты — перед лечением, тому, кто видит медкарту (врач приёма, админ)
  // …и ассистенту этого врача (смотрит медкарту, как сервер — ChartService)
  const clinical = seesAllMoney(me) || a.doctorId === me.doctorId
    || Boolean(a.doctorId != null && me.assistantOf?.includes(a.doctorId))
  const anamnesis = useAnamnesis(a.patient?.id, clinical && a.status !== 'CANCELLED')
  // «Карта зубов и план лечения ›» — вся медкарта пациента; «Назад» — к приёму
  const medical = clinical && onMedical && a.patient ? () => onMedical(a.patient!) : undefined
  const length = a.startAt && a.endAt ? (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000 : 30
  // force — вместе с заметкой и оплатой (только владелец Tish; спрашиваем отдельно, что пропадёт)
  const remove = useMutation<unknown, ApiError, boolean>({
    mutationFn: (force) => unwrap(api.DELETE('/api/appointments/{id}', { params: { path: { id: a.id! }, query: { force } } })),
    onSuccess: () => {
      // С записью удаляются её оплата и долг — «Касса» и отчёт тоже перечитываются
      refreshAppointmentData(client)
      onClose()
    },
  })

  // Деньги этого приёма: коллеге и «независимому» админу сервер присылает их пустыми — ни сумм, ни кнопок
  const seesMoney = seesMoneyOf(me, a.doctorId)
  // Приём с деньгами сервер не удалит (409 has-records) — сразу говорим, что делать вместо удаления
  const money = [
    a.paidSom ? `оплата ${somText(a.paidSom)}` : null,
    a.debtSom ? `долг ${somText(a.debtSom)}` : null,
    a.paidSom == null && a.chargeSom ? `счёт на кассу ${somText(a.chargeSom)}` : null,
    a.depositStatus === 'RECEIVED' && a.depositSom && !a.paidSom ? `предоплата ${somText(a.depositSom)}` : null,
  ].filter(Boolean)
  const removeQuestion = 'Удалить запись насовсем? Для обычной отмены есть «Отменить запись».'
  const forceQuestion = (what: string) => `У записи есть ${what}. Удалить всё вместе с ней? Оплаты пропадут из «Кассы» и отчётов, заметка — из медкарты. Вернуть нельзя.`
  // Владелец Tish: пустую запись — после обычного вопроса; с деньгами или заметкой — после второго,
  // где сказано, что пропадёт (сервер без force отвечает 409 has-records)
  const removeAppointment = async () => {
    if (money.length) {
      if (await ask(forceQuestion(money.join(', ')), { ok: 'Удалить всё', danger: true })) remove.mutate(true)
      return
    }
    if (!await ask(removeQuestion)) return
    remove.mutate(false, {
      onError: (e) => {
        if (e.code !== 'has-records') return
        void ask(forceQuestion('заметка о приёме или отметки зубов'), { ok: 'Удалить всё', danger: true })
          .then((ok) => { if (ok) { remove.reset(); remove.mutate(true) } })
      },
    })
  }

  const setStatus = async (status: Status, opts: { question?: string; undo?: string } = {}) => {
    if (opts.question && !await ask(opts.question)) return
    const previous = a.status as Status
    action.mutate({ kind: 'status', body: { version: a.version ?? 0, status } }, {
      onSuccess: () => setUndo(opts.undo ? { label: opts.undo, previous } : null),
    })
  }
  // «Приём состоялся» / «Неявка» по ошибке — приём снова запланирован (сервер не даст, если есть оплата)
  const reopen = async (current: Appointment) => {
    if (!await ask(current.status === 'DONE' ? 'Вернуть приём в запланированные? Отметка «Приём состоялся» снимется.'
      : 'Вернуть приём в запланированные? Отметка «Неявка» снимется.')) return
    action.mutate({ kind: 'undo', body: { version: current.version ?? 0, previousStatus: 'SCHEDULED' } })
  }
  const back = (updated: Appointment) => action.mutate({ kind: 'undo', body: { version: updated.version ?? 0, previousStatus: undo!.previous } },
    { onSuccess: () => setUndo(null) })
  // То же время, что у этого приёма, — если оно ещё не прошло; иначе форма откроется без времени (сетка свободного)
  const bookAgain = (day: string) => {
    if (!a.patient) return
    const minutes = minutesOf(a.startAt!)
    const past = Date.parse(slotInstant(day, minutes)) < Date.now()
    onBook?.({ doctorId: a.doctorId!, date: day, minutes: past ? null : minutes, duration: length }, a.patient)
  }

  // Главная кнопка — одна на карточку (DESIGN.md): после приёма, пока не оплачено, это «Принять оплату»
  const payPending = a.status === 'DONE' && seesMoney && a.paidSom == null
  const sourceHint = a.bookedBy ? bookedByText(a.bookedBy) : a.source === 'PATIENT' ? 'Запись через бота'
    : a.source === 'WEB' ? (a.status === 'REQUESTED' ? '🌐 Заявка с сайта, без Telegram — подтвердите звонком' : '🌐 С сайта, без Telegram — бот не напомнит')
      : null

  return (
    <>
    {full && <div className="panel-backdrop" onClick={toggleFull} aria-hidden="true" />}
    <aside className={full ? 'panel panel-full appt-card' : 'panel appt-card'} aria-label="Карточка приёма">
      {/* Шапка: когда, у кого и статус; справа — показать пациенту, на весь экран, закрыть */}
      <header className="panel-head">
        <div className="appt-when">
          <h2>{timeOf(a.startAt!)}–{timeOf(a.endAt!)}</h2>
          <span className="hint">{dayTitle(date)}{doctors.length > 1 && doctor ? ` · ${doctor.fullName}` : ''}</span>
        </div>
        <div className="panel-head-actions">
          {/* Презентация по услуге — показать на экране; отправлять не нужно: после приёма уходит отчёт */}
          {a.patient && a.status !== 'CANCELLED' && (
            <button type="button" className="btn ghost" aria-pressed={lesson} aria-label="Показать пациенту" title="Показать пациенту"
              onClick={() => setLesson(!lesson)}>📖</button>
          )}
          <button type="button" className="btn ghost panel-expand" aria-pressed={full} onClick={toggleFull}
            aria-label={full ? 'Свернуть карточку' : 'Карточка на весь экран'} title={full ? 'Свернуть' : 'На весь экран'}>{full ? '⤡' : '⤢'}</button>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
      </header>
      {lesson && a.patient && (
        <LessonPicker key={`${a.id}-${a.serviceName ?? ''}`} serviceName={a.serviceName} patientId={a.patient.id} onClose={() => setLesson(false)} />
      )}
      <span className={`chip s-${s.kind} appt-status`}><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</span>

      {/* Пациент: имя (→ его карточка), телефон, история одной строкой и важное из анкеты */}
      <section className="appt-patient" aria-label="Пациент">
        <div className="appt-who">
          {onOpenPatient && a.patient?.id
            ? <button type="button" className="link patient-name" onClick={() => onOpenPatient(a.patient!.id!)}>{a.patient.fullName} ›</button>
            : <strong className="patient-name">{a.patient?.fullName}</strong>}
          {a.patient?.phone && <span className="num">{formatPhone(a.patient.phone)}</span>}
        </div>
        <PatientHistory appointment={a} me={me} />
        {sourceHint && <p className="hint small">{sourceHint}</p>}
        {a.reminderOpenedAt && a.status === 'SCHEDULED' && <ReminderSent a={a} canEdit={canEdit} />}
        {a.rating != null && (
          <p className="rating" aria-label={`Оценка пациента: ${a.rating} из 5`}>{'★'.repeat(a.rating)}{'☆'.repeat(5 - a.rating)} <span className="hint">оценка пациента</span></p>
        )}
        {a.reviewComment && <blockquote className="review-comment"><span className="hint">Пациент написал:</span><br />{a.reviewComment}</blockquote>}
      </section>
      <MedAlerts an={anamnesis.data} compact />

      {/* Что за приём: услуга, комментарий, промокод — строками «… изменить» */}
      <section className="appt-what">
        {editing === 'service' ? <ServiceEdit appointment={a} me={me} onDone={close} prices={!isAssistant(me)} /> : (
          <p className="line-edit">
            <span><span className="hint">Услуга:</span> {a.serviceName ?? '—'}</span>
            {canEdit && a.status !== 'CANCELLED' && <button type="button" className="link" onClick={() => setEditing('service')}>изменить</button>}
          </p>
        )}
        {editing === 'comment' ? <CommentEdit appointment={a} onDone={close} /> : a.comment ? (
          <p className="comment line-edit"><span>{a.comment}</span>
            {canEdit && <button type="button" className="link" onClick={() => setEditing('comment')}>изменить</button>}</p>
        ) : canEdit && a.status !== 'CANCELLED' && (
          <button type="button" className="link" onClick={() => setEditing('comment')}>＋ Комментарий</button>
        )}
        {/* Промокод рекламы: пациент ввёл в боте или назвал по телефону; пустой — «＋ Промокод» под «Ещё» */}
        {editing === 'promo' ? <PromoEdit appointment={a} onDone={close} /> : a.promoCode && (
          <p className="line-edit"><span><span className="hint">Промокод:</span> <b>{`🎟 ${a.promoCode}`}</b></span>
            {canEdit && <button type="button" className="link" onClick={() => setEditing('promo')}>изменить</button>}</p>
        )}
      </section>

      {undo && (
        <div className="undo" role="status">
          <span>{undo.label}</span>
          <button type="button" className="btn small" disabled={action.isPending} onClick={() => back(a)}>Вернуть</button>
        </div>
      )}

      {!canEdit ? (
        <>
          <p className="readonly-note">Приём коллеги — менять может его врач{doctor?.fullName ? ` (${doctor.fullName})` : ''}, ассистент, регистратура или администратор.</p>
          <ContactButtons phone={a.patient?.phone} whatsapp={false} />
        </>
      ) : (
        <>
          {/* Главное действие для статуса — одна залитая кнопка, рядом — связаться */}
          {a.status === 'REQUESTED' && (
            <div className="actions">
              <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Подтвердить</button>
              <ContactButtons phone={a.patient?.phone} whatsapp={false} />
            </div>
          )}
          {moved && <p className="tone-ok" role="status">{moved}</p>}
          {a.status === 'SCHEDULED' && <Remind appointment={a} />}
          {a.status === 'SCHEDULED' && started && (
            <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('DONE')}>Приём состоялся</button>
          )}
          {a.status === 'SCHEDULED' && !future && <ContactButtons phone={a.patient?.phone} />}
          {/* Предоплату уже попросили — на виду; ещё не просили — под «Ещё». Ассистенту деньги не показываем */}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED') && seesMoney && a.depositStatus && <DepositBox key={a.depositStatus} appointment={a} />}

          {a.status === 'CANCELLED' && (
            <>
              {/* Кто и когда отменил (V160): «Отменён: пациент в боте, сегодня 14:20»; старые отмены — без этой строки */}
              {(a.cancelledBy || a.cancelledAt) && (
                <p className="cancelled-by">Отменён: {[a.cancelledBy ?? 'кто — не записано', a.cancelledAt ? cancelledWhen(a.cancelledAt, { sayToday: true }) : null].filter(Boolean).join(', ')}</p>
              )}
              {a.depositStatus === 'RECEIVED' && seesMoney && <p className="tone-wait">Предоплата {somText(a.depositSom ?? 0)} получена — верните пациенту или запишите его снова.</p>}
              <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Восстановить</button>
              <p className="hint small">Восстановленный приём попросит напомнить пациенту заново.</p>
            </>
          )}

          {a.status === 'NO_SHOW' && (
            <>
              {onBook && <button type="button" className="btn primary" onClick={() => bookAgain(todayIn())}>Записать снова</button>}
              <ContactButtons phone={a.patient?.phone} />
            </>
          )}

          {/* Оплата — сразу после приёма. Ключ — по самим деньгам: оплата на сервере версию приёма не
              меняет, а блок после сохранения должен открыться заново («оплачено», а не форма) */}
          {a.status === 'DONE' && seesMoney && (
            <PaymentBox key={[a.id, a.version, a.paidSom, a.chargeSom, a.debtSom, a.dueOn, a.depositStatus].join('-')} appointment={a} me={me} />
          )}
          {a.status === 'DONE' && (
            <>
              {onBook && <button type="button" className={payPending ? 'btn' : 'btn primary'} onClick={() => bookAgain(addDays(date > todayIn() ? date : todayIn(), 7))}>Записать на следующий визит</button>}
              <ContactButtons phone={a.patient?.phone} />
            </>
          )}
        </>
      )}

      {/* «Приём» — работа врача: продолжение лечения, диктовка и заметка, зубы, материалы, снимки.
          Зубы, материалы и снимки — строками-раскрывашками со счётчиками */}
      {(clinical || (canEdit && (visitTools || a.status === 'NO_SHOW'))) && a.status !== 'CANCELLED' && (
        <section className="appt-visit" aria-label="Приём">
          {clinical && <ContinueTreatment appointment={a} open={visitTools && a.status === 'SCHEDULED'} onMedical={medical} />}
          {canEdit && (visitTools || a.status === 'NO_SHOW') && <VisitNote appointment={a} />}
          {/* Зубы этого приёма: врач приёма и админ отмечают, ассистент видит; «Карта зубов и план лечения ›» — вся медкарта */}
          {canEdit && visitTools && clinical && a.patient?.id != null && (
            <VisitTeeth appointment={a} onMedical={medical}
              readOnly={!(seesAllMoney(me) || (a.doctorId != null && a.doctorId === me.doctorId))} />
          )}
          {canEdit && visitTools && <Supplies appointment={a} me={me} />}
          {canEdit && visitTools && clinical && a.patient?.id != null && (
            <PatientFiles patientId={a.patient.id} readOnly={isAssistant(me)} compact defaultKind="PHOTO" takenOn={date} />
          )}
          {canEdit && a.status === 'SCHEDULED' && started && !visitTools && (
            <p className="hint small">Заметка, зубы и материалы — к началу приёма.{' '}
              <button type="button" className="link" onClick={() => setEarly(true)}>Показать сейчас</button></p>
          )}
        </section>
      )}

      {/* «Сообщение после приёма» — отчёт пациенту: личная часть и уход дома из памятки */}
      {canEdit && a.status === 'DONE' && <AfterVisit appointment={a} me={me} />}

      {/* Частые опасные действия — на виду внизу; неявку и отмену можно «Вернуть» */}
      {canEdit && (a.status === 'REQUESTED' || a.status === 'SCHEDULED') && (
        <div className="danger-zone actions">
          {editing !== 'move' && (
            <button type="button" className="btn" onClick={() => { setMoved(''); setEditing('move') }}>{editableDoctors(me, doctors).length > 1 ? 'Перенести или передать врачу' : 'Перенести'}</button>
          )}
          {a.status === 'REQUESTED' && (
            <button type="button" className="btn danger" disabled={action.isPending}
              onClick={() => setStatus('CANCELLED', { question: 'Отклонить заявку? Пациенту придёт сообщение.', undo: 'Заявка отклонена' })}>Отклонить заявку</button>
          )}
          {a.status === 'SCHEDULED' && started && (
            <button type="button" className="btn danger" disabled={action.isPending} onClick={() => setStatus('NO_SHOW', { undo: 'Отмечено: неявка' })}>Неявка</button>
          )}
          {a.status === 'SCHEDULED' && (
            <button type="button" className="btn danger" disabled={action.isPending}
              onClick={() => setStatus('CANCELLED', { question: `Отменить запись ${a.patient?.fullName ?? ''}? Время освободится.`, undo: 'Запись отменена' })}>Отменить запись</button>
          )}
        </div>
      )}
      {editing === 'move' && <Reschedule appointment={a} me={me} onDone={(text) => { close(); setMoved(text ?? '') }} />}

      {/* «Ещё» — редкое одной строкой: промокод, предоплата, лист ожидания, откуда узнал, расход,
          квитанция, исправить статус, удалить */}
      {canEdit && more.length > 0 && (
        <Fold title="Ещё" label="Ещё" meta={moreMeta}>
          <div className="rare">
            {rare.includes('promo') && <button type="button" className="link" onClick={() => setEditing('promo')}>＋ Промокод</button>}
            {rare.includes('deposit') && <DepositBox key="none" appointment={a} />}
            {rare.includes('waitlist') && a.patient && <div className="sub-form"><WaitlistBox patient={a.patient} me={me} defaultMinutes={length} /></div>}
            {/* Откуда узнал — пациент не ответил в боте, отметят здесь */}
            {rare.includes('source') && a.patient?.id != null && <SourceLine patient={a.patient} canEdit compact />}
            {/* Расход по пациенту (техник, лаборатория); регистратуре и ассистенту нет (у них нет своих расходов) */}
            {a.status === 'DONE' && seesMoney && a.patient && (me.admin || me.doctorId != null) && <PatientExpenses patient={a.patient} me={me} doctorId={a.doctorId} />}
            {/* Квитанция: печать и «Отправить пациенту» — только по нажатию */}
            {a.status === 'DONE' && <VisitDocs appointment={a} me={me} memo={false} />}
            {a.status === 'NO_SHOW' && (
              <button type="button" className="btn" disabled={action.isPending} onClick={() => setStatus('DONE')}>Исправить: приём состоялся</button>
            )}
            {a.status === 'DONE' && (
              <button type="button" className="btn danger" disabled={action.isPending} onClick={() => setStatus('NO_SHOW', { undo: 'Отмечено: неявка' })}>Исправить: неявка</button>
            )}
            {/* Отметили «состоялся» или «неявку» по ошибке — обратно в запланированные. С оплатой нельзя:
                сначала снять её («Оплата» → «Снять отметку оплаты»), иначе разойдутся касса и зарплата */}
            {(a.status === 'DONE' || a.status === 'NO_SHOW') && (a.status === 'DONE' && seesMoney && (a.paidSom != null || a.chargeSom != null) ? (
              <p className="hint small">Вернуть в запланированные: сначала «Снять отметку оплаты» в оплате.</p>
            ) : (
              <button type="button" className="btn danger" disabled={action.isPending} onClick={() => reopen(a)}>Вернуть в запланированные</button>
            ))}
            {/* Удалить насовсем (ошибочная или тестовая запись) — только владелец Tish; клиники отменяют */}
            {me.owner && (
              <button type="button" className="btn danger" disabled={remove.isPending} onClick={() => void removeAppointment()}>Удалить запись</button>
            )}
          </div>
        </Fold>
      )}
      {(action.error ?? (remove.error?.code === 'has-records' ? null : remove.error)) && <p className="error" role="alert">{(action.error ?? remove.error)!.message}</p>}
    </aside>
    </>
  )
}

/** «Напоминание отправлено …» и «не ушло?» — снять отметку, если сообщение так и не отправили. */
function ReminderSent({ a, canEdit }: { a: Appointment; canEdit: boolean }) {
  const { run, undo } = useReminderNotSent(a)
  return (
    <>
      <p className="hint">Напоминание отправлено {agoText(a.reminderOpenedAt!)}, в {timeOf(a.reminderOpenedAt!)}
        {canEdit && <> · <button type="button" className="link" disabled={undo.isPending} onClick={run}>не ушло?</button></>}</p>
      {undo.error && <p className="error" role="alert">{undo.error.message}</p>}
    </>
  )
}
