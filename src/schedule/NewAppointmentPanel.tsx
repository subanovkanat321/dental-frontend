import { advanceOnEnter, reveal } from '../lib/advance'
import { notify } from '../lib/confirm'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings, useWaitlist } from '../api/settings'
import { useClose } from '../lib/useClose'
import { freeSlotText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { dayTitle, formatPhone, nowMinutes5, shortDate, slotInstant, todayIn } from '../lib/time'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { serviceEmoji } from '../lib/serviceEmoji'
import { servicesOfDoctor } from '../lib/doctorServices'
import { sourceChoices, useSources } from '../lib/sources'
import { expired, usePromoCodes } from '../lib/promo'
import { withChairConfirm } from './chairTime'
import { ChairTimeHint } from './ChairTimeHint'
import { DurationField } from './DurationField'
import { TimePicker } from './TimePicker'
import { refreshAppointmentData } from './useAppointmentAction'
import { editableDoctors } from '../lib/roles'
import { DateInput } from '../layout/DateInput'
import { TimeInput } from '../layout/TimeInput'
import { Select } from '../layout/Select'
import { useDebounced } from '../lib/useDebounced'
import { serviceOptions, usePopularServices } from '../clinic/serviceOptions'
import { Spinner } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']
type Service = Schemas['ServiceTypeView']

/** Слот, на который нажали: врач, день и минуты от полуночи по Бишкеку. */
/**
 * Куда записать; duration — длительность по умолчанию («Записать снова» — как прошлый приём).
 * minutes: null — время не выбрано: в форме сетка свободного времени.
 */
/** serviceId — услуга сразу выбрана («Записать» из «Позвать снова → Отменили»). */
export type Slot = { doctorId: number; date: string; minutes: number | null; duration?: number; serviceId?: number }

type ContactsNavigator = Navigator & { contacts?: { select: (props: string[]) => Promise<{ name?: string[]; tel?: string[] }[]> } }
const contactsSupported = () => typeof navigator !== 'undefined' && 'contacts' in navigator

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
export function NewAppointmentPanel({ slot, me, initialPatient = null, nowDoctorId, onClose, onCreated }: {
  slot: Slot
  me: Me
  /** К кому «⚡ Сейчас»: выбранный в расписании врач, иначе свой, иначе первый доступный. Нет — врач формы. */
  nowDoctorId?: number
  /** Пациент уже выбран — «Записать» из его карточки в «Пациентах». */
  initialPatient?: Patient | null
  onClose: () => void
  onCreated: (a: Appointment) => void
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
  const [serviceId, setServiceId] = useState<number | ''>(slot.serviceId ?? '')
  const timeRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [comment, setComment] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const promoCodes = usePromoCodes()
  const [patient, setPatient] = useState<Patient | null>(initialPatient)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [duplicate, setDuplicate] = useState<Patient | null>(null)
  const [problem, setProblem] = useState('')
  // «Записать сюда» в подсказке листа ожидания: после записи сервер уберёт эту строку листа
  const [fromWaitlist, setFromWaitlist] = useState<WaitlistEntry | null>(null)

  // Новый слот (нажали в другое место) — новое время и врач, введённое о пациенте остаётся.
  // Меняем состояние прямо при отрисовке, а не в эффекте: React перерисует сразу, без мигания
  const [shown, setShown] = useState(slot)
  if (shown !== slot) {
    setShown(slot)
    setDoctorId(slot.doctorId)
    setDate(slot.date)
    setTime(initialTime(slot))
    setWalkIn(false)
  }

  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    select: (list) => list.filter((s) => s.active !== false),
  })

  const search = useDebounced(query.trim())
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && !patient,
  })

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

  const create = useMutation<Appointment, ApiError, Patient>({
    mutationFn: async (p) => {
      // В часы коллеги по креслу (V187) сервер спросит «Коллега предупреждён?» — «Записать» повторит с подтверждением
      const created = await withChairConfirm((confirm) => unwrap(api.POST('/api/appointments', {
        body: {
          doctorId,
          patientId: p.id!,
          startAt: startAt!,
          durationMinutes: duration,
          serviceTypeId: serviceId === '' ? undefined : serviceId,
          comment: comment.trim() || undefined,
          promoCode: promoCode || undefined,
          confirmChairTime: confirm || undefined,
          fromWaitlistId: waitlistId(p),
        },
      })))
      // «Хочет раньше»: запись есть, а освободится время раньше — предложим (лист ожидания).
      // Запись уже создана — не проваливаем её, но и не молчим: скажем, что в лист не попал
      if (wantsEarlier) {
        await unwrap(api.POST('/api/waitlist', { body: { patientId: p.id!, doctorId, durationMinutes: duration } })).catch((error: unknown) => {
          void notify(`Запись создана, но в лист ожидания пациент не попал${error instanceof Error && error.message ? `: ${error.message}` : ''}.`
            + ' Добавьте его из карточки приёма — «В лист ожидания».')
        })
      }
      return created
    },
    onSuccess: (a) => {
      // Новая запись — и в «Пациентах» (недавние, карточка, «Позвать на профосмотр»)
      refreshAppointmentData(client, ['patients', 'recall', ...(wantsEarlier || fromWaitlist ? ['waitlist'] : [])])
      onCreated(a)
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
   * Записная книжка телефона (Contact Picker API — Chrome на Android): номер ищем среди пациентов;
   * нашёлся один — он, нет — «Новый пациент» с именем и номером из контакта.
   */
  const pickContact = async () => {
    let contact: { name?: string[]; tel?: string[] } | undefined
    try {
      [contact] = await (navigator as ContactsNavigator).contacts!.select(['name', 'tel'])
    } catch {
      return
    }
    const tel = contact?.tel?.[0]
    if (!tel) return
    const contactName = contact?.name?.[0] ?? ''
    const list = await unwrap(api.POST('/api/patients/search', { body: { query: tel } })).catch(() => [] as Patient[])
    const same = list.find((p) => p.fullName?.toLowerCase() === contactName.toLowerCase()) ?? (list.length === 1 ? list[0] : undefined)
    if (same) {
      setPatient(same)
      return
    }
    setAdding(true)
    setName(contactName)
    setPhone(tel.replace(/\D/g, '').slice(-9))
  }

  // «＋ Новый пациент»: что ввели в поиск — подставим (номер — в телефон, иначе — в имя)
  const startAdding = () => {
    if (adding) return
    setAdding(true)
    const digits = query.replace(/\D/g, '')
    if (digits.length >= 9) setPhone(digits.slice(-9))
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
  if (serviceId !== '' && services.data && !activeServices.some((sv) => sv.id === serviceId)) setServiceId('')
  // Много услуг — кнопками только частые (и выбранная), остальные — списком с поиском и разделами
  const many = activeServices.length > 8
  const popularIds = usePopularServices(many)
  const chipServices = many
    ? activeServices.filter((sv) => popularIds.slice(0, 5).includes(sv.id!) || sv.id === serviceId)
    : activeServices
  const pickService = (sv: Service | undefined) => {
    const next = !sv || sv.id === serviceId ? '' : sv.id!
    setServiceId(next)
    if (sv && next !== '' && sv.durationMinutes) setDuration(sv.durationMinutes)
    // Выбрали услугу — дальше время (на телефоне сам прокрутим к нему)
    if (next !== '') reveal(walkIn ? submitRef.current : timeRef.current, walkIn)
  }

  /** «⚡ Сейчас» — включить: сегодня, эта минута, врач по умолчанию; ещё раз — обратно к выбору времени. */
  const toggleNow = () => {
    if (walkIn) {
      setWalkIn(false)
      setTime('')
      return
    }
    setWalkIn(true)
    setDate(todayIn())
    setTime(timeText(nowMinutes5()))
    if (nowDoctorId != null && doctors.some((d) => d.id === nowDoctorId)) setDoctorId(nowDoctorId)
  }

  return (
    <aside className="panel" aria-label="Новая запись">
      <header className="panel-head">
        <div>
          <div className="with-hint"><h2>Новая запись</h2><HelpHint hint="newAppointment" /></div>
          <span className="hint">{dayTitle(date)}</span>
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
            <div className="chosen">
              <span><strong>{patient.fullName}</strong>{patient.phone && <span className="hint"> · {formatPhone(patient.phone)}</span>}
                {waitlistId(patient) != null && <span className="hint small"> · из листа ожидания — после записи уберём из листа</span>}</span>
              <button type="button" className="btn ghost small" onClick={() => setPatient(null)}>Другой</button>
            </div>
          ) : adding ? (
            <>
              {/* key: иначе React взял бы <input> поиска и поменял ему свойства — autoFocus срабатывает только
                  у нового поля, и на телефоне после «＋ Новый пациент» курсора в имени не было */}
              <input key="name" aria-label="Имя и фамилия" placeholder="Имя и фамилия" value={name} required autoFocus enterKeyHint="next"
                onChange={(e) => setName(e.target.value)} />
              {fieldError('fullName') && <p className="error">{fieldError('fullName')}</p>}
              <PhoneInput label="Телефон" value={phone} onChange={(v) => { setPhone(v); setDuplicate(null) }} />
              {fieldError('phone') && <p className="error">{fieldError('phone')}</p>}
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
              <input key="search" type="search" aria-label="Найти пациента" placeholder="Имя или номер" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)} />
              {!search && <p className="hint small">Пациент уже был в клинике — начните вводить имя или номер. Впервые — «＋ Новый пациент».</p>}
              {found.data && found.data.length > 0 && (
                <ul className="found" aria-label="Найденные пациенты">
                  {found.data.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)}>
                        <strong>{p.fullName}</strong>{p.phone && <span className="hint"> · {formatPhone(p.phone)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.data?.length === 0 && <p className="hint small">Не нашли «{search}» — значит, пациент новый: «＋ Новый пациент» выше</p>}
              {contactsSupported() && <button type="button" className="link" onClick={() => void pickContact()}>📇 Из контактов телефона</button>}
            </>
          )}
        </fieldset>

        {activeServices.length > 0 && (
          <div className="field"><span>Услуга (необязательно) — длительность подставится сама</span>
            {chipServices.length > 0 && (
              <div className="price-hints" role="group" aria-label={many ? 'Частые услуги' : 'Услуга'}>
                {chipServices.map((sv) => (
                  <button key={sv.id} type="button" className="chip" aria-pressed={sv.id === serviceId} onClick={() => pickService(sv)}>
                    <span aria-hidden="true">{serviceEmoji(sv.name)} </span>{sv.name}<span className="hint"> · {sv.durationMinutes} мин</span></button>
                ))}
              </div>
            )}
            {many && (
              <Select collapsible aria-label="Все услуги" value={serviceId} onChange={(e) => pickService(activeServices.find((sv) => String(sv.id) === e.target.value))}>
                <option value="">{serviceId === '' ? 'Найти услугу…' : 'Без услуги'}</option>
                {serviceOptions(activeServices, popularIds, (sv) => `${sv.name} · ${sv.durationMinutes} мин`)}
              </Select>
            )}
          </div>
        )}
        {/* Пришёл без записи — одним нажатием: сегодня, сейчас, врач по умолчанию */}
        <div className="field now-pick">
          <div className="price-hints" role="group" aria-label="Когда">
            <button type="button" className="chip" aria-pressed={walkIn} onClick={toggleNow}>⚡ Сейчас</button>
          </div>
          <span className="hint small">{walkIn ? 'Пациент пришёл без записи: приём с этой минуты, без напоминаний.' : 'Пришёл без записи — приём с этой минуты'}</span>
        </div>
        {walkIn ? (
          <div className="row">
            <label className="field"><span>Время</span>
              <TimeInput value={time} required onChange={setTime} /></label>
            {durationField}
          </div>
        ) : (
          <div className="row">
            <label className="field"><span>День</span>
              <DateInput weekday value={date} required onChange={(e) => { setDate(e.target.value); setTime('') }} /></label>
            {durationField}
          </div>
        )}
        <label className="field">
          <span>Врач</span>
          <Select value={doctorId} onChange={(e) => setDoctorId(Number(e.target.value))}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select>
        </label>

        {!walkIn && (
          <div ref={timeRef}><TimePicker key={`${date}-${doctorId}`} date={date} doctorId={doctorId} duration={duration} value={time}
            onChange={(t) => { setTime(t); if (t) reveal(submitRef.current, true) }} error={fieldError('startAt') ?? (create.error?.code === 'time-taken' ? create.error.message : null)} /></div>
        )}
        {walkIn && fieldError('startAt') && <p className="error">{fieldError('startAt')}</p>}
        {/* Выбрали время коллеги по общему креслу — сказать сразу, а не только окном после «Записать» */}
        {!walkIn && startAt && <ChairTimeHint doctorId={doctorId} startAt={startAt} duration={duration} />}

        {/* Кто из листа ожидания помещается в это свободное окно — только пока пациент не выбран; никого — блока нет */}
        {!walkIn && !patient && startAt && <WaitlistCandidates date={date} doctorId={doctorId} startAt={startAt} onPick={pickWaiting} onBooked={onCreated} />}

        <label className="field">
          <span>Комментарий (необязательно)</span>
          <textarea rows={2} maxLength={500} placeholder="Например: болит справа внизу, придёт с ребёнком" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {/* Пациент назвал промокод из рекламы по телефону: выбор из действующих кодов клиники */}
        {offeredCodes.length > 0 && (
          <label className="field"><span>Промокод (необязательно)</span>
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
        {error && <p className="error" role="alert">{error}</p>}
        <button ref={submitRef} type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Записываем…</> : walkIn ? 'Начать приём' : 'Записать'}</button>
      </form>
    </aside>
  )
}

type WaitlistEntry = Schemas['WaitlistView']

/** Конец свободного окна (/api/slots, free), в котором начинается приём; не в свободном окне — null. */
function windowEnd(free: Schemas['TimeRange'][] | undefined, startAt: string): string | null {
  const at = Date.parse(startAt)
  const w = (free ?? []).find((r) => Date.parse(r.start!) <= at && at < Date.parse(r.end!))
  return w?.end ?? null
}

/**
 * Помещается ли пациент из листа в окно [startAt, end) врача doctorId (как прежняя fits в «Дне»):
 * хочет к этому врачу или к любому; приём не длиннее окна; уже записан к этому врачу — окно раньше
 * его записи. Без записи («запишите, как появится место») — подходит в любое окно, где помещается.
 */
function fitsWindow(e: WaitlistEntry, doctorId: number, startAt: string, end: string): boolean {
  if (e.doctorId != null && e.doctorId !== doctorId) return false
  const sameDoctor = !e.upcoming || e.upcoming.doctorId === doctorId
  const earlier = !e.upcoming?.startAt || !sameDoctor || Date.parse(startAt) < Date.parse(e.upcoming.startAt)
  return earlier && (e.durationMinutes ?? 30) * 60_000 <= Date.parse(end) - Date.parse(startAt)
}

/**
 * «Подходит из листа ожидания» — нажали на свободное окно, а его ждут. «Записать сюда» выбирает
 * пациента в форме и ставит его длительность; дальше обычное «Записать» — сервер уберёт его из листа
 * (fromWaitlistId). Уже записан позже — «Перенести сюда»: сервер перенесёт ту запись, а не сделает
 * вторую. WhatsApp — «освободилось время».
 */
function WaitlistCandidates({ date, doctorId, startAt, onPick, onBooked }: {
  date: string
  doctorId: number
  startAt: string
  onPick: (e: WaitlistEntry) => void
  onBooked: (a: Appointment) => void
}) {
  const client = useQueryClient()
  const list = useWaitlist()
  const settings = useSettings()
  // Те же окна, что в «Дне» и сетке (тот же ключ — из кэша, без лишнего запроса)
  const slots = useQuery({
    queryKey: ['slots', date, doctorId],
    queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId } } })),
  })
  const move = useMutation<Appointment, ApiError, WaitlistEntry>({
    mutationFn: (e) => withChairConfirm((confirm) => unwrap(api.POST('/api/waitlist/{id}/book',
      { params: { path: { id: e.id! } }, body: { doctorId, startAt, confirmChairTime: confirm || undefined } }))),
    onSuccess: (a) => {
      // Перенесли — окна, счётчики и карточка пациента тоже меняются
      refreshAppointmentData(client, ['waitlist', 'patients', 'recall'])
      onBooked(a)
    },
  })
  const end = windowEnd(slots.data?.free, startAt)
  const fits = end ? (list.data ?? []).filter((e) => fitsWindow(e, doctorId, startAt, end)) : []
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
