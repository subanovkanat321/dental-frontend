import { advanceOnEnter, reveal } from '../lib/advance'
import { ask, notify } from '../lib/confirm'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings, useWaitlist } from '../api/settings'
import { useClose } from '../lib/useClose'
import { freeSlotText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { addDays, dateOf as dateOfInstant, formatPhone, minutesOfTime, nowMinutes5, shortDate, shortDay, slotInstant, somText, timeOf, todayIn } from '../lib/time'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneFromText } from '../clinic/phone'
import { servicesOfDoctor } from '../lib/doctorServices'
import { sourceChoices, useSources } from '../lib/sources'
import { expired, usePromoCodes } from '../lib/promo'
import { isChairError, withChairConfirm } from './chairTime'
import { ChairTimeHint } from './ChairTimeHint'
import { useChairChoice } from './chairChoice'
import { DurationField } from './DurationField'
import { TimePicker } from './TimePicker'
import { refreshAppointmentData } from './useAppointmentAction'
import { editableDoctors, isAssistant, seesAllMoney } from '../lib/roles'
import { DateInput } from '../layout/DateInput'
import { useFreeDays } from '../lib/freeDays'
import { TimeInput } from '../layout/TimeInput'
import { Select } from '../layout/Select'
import { useDebounced } from '../lib/useDebounced'
import { ServicePicker } from '../clinic/ServicePicker'
import { Spinner } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'
import { nameFromText } from './contactText'
import { ContactPick } from '../patients/ContactPick'
import { BookingContext } from './BookingContext'
import { Fold } from '../layout/Fold'
import { shortName } from '../lab/text'
import { ageYears, yearsText } from '../lib/age'
import { GUARDIAN_RELATION } from '../lib/guardian'
import { activeUpcoming, treatingDoctorId, usePatientCard } from './patientCard'
import type { QueryClient } from '@tanstack/react-query'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']
type Service = Schemas['ServiceTypeView']

/**
 * Куда записать: врач, день и минуты от полуночи по Бишкеку (слот, на который нажали); duration — длительность по
 * умолчанию («Записать снова» — как прошлый приём). minutes: null — время не выбрано: в форме сетка свободного времени.
 * serviceId — услуга сразу выбрана («Записать» из «Позвать снова → Отменили»).
 *
 * soft — врач подставлен по умолчанию, а не выбран колонкой сетки: выбрали пациента — врачом станет лечащий (врач его
 * последнего состоявшегося приёма). next — «Записать на следующий визит» / «Записать снова» из карточки приёма: услуга и
 * врач следующего этапа плана лечения, время — ближайшее свободное у врача (день — тот же или следующие).
 */
/** «1 ч 45 мин», «45 мин» — длительность нескольких услуг. */
function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
}

export type Slot = { doctorId: number; date: string; minutes: number | null; duration?: number; serviceId?: number; soft?: boolean; next?: boolean }

const UNTOUCHED = { doctor: false, time: false, service: false }

/** Врачей не больше — чипами, а не списком (телефон: одно касание). */
const DOCTOR_CHIPS = 6

/** Сколько недавних пациентов показать под пустым поиском. */
const RECENT = 5

/** «38 лет · был 5 нояб · +996 555 123 456», ребёнок — «7 лет · мама Гульнара Т.»: различать тёзок в найденных. */
function foundMeta(p: Patient, lastVisit?: string | null): string {
  const age = ageYears(p.birthDate)
  const g = p.guardian
  const guardian = g?.fullName ? `${g.relation && g.relation !== 'OTHER' ? `${GUARDIAN_RELATION[g.relation]} ` : 'предст. '}${shortName(g.fullName)}` : null
  return [
    age != null ? yearsText(age) : null,
    lastVisit ? `был ${shortDate(lastVisit, true).replace(/,.*$/, '')}` : null,
    guardian,
    (p.phone ?? g?.phone) ? formatPhone((p.phone ?? g?.phone)!) : null,
  ].filter(Boolean).join(' · ')
}

/** Сколько дней вперёд искать свободное время для «следующего визита». */
const SNAP_DAYS = 14

/**
 * Ближайшее свободное начало у врача: в день date — ближе всего к minutes (null — первое), нет — первое в следующие
 * дни. Те же запросы и ключи, что у сетки времени (TimePicker): выбранный день потом откроется из кэша.
 */
async function freeTimeNear(client: QueryClient, doctorId: number, date: string, duration: number, minutes: number | null): Promise<{ date: string; time: string } | null> {
  for (let i = 0; i < SNAP_DAYS; i++) {
    const day = addDays(date, i)
    const data = await client.fetchQuery({
      queryKey: ['slots', day, doctorId, duration, null],
      queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date: day, doctorId, duration } } })),
    }).catch(() => null)
    const starts = (data?.starts ?? []).filter((s) => Date.parse(s) > Date.now()).map(timeOf)
    if (!starts.length) continue
    const time = i === 0 && minutes != null
      ? starts.reduce((best, t) => Math.abs(minutesOfTime(t) - minutes) < Math.abs(minutesOfTime(best) - minutes) ? t : best)
      : starts[0]!
    return { date: day, time }
  }
  return null
}


function timeText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Время в форме для слота: не выбрано — пусто, в форме сетка свободного времени. */
function initialTime(slot: Slot): string {
  return slot.minutes == null ? '' : timeText(slot.minutes)
}

/**
 * «Новая запись» справа: нажали на пустое место в колонке врача — время уже стоит (кратно 15
 * минутам). Пациента — найти по имени или номеру, или завести нового (+996). Занятое время
 * не пустит база (appointment_no_overlap → 409): показываем её ответ.
 *
 * Пришёл без записи — чип «⚡ Сейчас» над временем (раньше — отдельная кнопка «Принять сейчас» в шапке):
 * сегодня, время — эта минута вниз до 5, врач — тот, к кому записывает кнопка шапки; вместо сетки
 * свободного — поле времени, главная кнопка — «Начать приём». Сервер walk-in не отличает: это та же запись.
 */
export function NewAppointmentPanel({ slot, me, initialPatient = null, initialContact = null, nowDoctorId, onClose, onCreated, onOpenAppointment }: {
  slot: Slot
  me: Me
  /** К кому «⚡ Сейчас»: выбранный в расписании врач, иначе свой, иначе первый доступный. Нет — врач формы. */
  nowDoctorId?: number
  /** Пациент уже выбран — «Записать» из его карточки в «Пациентах». */
  initialPatient?: Patient | null
  /** Контакт, присланный боту (кнопка «📅 Записать»): найти пациента по номеру, нет — «Новый пациент» с именем и номером.
   * Без номера (помощник в боте: «Пациента … нет в базе») — сразу «Новый пациент» с этим именем. */
  initialContact?: { fullName: string; phone: string } | null
  onClose: () => void
  /** walkIn — «⚡ Сейчас»: приём начинается, карточку открыть сразу; обычная запись — тост «Записано: … — Открыть» */
  onCreated: (a: Appointment, how?: { walkIn: boolean }) => void
  /** «Уже записан: … Открыть ›» — карточка той записи. */
  onOpenAppointment?: (a: Appointment) => void
}) {
  useClose(onClose)

  const client = useQueryClient()
  // Только врачи, к которым мне можно записать (свой, мои врачи у ассистента; админ и регистратура — все)
  const doctors = editableDoctors(me, (me.doctors ?? []).filter((d) => d.active !== false))
  const [doctorId, setDoctorId] = useState(() => (doctors.some((d) => d.id === slot.doctorId) ? slot.doctorId : doctors[0]?.id ?? slot.doctorId))
  const [date, setDate] = useState(slot.date)
  const [time, setTime] = useState(() => initialTime(slot))
  // «⚡ Сейчас»: пациент пришёл сам — приём с этой минуты, без сетки свободного и листа ожидания
  const [walkIn, setWalkIn] = useState(false)
  const [birthDate, setBirthDate] = useState('')
  const [source, setSource] = useState('')
  const sources = useSources()
  const [wantsEarlier, setWantsEarlier] = useState(false)
  const [duration, setDuration] = useState(slot.duration ?? 30)
  // Месяц, открытый в календаре «День», — для зелёных дней врача (useFreeDays, кэш по месяцу)
  const [calMonth, setCalMonth] = useState(slot.date.slice(0, 7))
  const freeDays = useFreeDays(doctorId, calMonth, duration)
  // Несколько услуг на запись (шаг 5А): первая — главная; serviceId — она (подстановки этапа плана, «Записать снова»)
  const [serviceIds, setServiceIds] = useState<number[]>(slot.serviceId != null ? [slot.serviceId] : [])
  const serviceId: number | '' = serviceIds[0] ?? ''
  const timeRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [comment, setComment] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const promoCodes = usePromoCodes()
  const [patient, setPatient] = useState<Patient | null>(initialPatient)
  const [query, setQuery] = useState('')
  // Помощник в боте: пациента нет в базе — сразу «Новый пациент» с именем (номер введут здесь)
  const nameOnly = initialContact != null && !initialContact.phone
  const [adding, setAdding] = useState(nameOnly)
  const [name, setName] = useState(nameOnly ? initialContact.fullName.trim() : '')
  const [phone, setPhone] = useState('')
  const [duplicate, setDuplicate] = useState<Patient | null>(null)
  const [problem, setProblem] = useState('')
  // «Записать сюда» в подсказке листа ожидания: после записи сервер уберёт эту строку листа
  const [fromWaitlist, setFromWaitlist] = useState<WaitlistEntry | null>(null)

  // Новый слот (нажали в другое место) — новое время и врач, введённое о пациенте остаётся.
  // Меняем состояние прямо при отрисовке, а не в эффекте: React перерисует сразу, без мигания
  const [shown, setShown] = useState(slot)
  // Подстановка по пациенту (ниже) — для какого слота и пациента уже сделана; snap — поиск ближайшего свободного времени
  const [presetDone, setPresetDone] = useState<{ slot: Slot; patientId: number } | null>(null)
  const [snap, setSnap] = useState<{ slot: Slot; doctorId: number; duration: number } | null>(null)
  // Что сотрудник уже выбрал сам — подстановка по пациенту и плану этого не меняет (данные приходят позже).
  // Состояние — для отрисовки, ref — для ответа поиска свободного времени, пришедшего позже
  const [touched, setTouched] = useState(UNTOUCHED)
  const touchedNow = useRef(UNTOUCHED)
  const touch = (kind: keyof typeof UNTOUCHED) => {
    touchedNow.current = { ...touchedNow.current, [kind]: true }
    setTouched(touchedNow.current)
  }
  if (shown !== slot) {
    setShown(slot)
    setDoctorId(slot.doctorId)
    setDate(slot.date)
    setTime(initialTime(slot))
    setWalkIn(false)
    setTouched(UNTOUCHED)
    setSnap(null)
  }
  useEffect(() => { touchedNow.current = UNTOUCHED }, [shown])

  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    select: (list) => list.filter((s) => s.active !== false),
  })

  // Выбранный пациент: его карточка (уже записан, лечащий врач) и — для «следующего визита» — план лечения. План — медданные:
  // сервер отдаёт его тем, кто видит медкарту (врач, руководитель, ассистент); регистратуре — нет, тогда без этапа
  const card = usePatientCard(patient?.id)
  const seesPlan = seesAllMoney(me) || me.doctorId != null || isAssistant(me)
  const planWanted = Boolean(shown.next) && patient?.id != null && seesPlan
  const plan = useQuery({
    queryKey: ['plan', patient?.id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId: patient!.id } } })),
    enabled: planWanted,
    retry: false,
  })
  // Регистратуре план закрыт — сервер отдаёт только следующий этап для записи: услугу, врача и срок (без названия,
  // зуба и диагноза; GET /plan/next)
  const nextWanted = Boolean(shown.next) && patient?.id != null && !seesPlan
  const nextStep = useQuery({
    queryKey: ['plan-next', patient?.id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/next', { params: { path: { patientId: patient!.id } } })),
    enabled: nextWanted,
    retry: false,
  })
  // Подстановка — один раз на слот и пациента, когда пришли данные: врач (лечащий / этапа плана), услуга этапа; время —
  // ближайшее свободное (запросом, ниже). Меняем состояние при отрисовке, как у нового слота выше: без лишнего круга
  const presetKey = patient?.id != null && (shown.soft || shown.next) ? shown : null
  const ready = card.isFetched && (!planWanted || plan.isFetched) && (!nextWanted || nextStep.isFetched) && services.data != null
  if (presetKey && ready && patient?.id != null && !(presetDone?.slot === presetKey && presetDone.patientId === patient.id)) {
    setPresetDone({ slot: presetKey, patientId: patient.id })
    const bookable = (id?: number) => id != null && doctors.some((d) => d.id === id)
    const step: { serviceTypeId?: number; doctorId?: number; dueOn?: string } | undefined = !presetKey.next ? undefined
      : nextWanted ? nextStep.data : (plan.data ?? []).filter((s) => !s.doneAt).sort((x, y) => x.stage - y.stage)[0]
    let doctor = doctorId
    if (!touched.doctor) {
      const pick = [step?.doctorId, presetKey.next ? presetKey.doctorId : treatingDoctorId(card.data)].find(bookable)
      if (pick != null) {
        doctor = pick
        setDoctorId(pick)
      }
    }
    let length = duration
    if (step?.serviceTypeId != null && presetKey.serviceId == null && !touched.service) {
      const sv = servicesOfDoctor(services.data ?? [], me.doctorServices, doctor).find((x) => x.id === step.serviceTypeId)
      if (sv) {
        setServiceIds([sv.id])
        if (sv.durationMinutes) {
          length = sv.durationMinutes
          setDuration(length)
        }
      }
    }
    // Срок этапа раньше предложенного дня — ищем время к сроку (с него, не раньше сегодня)
    const due = step?.dueOn && step.dueOn >= todayIn() && step.dueOn < presetKey.date ? step.dueOn : null
    if (presetKey.next && !touched.time) setSnap({ slot: due ? { ...presetKey, date: due, minutes: null } : presetKey, doctorId: doctor, duration: length })
  }
  useEffect(() => {
    if (!snap) return
    let live = true
    void freeTimeNear(client, snap.doctorId, snap.slot.date, snap.duration, snap.slot.minutes).then((free) => {
      // Пока искали, сотрудник выбрал время сам или открыл другой слот — не трогаем
      if (!live || !free || touchedNow.current.time) return
      setDate(free.date)
      setCalMonth(free.date.slice(0, 7))
      setTime(free.time)
    })
    return () => { live = false }
  }, [snap, client])

  const search = useDebounced(query.trim())
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && !patient,
  })

  // Пустой поиск — недавние пациенты (тот же список, что в «Пациентах»): выбрать одним касанием, без ввода.
  // Он же даёт «был 5 нояб» в строках найденных — различать тёзок
  const recent = useQuery({
    queryKey: ['patients', 'recent', null],
    queryFn: () => unwrap(api.GET('/api/patients/recent')),
    enabled: !patient && !adding,
    staleTime: 60_000,
  })
  const lastVisitOf = (id: number) => recent.data?.find((r) => r.id === id)?.lastVisit

  const createPatient = useMutation<Patient, ApiError, { allowDuplicate: boolean }>({
    mutationFn: ({ allowDuplicate }) => unwrap(api.POST('/api/patients', {
      body: { fullName: name.trim(), phone: phoneFromInput(phone), allowDuplicate, birthDate: birthDate || undefined, sourceId: source ? Number(source) : undefined },
    })),
  })

  /** Строка листа ожидания — только пока выбран тот же пациент («Другой» — уже обычная запись). */
  const waitlistId = (p: Patient) => (fromWaitlist && fromWaitlist.patient?.id === p.id ? fromWaitlist.id : undefined)
  const pickWaiting = (e: WaitlistEntry) => {
    setPatient(e.patient ?? null)
    setAdding(false)
    setFromWaitlist(e)
    if (e.durationMinutes) setDuration(e.durationMinutes)
    reveal(submitRef.current, true)
  }

  const [hh, mm] = time.split(':').map(Number)
  const startAt = time ? slotInstant(date, (hh ?? 0) * 60 + (mm ?? 0)) : null
  // Кресло (V210): без поля — кресло врача; другое — только нажатием в блоке «Свободно: …» при конфликте
  const chair = useChairChoice(doctorId, undefined, `${startAt ?? ''}|${duration}`)

  const create = useMutation<Appointment, ApiError, Patient>({
    mutationFn: async (p) => {
      // В часы коллеги по креслу (V187) сервер спросит «Коллега предупреждён?» — «Записать» повторит с подтверждением
      // Кресло занято, а другое свободно (V210) — «записать туда?» и повтор с chairId
      const created = await withChairConfirm((confirm, chairId) => unwrap(api.POST('/api/appointments', {
        body: {
          doctorId,
          patientId: p.id,
          startAt: startAt!,
          durationMinutes: duration,
          serviceTypeId: serviceId === '' ? undefined : serviceId,
          serviceTypeIds: serviceIds.length > 1 ? serviceIds : undefined,
          comment: comment.trim() || undefined,
          promoCode: promoCode || undefined,
          confirmChairTime: confirm || undefined,
          fromWaitlistId: waitlistId(p),
          chairId: chairId ?? chair.picked,
        },
      })))
      // «Хочет раньше»: запись есть, а освободится время раньше — предложим (лист ожидания).
      // Запись уже создана — не проваливаем её, но и не молчим: скажем, что в лист не попал
      if (wantsEarlier) {
        await unwrap(api.POST('/api/waitlist', { body: { patientId: p.id, doctorId, durationMinutes: duration } })).catch((error: unknown) => {
          void notify(`Запись создана, но в лист ожидания пациент не попал${error instanceof Error && error.message ? `: ${error.message}` : ''}.`
            + ' Добавьте его из карточки приёма — «В лист ожидания».')
        })
      }
      return created
    },
    onSuccess: (a) => {
      // Новая запись — и в «Пациентах» (недавние, карточка, «Позвать на профосмотр»)
      refreshAppointmentData(client, ['patients', 'recall', ...(wantsEarlier || fromWaitlist ? ['waitlist'] : [])])
      onCreated(a, { walkIn })
    },
  })

  const submit = async (e: FormEvent, allowDuplicate = false) => {
    e.preventDefault()
    setProblem('')
    create.reset()
    if (!time) {
      setProblem('Выберите время')
      return
    }
    // Уже записан на этот день (строка «Уже записан на этот день» под именем) — переспросить: двойная запись чаще ошибка
    const same = patient && !walkIn ? activeUpcoming(card.data).find((a) => a.startAt.length > 0 && dateOfInstant(a.startAt) === date) : undefined
    if (same && !(await ask(`${patient!.fullName} уже записан на этот день: ${timeOf(same.startAt)}. Записать ещё одну запись?`, { ok: 'Записать ещё' }))) return
    let who = patient
    if (!who) {
      if (!adding) {
        setProblem('Выберите пациента или добавьте нового')
        return
      }
      try {
        who = await createPatient.mutateAsync({ allowDuplicate })
        setDuplicate(null)
      } catch (error) {
        // Номер уже есть — скорее всего, тот же человек: предлагаем выбрать его (D19 бэкенда)
        if (error instanceof ApiError && error.code === 'duplicate-patient') {
          setDuplicate((error.problem.patient as Patient | undefined) ?? null)
        }
        return
      }
      setPatient(who)
      setAdding(false)
    }
    create.mutate(who)
  }

  /**
   * Имя и номер из контакта (записная книжка, буфер, бот) → пациент. Номер ищем среди пациентов: тот же
   * номер и то же имя или единственный с этим номером — он; несколько (семья на одном номере) — список
   * найденных по номеру, выбрать; никого — «Новый пациент» с именем и номером. Номер — общим разбором
   * phoneFromText: «+996 555 12-34-56», «0555123456» → «555123456».
   * @return false — номера в тексте нет
   */
  const applyContact = async (contactName: string, raw: string): Promise<boolean> => {
    const number = phoneFromText(raw)
    if (!number) return false
    const list = await unwrap(api.POST('/api/patients/search', { body: { query: number } })).catch(() => [] as Patient[])
    const lower = contactName.trim().toLowerCase()
    const same = (lower ? list.find((p) => p.fullName?.toLowerCase() === lower) : undefined) ?? (list.length === 1 ? list[0] : undefined)
    if (same) {
      setPatient(same)
      setAdding(false)
      return true
    }
    if (list.length > 1) {
      setAdding(false)
      setQuery(number)
      return true
    }
    setAdding(true)
    setDuplicate(null)
    // Имени в контакте нет — введённое не стираем
    setName((n) => contactName.trim() || n)
    setPhone(number)
    return true
  }

  // Контакт из бота — один раз при открытии формы
  const contactApplied = useRef(false)
  useEffect(() => {
    if (!initialContact || !initialContact.phone || contactApplied.current) return
    contactApplied.current = true
    void applyContact(initialContact.fullName, initialContact.phone.startsWith('+') ? initialContact.phone : `+${initialContact.phone}`)
    // Только при открытии: дальше форма — в руках сотрудника
  }, [initialContact])

  // «＋ Новый пациент»: что ввели в поиск — подставим (номер — в телефон, иначе — в имя)
  const startAdding = () => {
    if (adding) return
    setAdding(true)
    const number = query.replace(/\D/g, '').length >= 9 ? phoneFromText(query) : null
    if (number) setPhone(number)
    else if (query.trim()) setName(query.trim())
  }

  const fieldError = (field: string) =>
    create.error?.fieldErrors[field] ?? createPatient.error?.fieldErrors[field]
  const error = problem
    || (create.error && !create.error.fieldErrors.startAt && (walkIn || create.error.code !== 'time-taken') && create.error.message)
    || (createPatient.error && !Object.keys(createPatient.error.fieldErrors).length && createPatient.error.code !== 'duplicate-patient'
      && createPatient.error.message)
  const busy = create.isPending || createPatient.isPending
  const offeredCodes = (promoCodes.data ?? []).filter((p) => p.active !== false && !expired(p, todayIn()))
  const durationField = <DurationField value={duration} onChange={setDuration} />
  // Услуги выбранного врача (выбраны у него — только они, иначе все услуги клиники)
  const activeServices = servicesOfDoctor(services.data ?? [], me.doctorServices, doctorId)
  // Врач сменился (и нажатием в другую колонку), а выбранную услугу он не оказывает — снять выбор
  if (services.data && serviceIds.some((id) => !activeServices.some((sv) => sv.id === id))) {
    setServiceIds(serviceIds.filter((id) => activeServices.some((sv) => sv.id === id)))
  }
  const picked = serviceIds.map((id) => activeServices.find((sv) => sv.id === id)).filter((sv): sv is Service => sv != null)
  // Подсказка суммы — сумма цен «от» выбранных услуг (итог считает сервер в «Оплате»)
  const pricedTotal = picked.some((sv) => sv.priceSom) ? picked.reduce((sum, sv) => sum + (sv.priceSom ?? 0), 0) : null
  // Услуги — одним полем с поиском (ServicePicker, 2026-11-20): несколько — чипами с ✕ и «＋ Ещё услуга…»
  const pickServices = (next: number[]) => {
    touch('service')
    const added = next.length > serviceIds.length
    setServiceIds(next)
    // Длительность — сумма длительностей услуг (дальше её можно поправить), до 8 часов
    const minutes = next.map((id) => activeServices.find((sv) => sv.id === id)?.durationMinutes ?? 0).reduce((a, b) => a + b, 0)
    if (minutes > 0) setDuration(Math.min(minutes, 480))
    // Первую услугу выбрали — дальше время (на телефоне сам прокрутим к нему)
    if (added && next.length === 1) reveal(walkIn ? submitRef.current : timeRef.current, walkIn)
  }

  /** «⚡ Сейчас» — включить: сегодня, эта минута, врач по умолчанию; ещё раз — обратно к выбору времени. */
  const toggleNow = () => {
    touch('time')
    if (walkIn) {
      setWalkIn(false)
      setTime('')
      return
    }
    setWalkIn(true)
    setDate(todayIn())
    setTime(timeText(nowMinutes5()))
    // Врача, которого уже выбрали в форме, не меняем: «Сейчас» — только про время. Врач по умолчанию — если форма
    // открыта без врача
    if (doctorId == null && nowDoctorId != null && doctors.some((d) => d.id === nowDoctorId)) setDoctorId(nowDoctorId)
  }

  const doctorFull = doctors.find((d) => d.id === doctorId)?.fullName
  // Итог записи — в шапке и на кнопке: «13:00 · пт 20 нояб · Айгерим Садыкова», «Записать · пт 20 нояб, 13:00»
  const when = `${shortDay(date)}, ${time}`
  const pickDoctor = (id: number) => {
    touch('doctor')
    setDoctorId(id)
  }

  return (
    <aside className="panel new-appt" aria-label="Новая запись">
      <header className="panel-head">
        <div>
          <div className="with-hint"><h2>Новая запись</h2><HelpHint hint="newAppointment" /></div>
          <span className="hint new-appt-where">{[time, shortDay(date), doctors.length > 1 ? doctorFull : null].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={(e) => void submit(e)} data-advance onKeyDown={advanceOnEnter}>
        <fieldset className="field">
          <legend>Пациент</legend>
          {/* Два пути явно: уже есть в «Пациентах» — найти; впервые — завести с номером */}
          {!patient && (
            <div className="segments patient-mode" role="group" aria-label="Пациент">
              <button type="button" aria-pressed={!adding} onClick={() => { setAdding(false); createPatient.reset() }}>🔍 Из пациентов</button>
              <button type="button" aria-pressed={adding} onClick={startAdding}>＋ Новый пациент</button>
            </div>
          )}
          {patient ? (
            <>
              <div className="chosen">
                {/* Номер — своей строкой, без «·»: на телефоне он переносится, и точка висела в конце имени */}
                <span className="chosen-who"><strong>{patient.fullName}</strong>
                  {patient.phone && <span className="hint nowrap num">{formatPhone(patient.phone)}</span>}
                  {waitlistId(patient) != null && <span className="hint small">из листа ожидания — после записи уберём из листа</span>}</span>
                <button type="button" className="btn ghost small" onClick={() => setPatient(null)}>Другой</button>
              </div>
              {/* Уже записан (на этот день — предупреждение), долг, ⚠ аллергия, когда был */}
              {patient.id != null && <BookingContext patientId={patient.id} me={me} date={date} onOpenAppointment={onOpenAppointment} />}
            </>
          ) : adding ? (
            <>
              {/* key: иначе React взял бы <input> поиска и поменял ему свойства — autoFocus срабатывает только
                  у нового поля, и на телефоне после «＋ Новый пациент» курсора в имени не было */}
              <input key="name" aria-label="Имя и фамилия" placeholder="Имя и фамилия" value={name} required autoFocus enterKeyHint="next"
                onChange={(e) => setName(e.target.value)} />
              {fieldError('fullName') && <p className="error">{fieldError('fullName')}</p>}
              <PhoneInput label="Телефон" value={phone} onChange={(v) => { setPhone(v); setDuplicate(null) }} />
              {fieldError('phone') && <p className="error">{fieldError('phone')}</p>}
              {/* Номер — из записной книжки или буфера, как у поиска: уже есть такой пациент — выберем его */}
              <ContactPick onContact={applyContact} />
              <label className="field"><span>Дата рождения (необязательно)</span>
                <DateInput birth min="1900-01-01" max={todayIn()} value={birthDate} placeholder="Не указана" onChange={(e) => setBirthDate(e.target.value)} /></label>
              {fieldError('birthDate') && <p className="error">{fieldError('birthDate')}</p>}
              <label className="field"><span>Откуда узнал о клинике (необязательно)</span>
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Не указано</option>
                  {sourceChoices(sources.data).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select></label>
              {createPatient.error?.code === 'duplicate-patient' && (
                <div className="duplicate" role="alert">
                  <p>{createPatient.error.message}{duplicate ? `: ${duplicate.fullName}` : ''}</p>
                  {duplicate && (
                    <button type="button" className="btn small" onClick={() => { setPatient(duplicate); setAdding(false); createPatient.reset() }}>
                      Выбрать его
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={(e) => void submit(e, true)}>Это другой человек</button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Подсказка «начните вводить имя…» не нужна: её говорят плейсхолдер и сегменты над полем */}
              <input key="search" type="search" aria-label="Найти пациента" placeholder="Имя или номер" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onPaste={(e) => {
                  // Вставили номер (скопированный в Контактах, с именем или без) — как «📋 Вставить номер»
                  const text = e.clipboardData?.getData('text') ?? ''
                  if (!phoneFromText(text)) return
                  e.preventDefault()
                  void applyContact(nameFromText(text), text)
                }} />
              {found.data && found.data.length > 0 && search.length >= 2 && (
                <ul className="found" aria-label="Найденные пациенты">
                  {found.data.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)}>
                        <strong>{p.fullName}</strong>
                        {/* Тёзок различают возраст, последний визит и представитель ребёнка */}
                        <span className="hint found-meta">{foundMeta(p, lastVisitOf(p.id))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* Ничего не ввели — недавние: чаще всего записывают того, кто только что звонил или был */}
              {search.length < 2 && (recent.data?.length ?? 0) > 0 && (
                <ul className="found recent" aria-label="Недавние пациенты">
                  {recent.data!.slice(0, RECENT).map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setPatient({ id: r.id, fullName: r.fullName ?? '', phone: r.phone, telegram: r.telegram })}>
                        <strong>{r.fullName}</strong>
                        <span className="hint found-meta">{[r.phone ? formatPhone(r.phone) : null, r.lastVisit ? `был ${shortDate(r.lastVisit, true).replace(/,.*$/, '')}` : null].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.data?.length === 0 && <p className="hint small">Не нашли «{search}» — значит, пациент новый: «＋ Новый пациент» выше</p>}
              <ContactPick onContact={applyContact} />
            </>
          )}
        </fieldset>

        {activeServices.length > 0 && (
          <label className="field"><span>Услуга</span>
            <ServicePicker multiple aria-label="Услуга" services={activeServices} values={serviceIds} prices={!isAssistant(me)}
              placeholder="Выберите услугу…" onChange={pickServices} />
            {picked.length > 1 && (
              <span className="hint small" data-testid="services-sum">
                {picked.length} услуги · {durationText(picked.reduce((m, sv) => m + (sv.durationMinutes ?? 0), 0))}
                {pricedTotal != null && !isAssistant(me) ? ` · от ${somText(pricedTotal)}` : ''}
              </span>
            )}
          </label>
        )}
        {/* Врач — до дня и времени: свободное время зависит от врача (UX-аудит 2026-11-20) */}
        {/* До шести врачей — чипами (одно касание на телефоне), больше — списком */}
        {doctors.length <= DOCTOR_CHIPS ? (
          <div className="field"><span>Врач</span>
            <div className="price-hints doctor-pick" role="group" aria-label="Врач">
              {doctors.map((d) => (
                <button key={d.id} type="button" className="chip" aria-pressed={d.id === doctorId} title={d.fullName}
                  onClick={() => pickDoctor(d.id)}>{shortName(d.fullName ?? '')}</button>
              ))}
            </div>
          </div>
        ) : (
          <label className="field">
            <span>Врач</span>
            <Select value={doctorId} onChange={(e) => pickDoctor(Number(e.target.value))}>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </Select>
          </label>
        )}
        {/* Пришёл без записи — чипом «⚡ Сейчас» в строке «Когда»: сегодня, эта минута, врач по умолчанию */}
        <div className="field now-pick">
          <span>Когда</span>
          <div className="price-hints" role="group" aria-label="Когда">
            <button type="button" className="chip" aria-pressed={walkIn} onClick={toggleNow}>⚡ Сейчас</button>
          </div>
          <HelpHint title="Сейчас">Пациент пришёл без записи: приём с этой минуты, без сетки свободного времени и напоминаний.</HelpHint>
        </div>
        {walkIn ? (
          <div className="row">
            <label className="field"><span>Время</span>
              <TimeInput value={time} required onChange={(t) => { touch('time'); setTime(t) }} /></label>
            {durationField}
          </div>
        ) : (
          <div className="row">
            <label className="field"><span>День</span>
              <DateInput weekday value={date} required marks={freeDays} onMonthView={setCalMonth}
                onChange={(e) => { touch('time'); setDate(e.target.value); setTime('') }} /></label>
            {durationField}
          </div>
        )}

        {!walkIn && (
          <div ref={timeRef}><TimePicker key={`${date}-${doctorId}`} date={date} doctorId={doctorId} duration={duration} value={time}
            onChange={(t) => { touch('time'); setTime(t); if (t) reveal(submitRef.current, true) }} error={fieldError('startAt') ?? (create.error?.code === 'time-taken' ? create.error.message : null)} /></div>
        )}
        {walkIn && fieldError('startAt') && <p className="error">{fieldError('startAt')}</p>}
        {/* Кресло врача в это время занято (приёмом или часами коллеги) — короткий блок «Свободно: [Кресло 2]»; конфликта
            нет — ничего. Ответ сервера о кресле уже на экране — блока нет */}
        {startAt && <ChairTimeHint doctorId={doctorId} startAt={startAt} duration={duration} chairId={chair.checkId} multi={chair.multi}
          picked={chair.picked} onPickChair={chair.pick} onReset={chair.reset}
          action={walkIn ? 'Начать приём' : 'Записать'} hidden={isChairError(create.error)} />}

        {/* Кто из листа ожидания помещается в это свободное окно — только пока пациент не выбран; никого — блока нет */}
        {!walkIn && !patient && startAt && <WaitlistCandidates doctorId={doctorId} startAt={startAt} onPick={pickWaiting} onBooked={onCreated} />}

        <label className="field">
          <span>Комментарий (необязательно)</span>
          <textarea rows={2} maxLength={500} placeholder="Например: болит справа внизу, придёт с ребёнком" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {/* Редкое — свёрнуто в «Ещё»: промокод из рекламы и «Хочет раньше» (лист ожидания). Что выбрано — видно в заголовке */}
        {(offeredCodes.length > 0 || !walkIn) && (
          <Fold title="Ещё" label="Ещё: промокод, лист ожидания"
            meta={[promoCode ? `🎟 ${promoCode}` : null, wantsEarlier && !walkIn ? 'хочет раньше' : null].filter(Boolean).join(' · ')
              || [offeredCodes.length > 0 ? 'промокод' : null, !walkIn ? 'хочет раньше' : null].filter(Boolean).join(', ')}>
            <div className="rare">
              {/* Пациент назвал промокод из рекламы по телефону: выбор из действующих кодов клиники */}
              {offeredCodes.length > 0 && (
                <label className="field"><span>Промокод</span>
                  <Select value={promoCode} onChange={(e) => setPromoCode(e.target.value)}>
                    <option value="">Без промокода</option>
                    {offeredCodes.map((p) => <option key={p.id} value={p.code}>{`🎟 ${p.code}${p.description ? ` · ${p.description}` : ''}`}</option>)}
                  </Select>
                </label>
              )}
              {!walkIn && (
                <label className="check">
                  <input type="checkbox" checked={wantsEarlier} onChange={(e) => setWantsEarlier(e.target.checked)} />
                  Хочет раньше — в лист ожидания: освободится время, предложим
                </label>
              )}
            </div>
          </Fold>
        )}
        {/* Кнопка прилипает к низу панели (и на компьютере 1440×900, и на телефоне) и называет итог */}
        <div className="new-appt-bar">
          {error && <p className="error" role="alert">{error}</p>}
          <button ref={submitRef} type="submit" className="btn primary" disabled={busy}>
            {busy ? <><Spinner />Записываем…</> : walkIn ? 'Начать приём' : <>Записать{time && <>{' · '}<span className="new-appt-when">{when}</span></>}</>}
          </button>
        </div>
      </form>
    </aside>
  )
}

type WaitlistEntry = Schemas['WaitlistView']

/**
 * «Подходит из листа ожидания» — нажали на свободное окно, а его ждут. «Записать сюда» выбирает
 * пациента в форме и ставит его длительность; дальше обычное «Записать» — сервер уберёт его из листа
 * (fromWaitlistId). Уже записан позже — «Перенести сюда»: сервер перенесёт ту запись, а не сделает
 * вторую. WhatsApp — «освободилось время».
 */
function WaitlistCandidates({ doctorId, startAt, onPick, onBooked }: {
  doctorId: number
  startAt: string
  onPick: (e: WaitlistEntry) => void
  onBooked: (a: Appointment) => void
}) {
  const client = useQueryClient()
  const list = useWaitlist()
  const settings = useSettings()
  // Кто подходит — считает сервер (шаг 6Б): врач, длительность в свободном окне, «Когда удобно» пациента (часы, дни
  // недели, даты по Бишкеку) и уже записан — только раньше. Строки — из листа (там «записан на …» для «Перенести сюда»)
  const fitting = useQuery({
    queryKey: ['waitlist-fits', doctorId, startAt],
    queryFn: () => unwrap(api.GET('/api/waitlist/fits', { params: { query: { doctorId, startAt } } })),
    enabled: Boolean(list.data?.length),
  })
  const move = useMutation<Appointment, ApiError, WaitlistEntry>({
    mutationFn: (e) => withChairConfirm((confirm, chairId) => unwrap(api.POST('/api/waitlist/{id}/book',
      { params: { path: { id: e.id } }, body: { doctorId, startAt, confirmChairTime: confirm || undefined, chairId } }))),
    onSuccess: (a) => {
      // Перенесли — окна, счётчики и карточка пациента тоже меняются
      refreshAppointmentData(client, ['waitlist', 'patients', 'recall'])
      onBooked(a)
    },
  })
  const ids = new Set((fitting.data ?? []).map((m) => m.entryId))
  const fits = (list.data ?? []).filter((e) => ids.has(e.id))
  if (!fits.length) return null
  return (
    <section className="candidates" aria-label="Подходит из листа ожидания">
      <h3>Подходит из листа ожидания</h3>
      {fits.map((e) => (
        <div key={e.id} className="candidate">
          <span className="candidate-who">
            <strong>{e.patient?.fullName}</strong>
            <span className="hint small">{e.durationMinutes} мин · {e.upcoming?.startAt ? `записан на ${shortDate(e.upcoming.startAt, true)}` : 'без записи'}</span>
          </span>
          <span className="actions">
            <button type="button" className="btn small" disabled={!settings.data}
              onClick={() => openLink(whatsappUrl(e.patient?.phone ?? '', freeSlotText(e.patient?.fullName ?? '', startAt, settings.data?.clinicSignature)))}>WhatsApp</button>
            {e.upcoming ? (
              <button type="button" className="btn small primary" disabled={move.isPending} onClick={() => move.mutate(e)}>Перенести сюда</button>
            ) : (
              <button type="button" className="btn small primary" onClick={() => onPick(e)}>Записать сюда</button>
            )}
          </span>
        </div>
      ))}
      {move.error && <p className="error">{move.error.message}</p>}
    </section>
  )
}
