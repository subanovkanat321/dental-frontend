import { advanceOnEnter, reveal } from '../lib/advance'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings, useWaitlist } from '../api/settings'
import { useClose } from '../lib/useClose'
import { freeSlotText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { dayTitle, formatPhone, shortDate, slotInstant, timeStep, todayIn } from '../lib/time'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { serviceEmoji } from '../lib/serviceEmoji'
import { servicesOfDoctor } from '../lib/doctorServices'
import { sourceChoices, useSources } from '../lib/sources'
import { expired, usePromoCodes } from '../lib/promo'
import { DurationField } from './DurationField'
import { TimePicker } from './TimePicker'
import { refreshAppointmentData } from './useAppointmentAction'
import { editableDoctors } from '../lib/roles'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Слот, на который нажали: врач, день и минуты от полуночи по Бишкеку. */
/**
 * Куда записать; duration — длительность по умолчанию («Записать снова» — как прошлый приём).
 * minutes: null — время не выбрано: в форме сетка свободного времени.
 */
export type Slot = { doctorId: number; date: string; minutes: number | null; duration?: number }

type ContactsNavigator = Navigator & { contacts?: { select: (props: string[]) => Promise<{ name?: string[]; tel?: string[] }[]> } }
const contactsSupported = () => typeof navigator !== 'undefined' && 'contacts' in navigator

function timeText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Время в форме для слота: не выбрано — пусто, в форме сетка свободного времени. */
function initialTime(slot: Slot): string {
  return slot.minutes == null ? '' : timeText(slot.minutes)
}

/** Пауза перед поиском: не дёргать сервер на каждую букву. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * «Новая запись» справа: нажали на пустое место в колонке врача — время уже стоит (кратно 15
 * минутам). Пациента — найти по имени или номеру, или завести нового (+996). Занятое время
 * не пустит база (appointment_no_overlap → 409): показываем её ответ.
 */
export function NewAppointmentPanel({ slot, me, initialPatient = null, walkIn = false, onClose, onCreated }: {
  slot: Slot
  me: Me
  /** «Принять сейчас (без записи)»: пациент пришёл сам — приём с этой минуты, без напоминаний. */
  walkIn?: boolean
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
  const [birthDate, setBirthDate] = useState('')
  const [source, setSource] = useState('')
  const sources = useSources()
  const [wantsEarlier, setWantsEarlier] = useState(false)
  const [allServices, setAllServices] = useState(false)
  const [duration, setDuration] = useState(slot.duration ?? 30)
  const [serviceId, setServiceId] = useState<number | ''>('')
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

  // Новый слот (нажали в другое место) — новое время и врач, введённое о пациенте остаётся.
  // Меняем состояние прямо при отрисовке, а не в эффекте: React перерисует сразу, без мигания
  const [shown, setShown] = useState(slot)
  if (shown !== slot) {
    setShown(slot)
    setDoctorId(slot.doctorId)
    setDate(slot.date)
    setTime(initialTime(slot))
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

  const [hh, mm] = time.split(':').map(Number)
  const startAt = time ? slotInstant(date, (hh ?? 0) * 60 + (mm ?? 0)) : null

  const create = useMutation<Appointment, ApiError, Patient>({
    mutationFn: async (p) => {
      const created = await unwrap(api.POST('/api/appointments', {
        body: {
          doctorId,
          patientId: p.id!,
          startAt: startAt!,
          durationMinutes: duration,
          serviceTypeId: serviceId === '' ? undefined : serviceId,
          comment: comment.trim() || undefined,
          promoCode: promoCode || undefined,
        },
      }))
      // «Хочет раньше»: запись есть, а освободится время раньше — предложим (лист ожидания).
      // Запись уже создана — не проваливаем её, но и не молчим: скажем, что в лист не попал
      if (wantsEarlier) {
        await unwrap(api.POST('/api/waitlist', { body: { patientId: p.id!, doctorId, durationMinutes: duration } })).catch((error: unknown) => {
          window.alert(`Запись создана, но в лист ожидания пациент не попал${error instanceof Error && error.message ? `: ${error.message}` : ''}.`
            + ' Добавьте его из карточки приёма — «В лист ожидания».')
        })
      }
      return created
    },
    onSuccess: (a) => {
      // Новая запись — и в «Пациентах» (недавние, карточка, «Позвать на профосмотр»)
      refreshAppointmentData(client, ['patients', 'recall', ...(wantsEarlier ? ['waitlist'] : [])])
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
  const shownServices = allServices ? activeServices : activeServices.filter((sv, i) => i < 8 || sv.id === serviceId)

  return (
    <aside className="panel" aria-label={walkIn ? 'Принять сейчас' : 'Новая запись'}>
      <header className="panel-head">
        <div>
          <h2>{walkIn ? 'Принять сейчас' : 'Новая запись'}</h2>
          {walkIn && <p className="hint">Пациент пришёл без записи: приём с этой минуты, без напоминаний.</p>}
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
              <span><strong>{patient.fullName}</strong>{patient.phone && <span className="hint"> · {formatPhone(patient.phone)}</span>}</span>
              <button type="button" className="btn ghost small" onClick={() => setPatient(null)}>Другой</button>
            </div>
          ) : adding ? (
            <>
              <input aria-label="Имя и фамилия" placeholder="Имя и фамилия" value={name} required autoFocus enterKeyHint="next"
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
              <input type="search" aria-label="Найти пациента" placeholder="Имя или номер" value={query} autoFocus
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
            <div className="price-hints" role="group" aria-label="Услуга">
              {shownServices.map((sv) => (
                <button key={sv.id} type="button" className="chip" aria-pressed={sv.id === serviceId} onClick={() => {
                  const next = sv.id === serviceId ? '' : sv.id!
                  setServiceId(next)
                  if (next !== '' && sv.durationMinutes) setDuration(sv.durationMinutes)
                  // Выбрали услугу — дальше время (на телефоне сам прокрутим к нему)
                  if (next !== '') reveal(walkIn ? submitRef.current : timeRef.current, walkIn)
                }}><span aria-hidden="true">{serviceEmoji(sv.name)} </span>{sv.name}<span className="hint"> · {sv.durationMinutes} мин</span></button>
              ))}
              {shownServices.length < activeServices.length && (
                <button type="button" className="chip more" onClick={() => setAllServices(true)}>Ещё {activeServices.length - shownServices.length}…</button>
              )}
            </div>
          </div>
        )}
        {walkIn ? (
          <div className="row">
            <label className="field"><span>Время</span>
              <input type="time" step={timeStep(time)} value={time} required onChange={(e) => setTime(e.target.value)} /></label>
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

        <WaitlistCandidates doctorId={doctorId} duration={duration} startAt={startAt} onBooked={onCreated} />


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
        <button ref={submitRef} type="submit" className="btn primary" disabled={busy}>{busy ? 'Записываем…' : walkIn ? 'Начать приём' : 'Записать'}</button>
      </form>
    </aside>
  )
}

type WaitlistEntry = Schemas['WaitlistView']

/**
 * Лист ожидания для этого окна (как fitsWindow в приложении): к этому врачу или к любому,
 * помещается по длительности и, если уже записан к этому врачу, окно раньше его записи.
 * WhatsApp — «освободилось время»; «Записать сюда» — сервер запишет (или перенесёт) и уберёт из листа.
 */
function WaitlistCandidates({ doctorId, duration, startAt, onBooked }: {
  doctorId: number
  duration: number
  startAt: string | null
  onBooked: (a: Appointment) => void
}) {
  const client = useQueryClient()
  const list = useWaitlist()
  const settings = useSettings()
  const book = useMutation<Appointment, ApiError, WaitlistEntry>({
    mutationFn: (e) => unwrap(api.POST('/api/waitlist/{id}/book', { params: { path: { id: e.id! } }, body: { doctorId, startAt: startAt! } })),
    onSuccess: (a) => {
      // Записали или перенесли — окна, счётчики и карточка пациента тоже меняются
      refreshAppointmentData(client, ['waitlist', 'patients', 'recall'])
      onBooked(a)
    },
  })
  if (!startAt) return null
  const fits = (list.data ?? []).filter((e) => {
    if (e.doctorId != null && e.doctorId !== doctorId) return false
    const sameDoctor = !e.upcoming || e.upcoming.doctorId === doctorId
    const earlier = !e.upcoming || !sameDoctor || startAt < (e.upcoming.startAt ?? '')
    return earlier && (e.durationMinutes ?? 30) <= duration
  })
  if (!fits.length) return null
  return (
    <section className="candidates" aria-label="Ждут свободного времени">
      <h3>Ждут свободного времени</h3>
      {fits.map((e) => (
        <div key={e.id} className="candidate">
          <span>
            <strong>{e.patient?.fullName}</strong>
            <span className="hint small"> · {e.upcoming?.startAt ? `сейчас ${shortDate(e.upcoming.startAt, true)}` : 'записи нет'} · {e.durationMinutes} мин</span>
          </span>
          <span className="actions">
            <button type="button" className="btn small" disabled={!settings.data}
              onClick={() => openLink(whatsappUrl(e.patient?.phone ?? '', freeSlotText(e.patient?.fullName ?? '', startAt, settings.data?.clinicSignature)))}>WhatsApp</button>
            <button type="button" className="btn small primary" disabled={book.isPending} onClick={() => book.mutate(e)}>
              {e.upcoming ? 'Перенести сюда' : 'Записать сюда'}
            </button>
          </span>
        </div>
      ))}
      {book.error && <p className="error">{book.error.message}</p>}
    </section>
  )
}
