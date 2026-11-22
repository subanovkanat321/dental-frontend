import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KidInfo } from '../patients/KidInfo'
import { ask } from '../lib/confirm'
import { PatientHistory } from './PatientHistory'
import { useReminderNotSent } from './useReminderNotSent'
import { useEffect, useRef, useState } from 'react'
import { TaskDialog } from '../tasks/TaskDialog'
import { LabOrderDialog } from '../lab/LabOrderDialog'
import { AppointmentLab } from '../lab/AppointmentLab'

import { SourceLine } from '../patients/SourceLine'
import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlertPill } from '../medical/Anamnesis'
import { PatientFiles } from '../medical/PatientFiles'
import { WaitlistBox } from '../patients/WaitlistTab'
import { FreedHere } from './FreeWindows'
import { agoText } from '../lib/texts'
import { bookedByText } from '../lib/relations'
import { useClose } from '../lib/useClose'
import { useFullView } from '../lib/fullView'
import { useNowMinutes } from './gridScale'
import { addDays, dateOf, formatPhone, shortDayTitle, minutesOf, slotInstant, somText, timeOf, todayIn } from '../lib/time'
import { ChairEdit, CommentEdit, PromoEdit, Reschedule, Supplies, VisitNote } from './AppointmentExtras'
import { ServiceLines } from './ServiceLines'
import { lockedForMe, serviceLabel } from './lineLabel'
import { useChairs } from '../team/chairs'
import { ActionMenu } from '../layout/ActionMenu'
import { ContactMenu } from './ContactMenu'
import { useAppointmentContacts } from './useAppointmentContacts'
import { DebtRemindForm } from '../cash/DebtRemind'
import { ContinueTreatment } from './ContinueTreatment'
import { VisitTeeth } from './VisitTeeth'
import { DepositBox } from './DepositBox'
import { useWaitlist } from '../api/settings'
import { PaymentBox } from './PaymentBox'
import { seesDebts, seesPatientDebts, usePatientDebts } from '../lib/debt'
import { mainActionKind, type MainKind } from './mainAction'
import { shortName } from '../lab/text'
import { useMedAlert } from '../lib/medAlerts'
import { PatientExpensesFold } from '../patients/PatientExpenses'
import type { Slot } from './NewAppointmentPanel'
import { StatusPill } from './StatusPill'
import { EditButton } from '../layout/EditButton'
import { TagDots } from '../tags/TagDots'
import { marksArrival, nextStep, statusOptions, type Reply } from './statusOptions'
import { NOWHERE_TEXT } from './useRemind'
import { ReasonSheet } from './ReasonSheet'
import { REASON_TEXT, reasonLine, type CancelReason } from './cancelReasons'
import { colleagueMarkText, colleagueTimeOf } from './chairTime'
import { refreshAppointmentData, useAppointmentAction } from './useAppointmentAction'
import { VisitDocs } from '../print/VisitDocs'
import { LessonPicker } from '../learn/LessonButton'
import { Fold } from '../layout/Fold'
import { AfterVisit } from '../print/VisitReport'
import { canEditDoctor, editableDoctors, isAssistant, seesMoneyOf, seesAllMoney } from '../lib/roles'
import { cancelledWhen } from './cancelled'
import { HelpHint } from '../help/HelpHint'
import { PlanDone } from './PlanDone'
import { VisitPlan } from './VisitPlan'
import { askPlanDone } from './planDoneStore'
import { usePhoneCard } from './usePhoneCard'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Patient = Schemas['PatientView']
type Status = NonNullable<Schemas['AppointmentRequestsChangeStatus']['status']>

/**
 * Карточка приёма — сверху вниз: шапка (время, «пт, 20 нояб · Айгерим С.»; 📖 «Показать пациенту») → пациент (имя,
 * номер «Связаться ▾», метка словом, ⚠ аллергия, чипы ❗ / 🧾 долг / ⭐, история одной строкой) → статус пилюлей
 * «🟢 Пришёл ▾» (все статусы одним списком; с 2026-11-20 — под пациентом, по просьбе владельца) и рядом главное
 * действие состояния (mainAction.ts) → блок момента: до прихода — ответ пациента, после — оплата → услуга
 * и комментарий («О записи» свёрнуто после визита) →
 * «Приём» для врача по приоритету: продолжение лечения → заметка и диктовка → «Зубы» → «План лечения» →
 * «Материалы» → «Расход (техник, лаборатория)» → лаборатория на этот приём (если есть работа) → «Снимки»
 * (раскрывашками) → «Сообщение после приёма» → перенести → «＋ Предоплата · ＋ В лист ожидания» (строкой ссылок, с
 * 2026-11-20 вместо свёрнутого «Ещё»). «⋯» в шапке — удалить запись (владелец Tish).
 * Приём коллеги — только посмотреть и позвонить. Esc — закрыть.
 *
 * Шаг 3 (опыт Dentist Plus):
 * - телефон — внизу закреплена панель: главное действие состояния одной кнопкой (UX-аудит 2026-11-20: «Напомнить»,
 *   «Подтвердить», «Пришёл», «Начать приём», «Приём состоялся», «Принять оплату» / «Принять доплату» — открывает форму
 *   оплаты, «Записать на следующий визит», «Записать снова») и «⋯» (перенести, задача, лаборатория, показать
 *   пациенту, удалить); в ленте эти кнопки тогда не дублируются — «Принять оплату» на экране ровно одна;
 * - компьютер — шаг, «Напомнить» и «Записать снова» — рядом с пилюлей статуса, оплата и «следующий визит» — одной
 *   залитой кнопкой в своём блоке ленты;
 * - «врач» и «регистратура» — одна карточка, разный порядок: врачу своего приёма (и его ассистенту), когда пациент
 *   пришёл, в кресле или приём состоялся сегодня, клиническое («Приём») — сразу под статусом, а услуга, связь,
 *   промокод, «откуда узнал», задачи — ниже, в «О записи». Остальным — как раньше: контакты и оплата сверху.
 */
type Rare = 'deposit' | 'waitlist'

export function AppointmentPanel({ appointment: a, me, onClose, onOpenPatient, onBook, onMedical, intent }: {
  appointment: Appointment
  me: Me
  onClose: () => void
  /** Имя пациента → его карточка в «Пациентах». */
  onOpenPatient?: (patientId: number) => void
  /** «Записать снова» / «на следующий визит» — «Новая запись» на этого пациента. */
  onBook?: (slot: Slot, patient: Patient) => void
  /** «Карта зубов и план лечения ›» прямо с приёма — вся медкарта: зубы, план, анкета, снимки; «Назад» — к приёму. */
  /** @param tab «anamnesis» — сразу вкладка «Анкета» (из пилюли «⚠ Аллергия…») */
  onMedical?: (patient: Patient, tab?: 'anamnesis') => void
  /** Открыли из меню быстрых действий на записи: «Перенести» — сразу форма переноса, «Принять оплату» — к оплате. */
  intent?: 'move' | 'pay'
}) {
  useClose(onClose)
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  // Какая форма открыта внутри карточки: одна за раз, чтобы карточка не превращалась в анкету
  const [editing, setEditing] = useState<'move' | 'service' | 'comment' | 'promo' | 'chair' | null>(
    intent === 'move' && canEditDoctor(me, a.doctorId) && (a.status === 'REQUESTED' || a.status === 'SCHEDULED') ? 'move' : null)
  // «Принять оплату» из меню на записи — прокрутить карточку к оплате (а «Перенести» — к форме переноса)
  const payRef = useRef<HTMLDivElement>(null)
  const moveRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = intent === 'pay' ? payRef.current : intent === 'move' ? moveRef.current : null
    target?.scrollIntoView?.({ block: 'center' })
  }, [intent])
  // Только что отметили неявку или отмену — «Вернуть», как было (сервер проверит версию)
  const [undo, setUndo] = useState<{ label: string; previous: Status } | null>(null)
  const close = () => setEditing(null)
  // После переноса или передачи — что сделать дальше (напомнить заново)
  const [moved, setMoved] = useState('')
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const doctor = (me.doctors ?? []).find((d) => d.id === a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  // «Состоялся» сервер разрешает с дня приёма: будущий приём ещё не мог пройти
  const started = date <= todayIn()
  const [full, toggleFull] = useFullView('appointment')
  // Этап приёма: заметка, материалы и диктовка — когда приём начинается (за 15 минут) или прошёл;
  // утром карточка дневного приёма короткая: напомнить, перенести, связаться. «Показать сейчас» — если начали раньше
  const nowMinutes = useNowMinutes()
  const inChair = date < todayIn() || (date === todayIn() && nowMinutes >= minutesOf(a.startAt) - 15)
  const [early, setEarly] = useState(false)
  // «Пришёл» (V234) — пациент уже в кресле: заметка, зубы и материалы сразу
  const visitTools = a.status === 'DONE' || (a.status === 'SCHEDULED' && started && (inChair || early || Boolean(a.arrivedAt)))
  const future = a.startAt ? new Date(a.startAt) > new Date() : false
  const ended = a.endAt ? new Date(a.endAt) < new Date() : false
  const canEdit = canEditDoctor(me, a.doctorId)
  // «📖 Показать пациенту» — строка выбора темы под шапкой, по значку
  const [lesson, setLesson] = useState(false)
  // «＋ Задача» с пациентом этого приёма
  const [taskOpen, setTaskOpen] = useState(false)
  // «＋ Заказ в лабораторию» с пациентом и врачом этого приёма
  const [labOpen, setLabOpen] = useState(false)
  const active = a.status === 'REQUESTED' || a.status === 'SCHEDULED'
  const rare = ([
    // Пришёл или в кресле — предоплату не просят, лист ожидания не нужен
    active && !a.arrivedAt && !a.inChairAt && seesMoneyOf(me, a.doctorId) && !a.depositStatus ? 'deposit' : null,
    active && !a.arrivedAt && !a.inChairAt && future && a.patient ? 'waitlist' : null,
  ] as const).filter((x): x is Rare => x != null)
  // «＋ Предоплата · ＋ В лист ожидания» — строкой ссылок (раньше — свёрнутым «Ещё»); форма открывается под строкой
  const [extra, setExtra] = useState<Rare | null>(null)
  // Пациент уже в листе ожидания — вместо ссылки сразу строка листа (из общего кэша листа)
  const waitlist = useWaitlist(canEditDoctor(me, a.doctorId) && rare.includes('waitlist'))
  const waiting = Boolean(waitlist.data?.some((e) => e.patient?.id === a.patient.id))
  // Аллергия и важное из анкеты — перед лечением, тому, кто видит медкарту (врач приёма, админ)
  // …и ассистенту этого врача (смотрит медкарту, как сервер — ChartService)
  const clinical = seesAllMoney(me) || a.doctorId === me.doctorId
    || Boolean(a.doctorId != null && me.assistantOf?.includes(a.doctorId))
  const anamnesis = useAnamnesis(a.patient.id, clinical && a.status !== 'CANCELLED')
  // «Карта зубов и план лечения ›» — вся медкарта пациента; «Назад» — к приёму
  const medical = clinical && onMedical && a.patient ? () => onMedical(a.patient) : undefined
  const length = a.startAt && a.endAt ? (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000 : 30
  // force — вместе с заметкой и оплатой (только владелец Tish; спрашиваем отдельно, что пропадёт)
  const remove = useMutation<unknown, ApiError, boolean>({
    mutationFn: (force) => unwrap(api.DELETE('/api/appointments/{id}', { params: { path: { id: a.id }, query: { force } } })),
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

  const setStatus = async (status: Status, opts: { question?: string; undo?: string; reason?: CancelReason | null; note?: string | null } = {}) => {
    if (opts.question && !await ask(opts.question)) return
    const previous = a.status as Status
    action.mutate({ kind: 'status', body: { version: a.version, status, reason: opts.reason ?? undefined, reasonNote: opts.note ?? undefined } }, {
      onSuccess: () => {
        setUndo(opts.undo ? { label: opts.undo, previous } : null)
        // «Состоялся» — спросить, что из плана лечения сделали сегодня (блок ниже, если есть несделанные этапы)
        if (status === 'DONE') askPlanDone(a.id)
      },
    })
  }
  // «Приём состоялся» / «Неявка» по ошибке — приём снова запланирован (сервер не даст, если есть оплата)
  const reopen = async (current: Appointment) => {
    if (!await ask(current.status === 'DONE' ? 'Вернуть приём в запланированные? Отметка «Приём состоялся» снимется.'
      : 'Вернуть приём в запланированные? Отметка «Неявка» снимется.')) return
    action.mutate({ kind: 'undo', body: { version: current.version, previousStatus: 'SCHEDULED' } })
  }
  // «Пришёл» (V234) и ответ пациента «Подтвердил» — отметки у запланированного приёма, не статус на сервере
  const arrive = (arrived: boolean) => action.mutate({ kind: 'arrived', body: { version: a.version, arrived } })
  // «В кресле» (V235) — «Начать приём»: сервер отметит и «Пришёл», если её не ставили
  const seat = (inChair: boolean) => action.mutate({ kind: 'inChair', body: { version: a.version, inChair } })
  // «Отменён» / «Неявка» — окно с причинами (V235) вместо простого вопроса
  const [reasonFor, setReasonFor] = useState<'CANCELLED' | 'NO_SHOW' | null>(null)
  // Ответ пациента — пунктом списка статуса (вместо ряда «Подтвердил / Перенос / Нет ответа»). «Просит перенести» —
  // сразу предложить перенос: форма переноса в этой карточке
  const reply = (value: Reply) => action.mutate({ kind: 'reply', body: { version: a.version, reply: value } }, {
    onSuccess: async () => {
      if (value !== 'RESCHEDULE' || !await ask('Пациент просит перенести. Перенести сейчас?', { ok: 'Перенести' })) return
      setMoved('')
      setEditing('move')
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.appt-card .appt-move')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
    },
  })
  const back = (updated: Appointment) => action.mutate({ kind: 'undo', body: { version: updated.version, previousStatus: undo!.previous } },
    { onSuccess: () => setUndo(null) })
  // То же время, что у этого приёма, — если оно ещё не прошло; иначе форма откроется без времени (сетка свободного)
  const bookAgain = (day: string) => {
    if (!a.patient) return
    const minutes = minutesOf(a.startAt)
    const past = Date.parse(slotInstant(day, minutes)) < Date.now()
    onBook?.({ doctorId: a.doctorId, date: day, minutes: past ? null : minutes, duration: length }, a.patient)
  }

  // Главная кнопка — одна на карточку (DESIGN.md): после приёма, пока не оплачено, это «Принять оплату»
  const payPending = a.status === 'DONE' && seesMoney && a.paidSom == null
  // Статус — пилюлей со списком; выбор делает то же, что раньше отдельные кнопки: вопросы, «Вернуть», «Что сделали сегодня?»
  // Клиника отмечает приход («Пришёл», «В кресле» — V245); по умолчанию нет: сразу «Приём состоялся» или «Неявка»
  const arrivals = marksArrival(me)
  const statusMenu = canEdit ? statusOptions(a, { started, arrivals, paid: a.status === 'DONE' && seesMoney && (a.paidSom != null || a.chargeSom != null) }, {
    schedule: () => void setStatus('SCHEDULED'),
    reopen: () => void reopen(a),
    reply,
    arrive,
    seat,
    done: () => void setStatus('DONE'),
    noShow: () => setReasonFor('NO_SHOW'),
    cancel: () => setReasonFor('CANCELLED'),
  }) : null
  const reasonSheet = reasonFor === 'NO_SHOW'
    ? { question: `Отметить неявку: ${a.patient.fullName} не пришёл(ла) на приём? Почему — если знаете:`, ok: 'Отметить неявку', undo: 'Отмечено: неявка' }
    : a.status === 'REQUESTED'
      ? { question: 'Отклонить заявку? Пациенту придёт сообщение. Причина — для отчёта, пациент её не увидит:', ok: 'Отклонить заявку', undo: 'Заявка отклонена' }
      : { question: `Отменить запись ${a.patient.fullName}? Время освободится. Причина — для отчёта:`, ok: 'Отменить запись', undo: 'Запись отменена' }
  // Следующий шаг — одним касанием рядом со статусом: заявка → «Подтвердить», в день приёма → «Приём состоялся»;
  // клиника отмечает приход — до прихода «Пришёл», пришёл — «Начать приём» (В кресле), потом «Приём состоялся»
  const step = nextStep(a, { canEdit, started, ended, arrivals })
  // Без отметок прихода «Неявка» — ссылкой рядом с главной «Приём состоялся», когда время приёма наступило (одна главная
  // кнопка — DESIGN.md); раньше — в списке статусов и в меню записи
  const noShowLink = !arrivals && step?.kind === 'done' && a.status === 'SCHEDULED'
    && (date < todayIn() || nowMinutes >= minutesOf(a.startAt))
  const next = step && { label: step.label, run: {
    confirm: () => void setStatus('SCHEDULED'),
    arrive: () => arrive(true),
    seat: () => seat(true),
    done: () => void setStatus('DONE'),
  }[step.kind] }
  // Долг пациента за все визиты (кто видит «Должников»; врачу — за его приёмы; регистратуре — по всей клинике, она
  // принимает оплату) и за прошлые — без этого приёма
  const debts = usePatientDebts(a.patient.id ?? undefined, seesPatientDebts(me))
  const patientDebt = (debts.data ?? []).reduce((sum, d) => sum + d.debtSom, 0)
  // «Связаться ▾»: позвонить, написать, напомнить о приёме, попросить оценку, напомнить о долге (форма — под статусом)
  const [debtForm, setDebtForm] = useState(false)
  const contacts = useAppointmentContacts(a, { canEdit, debtSom: patientDebt, onDebt: seesDebts(me) && a.patient.id ? () => setDebtForm(true) : undefined, invite: true })
  const earlierDebt = (debts.data ?? []).filter((d) => d.appointmentId !== a.id).reduce((sum, d) => sum + d.debtSom, 0)
  // Приём в рабочих часах коллеги по креслу (V187): слоты дня врача (те же, что у сетки и списка — обычно из кэша)
  const daySlots = useQuery({
    queryKey: ['slots', date, a.doctorId],
    queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId: a.doctorId } } })),
    enabled: a.doctorId != null && a.status !== 'CANCELLED',
  })
  const colleague = colleagueTimeOf(a, daySlots.data?.chairTime)
  const medAlert = useMedAlert(a.patient.id)
  const chairs = useChairs()
  const chairName = chairs.data?.find((c) => c.id === a.chairId)?.name ?? 'кресло'
  // Телефон: нижняя панель с главной кнопкой и «⋯» (на компьютере — как было)
  const phone = usePhoneCard()
  // Порядок блоков по роли: врач этого приёма или его ассистент — на приёме (пришёл, в кресле, состоялся сегодня)
  const ownVisit = a.doctorId != null && (a.doctorId === me.doctorId || Boolean(me.assistantOf?.includes(a.doctorId)))
  const doctorView = ownVisit && canEdit && (
    (a.status === 'SCHEDULED' && started && Boolean(a.arrivedAt || a.inChairAt)) || (a.status === 'DONE' && date === todayIn()))
  // Регистратура на чужом приёме: без материалов и «В лабораторию» на виду, в кресле — ждёт врача (главной кнопки нет)
  const desk = Boolean(me.reception) && !seesAllMoney(me) && !ownVisit
  const afterVisit = a.status === 'DONE' || a.status === 'NO_SHOW' || a.status === 'CANCELLED'
  // До прихода — ответ пациента («Подтвердил / Перенос / Нет ответа»); пришёл — уже не нужно
  const beforeArrival = a.status === 'SCHEDULED' && !a.arrivedAt && !a.inChairAt

  // Главное действие состояния (UX-аудит 2026-11-20) — одно на карточку: телефон — внизу, компьютер — у пилюли статуса
  // или в своём блоке ленты (оплата, следующий визит)
  const canBook = Boolean(onBook && canEdit && a.patient)
  const thisDebt = a.status === 'DONE' && seesMoney && (a.debtSom ?? 0) > 0
  const kind: MainKind | null = mainActionKind(a, { step, payPending, debt: thisDebt, canBook, canRemind: contacts.remindMain != null, waitsDoctor: desk })
  // Оплата: нижняя «Принять оплату» открывает форму в блоке (ключ — по деньгам приёма, как у самого блока);
  // пока форма открыта, нижней кнопки нет — её «Сохранить» и есть «Принять оплату»
  const payKey = [a.id, a.version, a.paidSom, a.chargeSom, a.debtSom, a.dueOn, a.depositStatus].join('-')
  const [payOpen, setPayOpen] = useState<{ at: string; view: 'edit' | 'extra' } | null>(null)
  const openNow = payOpen?.at === payKey ? payOpen.view : undefined
  const payMain = kind === 'pay' || kind === 'extra'
  const nextVisitDay = () => addDays(date > todayIn() ? date : todayIn(), 7)
  const sourceHint = a.bookedBy ? bookedByText(a.bookedBy) : a.source === 'PATIENT' ? 'Запись через бота'
    : a.source === 'WEB' ? (a.status === 'REQUESTED' ? '🌐 Заявка с сайта, без Telegram — подтвердите звонком' : '🌐 С сайта, без Telegram — бот не напомнит')
      : null

  // Блоки карточки — одни и те же, меняется только порядок (врач / регистратура)
  const quickLinks = a.patient.id ? (
    <span className="appt-quick">
      {/* «Перезвонить после удаления», «отправить снимок в лабораторию» — задача с этим пациентом и приёмом */}
      <button type="button" className="link appt-task" onClick={() => setTaskOpen(true)}>＋ Задача</button>
      {canEdit && !desk && <button type="button" className="link appt-lab-new" onClick={() => setLabOpen(true)}>＋ В лабораторию</button>}
    </span>
  ) : null
  // Откуда запись и «напоминание отправлено» — регистратуре сверху, врачу на приёме — в «О записи»
  const patientExtras = (
    <>
      {sourceHint && <p className="hint small">{sourceHint}</p>}
      {a.reminderOpenedAt && a.status === 'SCHEDULED' && <ReminderSent a={a} canEdit={canEdit} />}
    </>
  )
  // Комментарий записи («Боится уколов») — врачу на приёме у пациента, остальным — у услуги
  const commentBlock = editing === 'comment' ? <CommentEdit appointment={a} onDone={close} /> : a.comment ? (
    <p className="comment line-edit"><span>{a.comment}</span>
      {canEdit && <EditButton label="Изменить комментарий" onClick={() => setEditing('comment')} />}</p>
  ) : null
  // Что за приём: услуга и комментарий — на виду
  const servicesBlock = <ServiceLines appointment={a} me={me} canEdit={canEdit} prices={!isAssistant(me)} />
  const serviceBlock = (
    <>
      {/* Услуги приёма строками (шаг 5А): зубы, количество, цена, ✕ и «＋ Услуга»; прошлый состоявшийся — 🔒.
          Врачу на приёме — в «Приёме» (что делали — клиническое), остальным — здесь, на виду */}
      {!doctorView && servicesBlock}
      {!doctorView && commentBlock}
    </>
  )
  // Промокод ставят в оплате (рядом со скидкой: код может давать скидку) — у состоявшегося приёма тем, кто видит деньги
  const promoInPayment = a.status === 'DONE' && seesMoney
  // Редкое о записи: «＋ Комментарий / ＋ Промокод», кресло, промокод, «откуда узнал» — после визита свёрнуто в «О записи»
  const aboutBlock = (
    <>
        {/* «＋ Комментарий»; промокод (2026-11-20, владелец) — в оплате, рядом со скидкой: здесь — только пока оплаты не видно */}
        {canEdit && a.status !== 'CANCELLED' && !a.comment && editing !== 'comment' && (
          <p className="appt-add-links">
            <button type="button" className="link" onClick={() => setEditing('comment')}>＋ Комментарий</button>
          </p>
        )}
        {/* Кресло приёма (V210) — только когда оно не кресло врача (chair_manual): у остальных и так кресло врача; сменить — у предстоящего */}
        {editing === 'chair' ? <ChairEdit appointment={a} onDone={close} /> : chairs.data && chairs.data.length > 1 && a.chairId != null && a.chairManual && (
          <p className="line-edit appt-chair"><span><span className="hint">Кресло:</span> 🪑 {chairName}<span className="hint"> · не кресло врача</span></span>
            {canEdit && active && future && <EditButton label="Сменить кресло" onClick={() => setEditing('chair')} />}</p>
        )}
        {/* Промокод рекламы: пациент ввёл в боте или назвал по телефону; пустой — «＋ Промокод» рядом с «＋ Комментарий» */}
        {editing === 'promo' ? <PromoEdit appointment={a} onDone={close} /> : a.promoCode ? (
          <p className="line-edit"><span><span className="hint">Промокод:</span> <b>{`🎟 ${a.promoCode}`}</b></span>
            {canEdit && !promoInPayment && <EditButton label="Изменить промокод" onClick={() => setEditing('promo')} />}</p>
        ) : canEdit && !promoInPayment && a.status !== 'CANCELLED' && canEditDoctor(me, a.doctorId) && (
          <p className="appt-add-links"><button type="button" className="link" onClick={() => setEditing('promo')}>＋ Промокод</button></p>
        )}
        {/* Откуда узнал о клинике — строкой «Откуда узнал о клинике? выбрать» / «… Instagram изменить» (раньше — под «Ещё») */}
        {canEdit && a.patient.id != null && <SourceLine patient={a.patient} canEdit compact admin={Boolean(me.admin)} />}
    </>
  )
  const aboutMeta = a.promoCode ? `🎟 ${a.promoCode}` : undefined
  // Регистратуре: до визита — всё строками; после (состоялся, неявка, отмена) — услуга на виду, остальное в «О записи»
  const whatSection = (
    <section className="appt-what">
      {serviceBlock}
      {afterVisit ? (
        <Fold title="О записи" label="О записи" meta={aboutMeta}><div className="appt-about">{aboutBlock}</div></Fold>
      ) : aboutBlock}
    </section>
  )
  const workBlock = (
    <>
      {undo && (
        <div className="undo" role="status">
          <span>{undo.label}</span>
          <button type="button" className="btn small" disabled={action.isPending} onClick={() => back(a)}>Вернуть</button>
        </div>
      )}

      {!canEdit ? (
        <>
          <p className="readonly-note">Приём коллеги — менять может его врач{doctor?.fullName ? ` (${doctor.fullName})` : ''}, ассистент, регистратура или руководитель.</p>
        </>
      ) : (
        <>
          {moved && <p className="tone-ok" role="status">{moved}</p>}
          {/* Ответ пациента — в списке статуса (2026-11-20); здесь — только «напоминать некуда». Врачу на приёме — в «О записи» */}
          {beforeArrival && !doctorView && contacts.nowhere && <p className="hint small" role="note">{NOWHERE_TEXT}</p>}
          {/* Предоплату уже попросили — на виду; ещё не просили — под «Ещё». Ассистенту деньги не показываем */}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED') && seesMoney && a.depositStatus && <DepositBox key={a.depositStatus} appointment={a} />}

          {a.status === 'CANCELLED' && (
            <>
              {/* Почему (V235) и кто когда отменил (V160) — одной строкой, «Отменён» уже в пилюле:
                  «Перенёс на другое время · отменил(а) пациент в боте, сегодня 09:20»; старые отмены — без «кто» */}
              {cancelText(a) && <p className="cancel-reason">{cancelText(a)}</p>}
              {a.depositStatus === 'RECEIVED' && seesMoney && <p className="tone-wait">Предоплата {somText(a.depositSom ?? 0)} получена — верните пациенту или запишите его снова.</p>}
              {/* Шаг 6Б: это время освободилось, а его ждут из листа ожидания — «Предложить» прямо здесь */}
              {canEdit && <FreedHere appointment={a} me={me} />}
            </>
          )}

          {a.status === 'NO_SHOW' && (
            <>
              {reasonLine(a) && <p className="cancel-reason">{reasonLine(a)}</p>}
            </>
          )}

          {/* «Что сделали сегодня?» — этапы плана лечения сразу после «Приём состоялся», над оплатой: блоком
              в этой же карточке, а не окном поверх неё. Главная кнопка — у оплаты, если она ещё не принята */}
          {a.status === 'DONE' && <PlanDone appointment={a} me={me} primary={kind == null} />}
          {/* Оплата — сразу после приёма. Ключ — по самим деньгам: оплата на сервере версию приёма не
              меняет, а блок после сохранения должен открыться заново («оплачено», а не форма) */}
          {payPending && earlierDebt > 0 && (
            <p className="appt-debt-hint tone-wait" role="status">🧾 У пациента долг {somText(earlierDebt)} за прошлые визиты — напомните при оплате.</p>
          )}
          {a.status === 'DONE' && seesMoney && (
            <div ref={payRef} className="appt-pay appt-pay-anchor">
              <PaymentBox key={`${payKey}-${openNow ?? ''}`} appointment={a} me={me} open={openNow}
                quiet={!payMain} />
            </div>
          )}
          {/* Квитанция — строкой сразу под оплатой: «Печать» и «Отправить пациенту» (раньше — под «Ещё») */}
          {a.status === 'DONE' && canEdit && <VisitDocs appointment={a} me={me} memo={false} />}
          {/* «Записать на следующий визит»: главная — внизу (телефон) или здесь залитой (компьютер); при оплате или
              долге — обычной кнопкой, главная у них — оплата */}
          {a.status === 'DONE' && canBook && !(phone && kind === 'next-visit') && (
            <button type="button" className={!phone && kind === 'next-visit' ? 'btn primary' : 'btn'} onClick={() => bookAgain(nextVisitDay())}>Записать на следующий визит</button>
          )}
        </>
      )}

    </>
  )
  const visitSection = (
    <>
      {/* «Приём» — работа врача, по приоритету: продолжение лечения, заметка (диктовка — в её строке), зубы, план
          лечения, снимки, материалы, расход (техник, лаборатория), лаборатория на этот приём. Раскрывашками со счётчиками */}
      {(clinical || (canEdit && (visitTools || a.status === 'NO_SHOW'))) && a.status !== 'CANCELLED' && (
        <section className="appt-visit" aria-label="Приём">
          {clinical && <ContinueTreatment appointment={a} open={visitTools && a.status === 'SCHEDULED'} onMedical={medical} />}
          {doctorView && servicesBlock}
          {canEdit && (visitTools || a.status === 'NO_SHOW') && <VisitNote appointment={a} me={me} />}
          {/* Зубы этого приёма: врач приёма и админ отмечают, ассистент видит; «Карта зубов и план лечения ›» — вся медкарта */}
          {canEdit && visitTools && clinical && a.patient.id != null && (
            <VisitTeeth appointment={a} onMedical={medical}
              readOnly={lockedForMe(a, me) || !(seesAllMoney(me) || (a.doctorId != null && a.doctorId === me.doctorId))} />
          )}
          {/* План лечения — сразу после зубов: тот же редактор, что в медкарте — добавить этапы, отметить сделанное */}
          {visitTools && clinical && a.patient.id != null && <VisitPlan appointment={a} me={me} />}
          {/* Раскрывашки — по частоте (UX-аудит 2026-11-20): Зубы → План → Снимки → Материалы → Расход */}
          {canEdit && visitTools && clinical && a.patient.id != null && (
            <PatientFiles patientId={a.patient.id} readOnly={isAssistant(me)} compact defaultKind="PHOTO" takenOn={date} />
          )}
          {/* Материалы списывает врач или ассистент — регистратуре не показываем */}
          {canEdit && visitTools && !desk && <Supplies appointment={a} me={me} />}
          {/* Расход по пациенту (техник, лаборатория) — врачу часто, поэтому не под «Ещё»; как «Материалы» — уже во время
              приёма, не только после «состоялся». Регистратуре и ассистенту нет (у них нет своих расходов) */}
          {canEdit && visitTools && seesMoney && a.patient.id != null && (me.admin || me.doctorId != null) && (
            <PatientExpensesFold patient={a.patient} me={me} doctorId={a.doctorId} />
          )}
          {/* Заказы лаборатории на этот приём (примерка) — только если есть такая работа */}
          {canEdit && visitTools && a.patient.id ? <AppointmentLab appointment={a} me={me} /> : null}
          {canEdit && a.status === 'SCHEDULED' && started && !visitTools && (
            <p className="hint small">Заметка, зубы и материалы — к началу приёма.{' '}
              <button type="button" className="link" onClick={() => setEarly(true)}>Показать сейчас</button></p>
          )}
        </section>
      )}

    </>
  )
  // Нижняя панель телефона: следующий шаг (тот же, что рядом со статусом) или «Принять оплату» — прокрутить к оплате
  // Карточка приёма на экране одна: блок ищем по классу (оплата, форма переноса)
  const scrollTo = (selector: string) => {
    const el = document.querySelector<HTMLElement>(`.appt-card ${selector}`)
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    el?.querySelector<HTMLElement>('input, button, select, textarea')?.focus({ preventScroll: true })
  }
  const main: { label: string; run: () => void; disabled?: boolean } | null = kind && {
    step: next ? { label: next.label, run: next.run } : null,
    remind: contacts.remindMain,
    reply: { label: 'Подтвердил', run: () => reply('CONFIRMED') },
    pay: { label: 'Принять оплату', run: () => { setPayOpen({ at: payKey, view: 'edit' }); requestAnimationFrame(() => scrollTo('.appt-pay')) } },
    extra: { label: 'Принять доплату', run: () => { setPayOpen({ at: payKey, view: 'extra' }); requestAnimationFrame(() => scrollTo('.appt-pay')) } },
    'next-visit': { label: 'Записать на следующий визит', run: () => bookAgain(nextVisitDay()) },
    'book-again': { label: 'Записать снова', run: () => bookAgain(todayIn()) },
  }[kind]
  // Оплата — вся в своём блоке и на телефоне (2026-11-21, владелец: «Принять оплату» внизу казалась последней кнопкой,
  // а «Бесплатно» — отдельно сверху): в нижней панели её нет, там следующий шаг и «⋯»
  const barMain = main && !payMain ? main : null
  // Компьютер: шаг, «Напомнить», «Подтвердил», «Записать снова» — у пилюли; оплата и следующий визит — в ленте
  const statusMain = !phone && main && kind !== 'pay' && kind !== 'extra' && kind !== 'next-visit' ? main : null
  const noShowButton = (
    <button type="button" className="link appt-noshow" disabled={action.isPending} onClick={() => setReasonFor('NO_SHOW')}>🚷 Неявка</button>
  )
  const barMenu = [
    // В кресле — не переносят
    canEdit && (a.status === 'REQUESTED' || a.status === 'SCHEDULED') && !a.inChairAt
      ? { label: editableDoctors(me, doctors).length > 1 ? 'Перенести или передать врачу' : 'Перенести', icon: 'move' as const,
          onSelect: () => { setMoved(''); setEditing('move'); requestAnimationFrame(() => scrollTo('.appt-move')) } } : null,
    a.patient.id ? { label: 'Новая задача', hint: 'позвонить, напомнить', icon: 'task' as const, onSelect: () => setTaskOpen(true) } : null,
    a.patient.id && canEdit ? { label: 'Заказ в лабораторию', hint: 'работа технику', icon: 'lab' as const, onSelect: () => setLabOpen(true) } : null,
    a.patient && a.status !== 'CANCELLED' ? { label: 'Показать пациенту', hint: 'презентация по услуге', icon: 'show' as const, onSelect: () => setLesson(true) } : null,
    me.owner ? { label: 'Удалить запись', icon: 'trash' as const, danger: true, onSelect: () => void removeAppointment() } : null,
  ].filter((x): x is NonNullable<typeof x> => x != null)

  return (
    <>
    {full && <div className="panel-backdrop" onClick={toggleFull} aria-hidden="true" />}
    <aside className={full ? 'panel panel-full appt-card' : 'panel appt-card'} aria-label="Карточка приёма">
      {/* Шапка: когда и у кого — коротко, без переноса («пт, 20 нояб · Айгерим С.»); справа — показать пациенту, на весь
          экран, закрыть */}
      <header className="panel-head">
        <div className="appt-when">
          <div className="with-hint"><h2>{timeOf(a.startAt)}–{timeOf(a.endAt)}</h2><HelpHint hint="appointment" /></div>
          <span className="hint appt-day">{shortDayTitle(date)}{doctors.length > 1 && doctor ? <> · <span className="nowrap">врач {shortName(doctor.fullName ?? '')}</span></> : null}</span>
        </div>
        <div className="panel-head-actions">
          {/* Презентация по услуге — показать на экране; отправлять не нужно: после приёма уходит отчёт */}
          {a.patient && a.status !== 'CANCELLED' && (
            <button type="button" className="btn ghost" aria-pressed={lesson} aria-label="Показать пациенту" title="Показать пациенту"
              onClick={() => setLesson(!lesson)}>📖</button>
          )}
          {/* «⋯» — редкое и опасное: удалить запись насовсем (только владелец Tish; клиники отменяют) */}
          {me.owner && !phone && (
            <ActionMenu label="Ещё действия" buttonLabel="Ещё действия" className="btn ghost" content="⋯" caret={false} align="right"
              title={`${timeOf(a.startAt)} · ${a.patient.fullName}`}
              disabled={remove.isPending} items={[{ label: 'Удалить запись', icon: 'trash', danger: true, onSelect: () => void removeAppointment() }]} />
          )}
          <button type="button" className="btn ghost panel-expand" aria-pressed={full} onClick={toggleFull}
            aria-label={full ? 'Свернуть карточку' : 'Карточка на весь экран'} title={full ? 'Свернуть' : 'На весь экран'}>{full ? '⤡' : '⤢'}</button>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
      </header>
      {lesson && a.patient && (
        <LessonPicker key={`${a.id}-${a.serviceName ?? ''}`} serviceName={a.serviceName} patientId={a.patient.id} onClose={() => setLesson(false)} />
      )}

      {/* Пациент — сразу под шапкой (по просьбе владельца, 2026-11-20): имя (→ его карточка), номер «Связаться ▾», метка
          словом, аллергия, чипы, история одной строкой. Статус — ниже */}
      <section className="appt-patient" aria-label="Пациент">
        <div className="appt-who">
          {onOpenPatient && a.patient.id
            ? <button type="button" className="link patient-name" onClick={() => onOpenPatient(a.patient.id)}>{a.patient.fullName} ›</button>
            : <strong className="patient-name">{a.patient.fullName}</strong>}
          {/* Номер — он же «📞 Связаться ▾»: позвонить, WhatsApp, напомнить, попросить оценку, долг (2026-11-19) */}
          {contacts.items.length
            ? <ContactMenu items={contacts.items} className="link appt-phone"
                content={a.patient.phone ? <span className="num">{formatPhone(a.patient.phone)}</span> : <><span aria-hidden="true">📞 </span>Связаться</>} />
            : a.patient.phone && <span className="num">{formatPhone(a.patient.phone)}</span>}
        </div>
        {/* Метки пациента одной строкой, по важности: ⚠ аллергия из анкеты (кто видит медкарту; нажать — весь список и
            «Анкета ›»), ❗ важно для врача (кому анкета закрыта), 🧾 долг, ⭐ ВИП, своя метка клиники словом (V239) */}
        {(() => {
          const pill = clinical && a.status !== 'CANCELLED'
            ? <MedAlertPill an={anamnesis.data} onOpen={onMedical ? () => onMedical(a.patient, 'anamnesis') : undefined} /> : null
          // ❗ без текста — тем, кому пилюля не видна: регистратуре, коллеге; анкета не открылась (403) — тоже чип
          const showAlert = Boolean(medAlert && a.status !== 'CANCELLED' && !(clinical && anamnesis.isSuccess))
          const showDebt = patientDebt > 0 && a.status !== 'CANCELLED' && !payPending
          const tags = (a.patient.tagIds?.length ?? 0) > 0
          if (!pill && !showAlert && !showDebt && !a.patient.vip && !tags) return null
          return (
            <div className="appt-marks">
              {pill}
              {showAlert && <span className="chip s-bad appt-mark" role="note" title={medAlert?.text ?? 'Есть отметки в анкете: аллергия, болезни — видит врач'}><span className="ico" aria-hidden="true">❗</span>Важно для врача</span>}
              {/* Долг пациента — на виду, пока он записан или пришёл; после «Приём состоялся» — подсказка у оплаты */}
              {showDebt && <span className="chip s-bad appt-debt" role="note"><span className="ico" aria-hidden="true">🧾</span>Долг {somText(patientDebt)}</span>}
              {a.patient.vip && <span className="chip appt-mark" role="note" title="ВИП — особое внимание"><span className="ico" aria-hidden="true">⭐</span>ВИП</span>}
              <TagDots patient={a.patient} named />
            </div>
          )
        })()}
        {/* История одной строкой слева, «＋ Задача» и «＋ В лабораторию» — справа в той же строке (врачу на приёме — в «О записи») */}
        <div className="appt-history-row">
          <PatientHistory appointment={a} me={me} />
          {!doctorView && quickLinks}
        </div>
        <KidInfo patient={a.patient} />
        {/* Врачу на приёме комментарий записи («Боится уколов») — здесь, у пациента, а не в свёрнутой «О записи» */}
        {doctorView && commentBlock}
      </section>

      {/* Статус пилюлей и рядом главное действие (компьютер; телефон — внизу) */}
      <div className="appt-status-row">
        <StatusPill appointment={a} options={statusMenu} disabled={action.isPending} />
        {statusMain && <button type="button" className="btn primary" disabled={action.isPending || statusMain.disabled} onClick={statusMain.run}>{statusMain.label}</button>}
        {statusMain && kind === 'step' && noShowLink && noShowButton}
      </div>
      {reasonFor && (
        <ReasonSheet kind={reasonFor} question={reasonSheet.question} ok={reasonSheet.ok} onClose={() => setReasonFor(null)}
          onPick={(reason, note) => {
            setReasonFor(null)
            void setStatus(reasonFor, { undo: reasonSheet.undo, reason, note })
          }} />
      )}
      {contacts.inviteSheet}
      {contacts.error && <p className="error" role="alert">{Object.values(contacts.error.fieldErrors)[0] ?? contacts.error.message}</p>}
      {debtForm && a.patient.id && <DebtRemindForm patientId={a.patient.id} name={a.patient.fullName} onDone={() => setDebtForm(false)} />}
      {colleague && (
        <p className="appt-chair-mark" role="note"><span aria-hidden="true">🪑 </span>{colleagueMarkText(colleague)}</p>
      )}
      {/* Примерка на этот приём: работа пришла? Нет — предупреждение и «WhatsApp технику». До приёма — здесь,
          наверху (успеть позвонить технику); на приёме и после — в секции «Приём», после расхода */}
      {a.patient.id && canEdit && !visitTools ? <AppointmentLab appointment={a} me={me} /> : null}
      {!doctorView && patientExtras}
      {/* Оценка и отзыв пациента — всем, и врачу на приёме */}
      {a.rating != null && (
        <p className="rating" aria-label={`Оценка пациента: ${a.rating} из 5`}><span className="rating-stars">{'★'.repeat(a.rating)}{'☆'.repeat(5 - a.rating)}</span> <span className="hint">оценка пациента{a.ratingVia === 'PAGE' ? ' · по ссылке' : ''}</span></p>
      )}
      {a.reviewComment && <blockquote className="review-comment"><span className="hint">Пациент написал:</span><br />{a.reviewComment}</blockquote>}

      {!doctorView && whatSection}
      {doctorView && visitSection}
      {workBlock}
      {!doctorView && visitSection}
      {/* «Сообщение после приёма» — отчёт пациенту: личная часть и уход дома из памятки */}
      {canEdit && a.status === 'DONE' && <AfterVisit appointment={a} me={me} />}

      {/* Врачу на приёме — запись и связь ниже клинического, свёрнуто: услуга, комментарий, промокод, откуда узнал, задачи */}
      {doctorView && (
        <Fold title="О записи" label="О записи" meta={serviceLabel(a)}>
          <div className="appt-about">
            {whatSection}
            {beforeArrival && contacts.nowhere && <p className="hint small" role="note">{NOWHERE_TEXT}</p>}
            {quickLinks}
            {patientExtras}
          </div>
        </Fold>
      )}

      {/* Перенести — на виду внизу (телефон — в «⋯» нижней панели); неявка и отмена — в списке статуса, их можно «Вернуть» */}
      {canEdit && !phone && (a.status === 'REQUESTED' || a.status === 'SCHEDULED') && !a.inChairAt && (
        <div className="danger-zone actions">
          {editing !== 'move' && (
            <button type="button" className="btn" onClick={() => { setMoved(''); setEditing('move') }}>{editableDoctors(me, doctors).length > 1 ? 'Перенести или передать врачу' : 'Перенести'}</button>
          )}
        </div>
      )}
      {editing === 'move' && <div ref={moveRef} className="appt-move"><Reschedule appointment={a} me={me} onDone={(text) => { close(); setMoved(text ?? '') }} /></div>}

      {/* Редкое у предстоящего приёма — строкой ссылок, как «＋ Комментарий» (2026-11-20, вместо свёрнутого «Ещё»):
          «＋ Предоплата» (ещё не просили), «＋ В лист ожидания»; нажали — форма под строкой */}
      {canEdit && rare.length > 0 && (
        <div className="rare">
          {(rare.some((r) => r !== extra && !(r === 'waitlist' && waiting))) && (
            <p className="appt-add-links">
              {rare.includes('deposit') && extra !== 'deposit' && <button type="button" className="link" onClick={() => setExtra('deposit')}>＋ Предоплата</button>}
              {rare.includes('waitlist') && !waiting && extra !== 'waitlist' && <button type="button" className="link" onClick={() => setExtra('waitlist')}>＋ В лист ожидания</button>}
            </p>
          )}
          {rare.includes('deposit') && extra === 'deposit' && <DepositBox key="none" appointment={a} asking onCancel={() => setExtra(null)} />}
          {rare.includes('waitlist') && (waiting || extra === 'waitlist') && a.patient && (
            <div className="sub-form"><WaitlistBox patient={a.patient} me={me} defaultMinutes={length} onCancel={() => setExtra(null)} /></div>
          )}
        </div>
      )}
      {(action.error ?? (remove.error?.code === 'has-records' ? null : remove.error)) && <p className="error" role="alert">{(action.error ?? remove.error)!.message}</p>}
      {taskOpen && a.patient.id ? (
        <TaskDialog patient={{ id: a.patient.id, fullName: a.patient.fullName }} appointmentId={a.id} onClose={() => setTaskOpen(false)} />
      ) : null}
      {labOpen && a.patient.id ? (
        <LabOrderDialog me={me} preset={{ patient: { id: a.patient.id, fullName: a.patient.fullName }, doctorId: a.doctorId, appointment: { id: a.id, startAt: a.startAt } }}
          onClose={() => setLabOpen(false)} />
      ) : null}
      {/* Телефон: следующий шаг и «⋯» — внизу карточки, всегда под пальцем (над безопасной зоной iPhone) */}
      {phone && (barMain || barMenu.length > 0) && (
        <div className="appt-bar" role="toolbar" aria-label="Действия с приёмом">
          {barMain && <button type="button" className="btn primary appt-bar-main" disabled={action.isPending || barMain.disabled} onClick={barMain.run}>{barMain.label}</button>}
          {barMain && kind === 'step' && noShowLink && noShowButton}
          {barMenu.length > 0 && (
            <ActionMenu label="Ещё действия" buttonLabel="Ещё действия" className="btn appt-bar-more" content="⋯" caret={false} align="right"
              title={`${timeOf(a.startAt)} · ${a.patient.fullName}`} disabled={remove.isPending} items={barMenu} />
          )}
        </div>
      )}
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

/**
 * Отмена одной строкой (UX-аудит 2026-11-20): «Перенёс на другое время · отменил(а) пациент в боте, сегодня 09:20».
 * «Отменён» уже написан в пилюле статуса. Причины нет — «Отменил(а) …»; ни причины, ни «кто» (старые отмены) — null.
 */
function cancelText(a: Appointment): string | null {
  const reason = a.cancelReason ? `${REASON_TEXT[a.cancelReason]}${a.cancelNote ? ` — ${a.cancelNote}` : ''}` : null
  const who = a.cancelledBy || a.cancelledAt
    ? [a.cancelledBy ?? 'кто — не записано', a.cancelledAt ? cancelledWhen(a.cancelledAt, { sayToday: true }) : null].filter(Boolean).join(', ')
    : null
  if (reason && who) return `${reason} · отменил(а) ${who}`
  return reason ?? (who ? `Отменил(а) ${who}` : null)
}
