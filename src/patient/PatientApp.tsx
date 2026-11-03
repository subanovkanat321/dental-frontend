import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { groupByCategory } from '../clinic/services'
import { servicesOfDoctor } from '../lib/doctorServices'
import { formatPhone, slotInstant, todayIn, ZONE } from '../lib/time'
import { haptic, openLink, telegram } from '../lib/telegram'
import { useBlobUrl } from '../lib/useBlobUrl'
import { launchSearch } from '../lib/deepLink'
import { ClinicFilters } from '../lib/ClinicFilters'
import { ContactLinks } from '../lib/ContactLinks'
import { useClinicFilter, withCity } from '../lib/clinicSearch'
import { BackButton, MainButton } from '../lib/MainButton'
import { bookingDays, initials, normalizeLang, priceText, serviceEmoji, translator, whenAt, type Lang, type T } from './i18n'
import { DayStrip, SlotGrid } from './SlotPicker'
import { firstFree, minutesOf, stripLength } from './slots'
import './patient.css'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorView']
type Service = Schemas['ServiceTypeView']
type Booking = Schemas['BookingViewsBooking']
type Relation = NonNullable<Schemas['RelativesRelative']['relation']>

type Screen =
  | { name: 'clinics'; back: Screen | null }
  | { name: 'doctors' }
  | { name: 'book'; doctorId: number }
  /** Без id: одна запись — она, несколько — список «Мои записи» */
  | { name: 'booking'; id?: number }
  | { name: 'reschedule'; id: number }
  | { name: 'news'; back: Screen }
  | { name: 'privacy'; back: Screen }

/** go и reload — с подтверждением что вышло («Запись отменена»): без него экран просто сменился, и непонятно, получилось ли. */
type Ctx = { me: Me; t: T; lang: Lang; go: (s: Screen, notice?: string) => void; reload: (notice?: string) => void; screen: Screen }

const dateOf = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))

/** «Мои записи»: свои и родственников, ближайшие первыми (старый сервер присылал только booking). */
function bookingsOf(me: Me): Booking[] {
  return me.bookings?.length ? me.bookings : me.booking ? [me.booking] : []
}

/** Записаться (ещё раз): один врач — сразу запись к нему, иначе — выбор врача. */
function bookStart(me: Me): Screen {
  const doctors = me.doctors ?? []
  return doctors.length === 1 ? { name: 'book', doctorId: doctors[0]!.id! } : { name: 'doctors' }
}

/**
 * С какого экрана начать: клиник несколько и не выбрана — выбор клиники; есть записи — «Ваша
 * запись» или «Мои записи» (кнопка бота «Перенести» — ?screen=reschedule, ближайшая); «Записаться
 * снова» — ?doctor=ID; иначе — запись.
 */
function firstScreen(me: Me): Screen {
  if (me.clinicChoices?.length) return { name: 'clinics', back: null }
  const params = new URLSearchParams(launchSearch())
  const again = (me.doctors ?? []).find((d) => d.id === Number(params.get('doctor')))
  const nearest = bookingsOf(me)[0]
  if (nearest && params.get('screen') === 'reschedule') return { name: 'reschedule', id: nearest.id! }
  if (nearest) return { name: 'booking' }
  if (again) return { name: 'book', doctorId: again.id! }
  return bookStart(me)
}

/** Запись поменялась (перенос, предоплата, лист ожидания) — та же правка в booking и в bookings. */
function patchBooking(me: Me, id: number, patch: (b: Booking) => Booking): Me {
  const own = (b?: Booking) => (b && b.id === id ? patch(b) : b)
  return { ...me, booking: own(me.booking), bookings: me.bookings?.map((b) => own(b)!) }
}

/** Известные коды ошибок сервера → текст на языке пациента; к «запись закрыта» — как связаться с клиникой. */
const ERRORS: Record<string, [key: string, call: boolean]> = {
  'subscription-paused': ['errPaused', true],
  'clinic-paused': ['errClinicPaused', true],
  'clinic-setting-up': ['settingUp', true],
  // Гонка или двойное нажатие: экран перечитывается сам (createQueryClient), просим повторить
  stale: ['errStale', false],
  'booking-off': ['errBookingOff', true],
  'already-booked': ['errAlreadyBooked', false],
  'too-many-bookings': ['errTooMany', false],
  'relatives-limit': ['errRelativesLimit', true],
  'no-booking': ['errNoBooking', false],
  'already-waiting': ['errAlreadyWaiting', false],
  'deposit-closed': ['errDepositClosed', false],
  'time-taken': ['taken', false],
}

/** «Позвоните в клинику: …» — только с номером; номера нет — «Свяжитесь с клиникой». */
function callText(t: T, phone?: string | null): string {
  return phone ? t('callClinic', { phone }) : t('contactClinic')
}

/**
 * Ошибка для пациента: известный код — своими словами на его языке (сервер пишет по-русски, а в
 * «позвоните в клинику: » номер бывает пустым); нет записи (404) — что её уже нет; нет связи — на
 * его языке; остальное — текст сервера.
 */
function errorText(t: T, e: unknown, phone?: string | null): string {
  if (!(e instanceof ApiError)) return t('noConnection')
  const known = e.code ? ERRORS[e.code] : undefined
  if (known) return known[1] ? `${t(known[0])} ${callText(t, phone)}` : t(known[0])
  if (e.status === 404) return t('errBookingGone')
  return e.message
}

/** Сколько дней в ленте: столько, на сколько вперёд сервер даёт записаться. */
const daysOf = (me: Me) => stripLength(me.daysAhead)

/**
 * Самозапись пациента в Telegram (этап 3 ADR 0002): всё, что видит не-сотрудник. Язык — русский
 * или кыргызский: выбор уходит на сервер, на нём пишет и бот. Перенесено из static/js/patient.js.
 */
export default function PatientApp({ me }: { me: Me }) {
  const client = useQueryClient()
  const [lang, setLangState] = useState<Lang>(() => normalizeLang(me.lang || telegram()?.initDataUnsafe?.user?.language_code))
  const [screen, setScreen] = useState<Screen | null>(null)
  const [notice, setNotice] = useState('')
  const t = useMemo(() => translator(lang), [lang])
  const saved = useRef(false)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  // Язык ещё не сохранён (первый вход) — сохраняем язык Telegram, чтобы бот писал так же
  useEffect(() => {
    if (me.lang || saved.current) return
    saved.current = true
    void api.PUT('/api/patient/language', { body: { lang } }).catch(() => {})
  }, [me.lang, lang])

  const setLang = (next: Lang) => {
    if (next === lang) return
    setLangState(next)
    // Не сохранилось — экран уже на новом языке, бот напишет на старом; при следующем входе повторим
    void api.PUT('/api/patient/language', { body: { lang: next } }).catch(() => {})
  }

  if (!me.bookingEnabled) {
    return (
      <div className="patient center">
        <p>{t('serviceBot')}</p>
        {me.clinicContact && <p>{t('bookBy', { phone: me.clinicContact })}</p>}
      </div>
    )
  }
  // Новая клиника ещё настраивается (пришёл по прямой ссылке): записи пока нет
  const bookings = bookingsOf(me)
  if (me.clinic?.settingUp && !bookings.length) {
    return (
      <div className="patient center">
        <LangSwitch lang={lang} onChange={setLang} />
        <p role="status">{t('settingUp')}</p>
        {me.clinicContact && <p>{t('callClinic', { phone: me.clinicContact })}</p>}
      </div>
    )
  }
  const current = screen ?? firstScreen(me)
  const ctx: Ctx = {
    me, t, lang, screen: current,
    go: (s, done = '') => {
      setScreen(s)
      setNotice(done)
      window.scrollTo(0, 0)
    },
    // Запись или клиника поменялись — свежий me, и экран заново по нему
    reload: (done = '') => {
      setScreen(null)
      setNotice(done)
      window.scrollTo(0, 0)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  }
  const doctor = current.name === 'book' ? (me.doctors ?? []).find((d) => d.id === current.doctorId) : undefined
  // Какая запись открыта: id с экрана, а без него — единственная
  const opened = current.name === 'booking' || current.name === 'reschedule'
    ? current.id == null ? (bookings.length === 1 ? bookings[0] : undefined) : bookings.find((b) => b.id === current.id)
    : undefined

  return (
    <div className="patient">
      {current.name !== 'privacy' && <LangSwitch lang={lang} onChange={setLang} />}
      {notice && <p className="notice tone-ok" role="status">{notice}</p>}
      {me.elsewhere?.booking?.startAt && current.name !== 'privacy' && current.name !== 'clinics' && <Elsewhere ctx={ctx} />}
      {current.name === 'clinics' && <ClinicsScreen ctx={ctx} back={current.back} />}
      {current.name === 'doctors' && <DoctorsScreen ctx={ctx} />}
      {current.name === 'book' && doctor && <BookScreen key={doctor.id} ctx={ctx} doctor={doctor} />}
      {current.name === 'book' && !doctor && <DoctorsScreen ctx={ctx} />}
      {current.name === 'booking' && (opened ? <BookingScreen key={opened.id} ctx={ctx} b={opened} />
        : bookings.length > 0 && <MyBookingsScreen ctx={ctx} bookings={bookings} />)}
      {current.name === 'reschedule' && opened && <RescheduleScreen ctx={ctx} b={opened} />}
      {current.name === 'news' && <NewsScreen ctx={ctx} back={current.back} />}
      {current.name === 'privacy' && <PrivacyScreen ctx={ctx} back={current.back} />}
    </div>
  )
}

/**
 * Запись в другой клинике (в этой записи нет): напомнить о ней и одной кнопкой вернуться в ту
 * клинику — иначе пациент думает, что запись пропала, и записывается заново.
 */
function Elsewhere({ ctx }: { ctx: Ctx }) {
  const { me, t, lang } = ctx
  const e = me.elsewhere!
  const open = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patient/clinic', { body: { clinicId: e.clinicId! } })),
    onSuccess: () => {
      haptic('success')
      ctx.reload()
    },
  })
  return (
    <div className="deposit-card elsewhere" role="status">
      <span>📅 {t('elsewhere', { clinic: e.clinicName ?? '', when: whenAt(lang, e.booking!.startAt!) })}</span>
      <button type="button" className="btn" disabled={open.isPending} onClick={() => open.mutate()}>{t('elsewhereOpen')}</button>
      {open.error && <p className="error" role="alert">{errorText(t, open.error, me.clinicContact)}</p>}
    </div>
  )
}

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Тил / Язык">
      <button type="button" aria-pressed={lang === 'ru'} onClick={() => onChange('ru')}>Русский</button>
      <button type="button" aria-pressed={lang === 'ky'} onClick={() => onChange('ky')}>Кыргызча</button>
    </div>
  )
}

/** Шапка: фото врача (если загрузил) или рисунок зуба, заголовок, имя врача и пара слов о нём. */
function Hero({ title, subtitle, doctor, t }: { title: string; subtitle: string; doctor?: { photoUrl?: string; fullName?: string; about?: string }; t: T }) {
  return (
    <div className="hero">
      <img src={doctor?.photoUrl || `${import.meta.env.BASE_URL}tishka-icon.svg`} alt={doctor?.photoUrl ? t('doctorPhoto') : ''} width={72} height={72}
        className={doctor?.photoUrl ? 'hero-photo' : undefined} />
      <div>
        <h1>{title}</h1>
        {doctor?.fullName && <div className="hero-doctor">{doctor.fullName}</div>}
        <p>{doctor?.about || subtitle}</p>
      </div>
    </div>
  )
}

/** «Бишкек, ул. Шевченко 6 · Открыть в 2ГИС» — если админ заполнил «О клинике». */
function ClinicCard({ ctx }: { ctx: Ctx }) {
  const c = ctx.me.clinic
  if (!c?.address && !c?.mapUrl) return null
  return (
    <div className="clinic-card">
      <span aria-hidden="true">📍</span>
      <span className="clinic-address">{c.address || ctx.t('findUs')}</span>
      {c.mapUrl && <button type="button" className="btn map-btn" onClick={() => openLink(c.mapUrl!)}>{ctx.t('open2gis')}</button>}
    </div>
  )
}

/**
 * Связаться с клиникой: «Позвонить» на каждый её номер и WhatsApp — только если клиника его задала
 * (он может быть другим номером). Номеров нет — прежняя строка с телефоном из настроек сервера.
 */
function ClinicContacts({ ctx }: { ctx: Ctx }) {
  const { me, t } = ctx
  const c = me.clinic
  if (!c?.phones?.length && !c?.whatsappPhone) {
    return me.clinicContact ? <p className="hint">{t('clinicPhone', { phone: me.clinicContact })}</p> : null
  }
  return <ContactLinks phones={c.phones} whatsapp={c.whatsappPhone} texts={{ call: t('call'), whatsapp: t('writeWhatsapp') }} />
}

/** Низ экрана: новости клиники, другая клиника, техподдержка. */
function Footer({ ctx }: { ctx: Ctx }) {
  const { me, t } = ctx
  const c = me.clinic
  return (
    <>
      <button type="button" className="btn" onClick={() => ctx.go({ name: 'news', back: ctx.screen })}><span aria-hidden="true">📰 </span>{t('news')}</button>
      {me.canChangeClinic && (
        <button type="button" className="link other-clinic" onClick={() => ctx.go({ name: 'clinics', back: ctx.screen })}>
          🏥 {c?.brandName || c?.name || ''} · {t('otherClinic')}</button>
      )}
      {(c?.supportUrl || c?.supportPhone) && (
        <p className="support-footer">{t('cantBook')}
          <button type="button" className="link" onClick={() => openLink(c.supportUrl || `${window.location.origin}/call.html#${c.supportPhone}`)}>{t('support')}</button>
        </p>
      )}
    </>
  )
}

/** «В какую клинику?» — клиники каталога. Выбор — на сервере: дальше и бот, и запись — в этой клинике. */
function ClinicsScreen({ ctx, back }: { ctx: Ctx; back: Screen | null }) {
  const { me, t } = ctx
  const list = useQuery({
    queryKey: ['patient-clinics'],
    queryFn: () => unwrap(api.GET('/api/patient/clinics')),
    enabled: !me.clinicChoices?.length,
  })
  const choices = me.clinicChoices?.length ? me.clinicChoices : list.data ?? []
  const filter = useClinicFilter(choices, (c) => [c.name, c.address])
  const choose = useMutation<unknown, ApiError, number>({
    mutationFn: (clinicId) => unwrap(api.PUT('/api/patient/clinic', { body: { clinicId } })),
    onSuccess: () => {
      haptic('success')
      ctx.reload()
    },
  })
  const currentName = me.clinic?.brandName || me.clinic?.name
  return (
    <section className="screen">
      <BackButton onBack={back ? () => ctx.go(back) : null} />
      <Hero t={t} title={t('chooseClinic')} subtitle={t('chooseClinicSub')} />
      {list.error && <p className="error">{errorText(t, list.error, ctx.me.clinicContact)}</p>}
      {list.isFetching && !choices.length && <p className="hint">{t('loading')}</p>}
      <ClinicFilters filter={filter} lang={ctx.lang} texts={{ search: t('clinicSearch'), cities: t('cities'), allCities: t('allCities') }} />
      {choices.length > 0 && !filter.shown.length && (
        <div className="empty-filter">
          <p className="hint">{t('clinicsNone')}</p>
          <button type="button" className="btn" onClick={() => { filter.setQuery(''); filter.setCity('') }}>{t('clinicsAll')}</button>
        </div>
      )}
      {filter.shown.map((c) => (
        <button key={c.id} type="button" className={c.name === currentName ? 'doctor-card current' : 'doctor-card'} disabled={choose.isPending}
          onClick={() => choose.mutate(c.id!)}>
          <span className="doctor-initials" aria-hidden="true">🏥</span>
          <span className="doctor-card-text"><strong>{c.name}</strong>{(c.address || c.city) && <span className="hint">📍 {withCity(c.address, c.city)}</span>}</span>
          <span className="chevron" aria-hidden="true">›</span>
        </button>
      ))}
      {choose.error && <p className="error" role="alert">{errorText(t, choose.error, ctx.me.clinicContact)}</p>}
    </section>
  )
}

/** Врачей несколько — сначала выбрать, к кому: у каждого своё кресло и своё время. */
function DoctorsScreen({ ctx }: { ctx: Ctx }) {
  const { me, t } = ctx
  const doctors = me.doctors ?? []
  return (
    <section className="screen">
      <BackButton onBack={null} />
      <Hero t={t} title={t('bookTitle')} subtitle={t('pickDoctorSub')} />
      <h2>{t('doctor')}</h2>
      {doctors.length ? doctors.map((d) => (
        <button key={d.id} type="button" className="doctor-card" onClick={() => ctx.go({ name: 'book', doctorId: d.id! })}>
          {d.photoUrl ? <img src={d.photoUrl} alt="" width={64} height={64} /> : <span className="doctor-initials" aria-hidden="true">{initials(d.fullName)}</span>}
          <span className="doctor-card-text"><strong>{d.fullName}</strong>{d.about && <span className="hint">{d.about}</span>}</span>
          <span className="chevron" aria-hidden="true">›</span>
        </button>
      )) : <p className="hint">{t('unavailable')}</p>}
      <ClinicCard ctx={ctx} />
      <Footer ctx={ctx} />
    </section>
  )
}

/** Кого записываем: себя, родственника из списка (его id) или нового. */
type Who = 'self' | 'new' | number

/** Новый родственник — поля формы; телефон пустой — номер записывающего. */
type NewRelative = { fullName: string; birthDate: string; relation: Relation; phone: string }

const RELATIONS: Relation[] = ['CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER']

/**
 * Кого записать по умолчанию: себя, если у себя записи нет; иначе — первого незаписанного
 * родственника или нового (мама с записью пришла записать ребёнка).
 */
function defaultWho(me: Me): Who {
  const booked = new Set(bookingsOf(me).map((b) => b.patientId))
  if (!bookingsOf(me).some((b) => b.self !== false)) return 'self'
  return (me.relatives ?? []).find((r) => !booked.has(r.id))?.id ?? 'new'
}

/** Запись: услуга → день → время → кого записываем, имя, телефон из Telegram, согласие → «Записаться». */
function BookScreen({ ctx, doctor }: { ctx: Ctx; doctor: Doctor }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
  const [who, setWho] = useState<Who>(() => defaultWho(me))
  const [relative, setRelative] = useState<NewRelative>({ fullName: '', birthDate: '', relation: 'CHILD', phone: '' })
  const relativeName = who === 'new' ? relative.fullName.trim() : (me.relatives ?? []).find((r) => r.id === who)?.fullName ?? ''
  // Своё имя нужно для себя и для первой записи ребёнка, когда своей карточки ещё нет
  const askOwnName = who === 'self' || (who === 'new' && !me.hasCard)
  // У врача выбраны услуги — только они; не выбраны — все услуги клиники
  const services = servicesOfDoctor(me.services ?? [], me.doctorServices, doctor.id)
  const many = (me.doctors ?? []).length > 1
  const [service, setService] = useState<Service | null>(services.length === 1 ? services[0]! : null)
  const [date, setDate] = useState(todayIn())
  // Пока пациент сам не выбрал день, лента встаёт на первый день со свободным временем
  const [dateTouched, setDateTouched] = useState(false)
  const [chosen, setChosen] = useState('')
  const [name, setName] = useState(me.fullName ?? '')
  const [comment, setComment] = useState('')
  const [consent, setConsent] = useState(false)
  // «Откуда вы о нас узнали?» — только новому пациенту (сервер прислал варианты), необязательно
  const [sourceId, setSourceId] = useState<number | null>(null)
  // Промокод из рекламы: из ссылки (бот запомнил — me.promoCode; Mini App по ссылке с ?promo=) или вписал сам
  const [promo, setPromo] = useState(() => me.promoCode ?? promoFromUrl())
  const [promoOpen, setPromoOpen] = useState(() => promo !== '')
  const [phone, setPhone] = useState(me.phone ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sharing, setSharing] = useState(false)
  const serviceRef = useRef<HTMLElement>(null)
  const timeRef = useRef<HTMLElement>(null)
  const dataRef = useRef<HTMLElement>(null)
  const days = bookingDays(lang, todayIn(), daysOf(me)).map((d) => d.date)

  // Пока день не выбран сам — первый день со свободным временем (сегодня мест нет — завтра и т. д.);
  // две недели пусто — сказать, что делать. Перебор — в одном запросе, без мигания пустых сеток
  const slots = useQuery({
    queryKey: ['patient-slots', doctor.id, service?.id, dateTouched ? date : 'first-free'],
    queryFn: async () => {
      const load = (d: string) => unwrap(api.GET('/api/patient/slots', { params: { query: { date: d, doctorId: doctor.id!, serviceTypeId: service!.id! } } }))
      if (dateTouched) return { date, slots: await load(date), noneSoon: false }
      // По неделе за раз, параллельно (а не 14–30 запросов друг за другом)
      return firstFree(days, load)
    },
    enabled: service != null,
  })
  const shownDate = dateTouched ? date : slots.data?.date ?? date

  const dataMissing = (askOwnName && !name.trim()) || (who === 'new' && !relativeName) || !phone || !consent
  const missing = !service ? 'service' : !chosen ? 'time' : dataMissing ? 'data' : null
  const scrollTo = (step: 'service' | 'time' | 'data', attention = false) => {
    const el = (step === 'service' ? serviceRef : step === 'time' ? timeRef : dataRef).current
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (!attention && top > 0 && top < window.innerHeight / 3) return
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    if (attention) {
      el.classList.remove('step-attention')
      void el.offsetWidth
      el.classList.add('step-attention')
    }
  }

  const book = useMutation<Schemas['BookingViewsBooking'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient/booking', {
      body: { doctorId: doctor.id!, serviceTypeId: service!.id!, startAt: slotInstant(shownDate, minutesOf(chosen)), fullName: name, consent: true, comment, sourceId: sourceId ?? undefined,
        promoCode: promo.trim() || undefined,
        patientId: typeof who === 'number' ? who : undefined,
        relative: who === 'new' ? { fullName: relative.fullName, birthDate: relative.birthDate || undefined, relation: relative.relation, phone: relative.phone.trim() || undefined } : undefined },
    })),
    onSuccess: (booking) => {
      haptic('success')
      // Сразу «Ваша запись» (ближайшая остаётся в booking); новый родственник и порядок — со свежим me
      client.setQueryData<Me>(['me'], (old) => (old ? { ...old, booking: old.booking ?? booking, bookings: [...(old.bookings ?? []), booking], phone } : old))
      void client.invalidateQueries({ queryKey: ['me'] })
      ctx.go({ name: 'booking', id: booking.id })
    },
    onError: (e) => {
      haptic('error')
      if (e.code === 'time-taken') {
        setErrors({ time: t('taken') })
        setChosen('')
        void slots.refetch()
      } else if (e.code === 'already-booked') {
        ctx.reload()
      } else {
        // Ошибки полей — своими словами на языке пациента (сервер отвечает по-русски)
        const f = e.fieldErrors
        const own = (key: string, fallback: string) => (f[key] ? (lang === 'ru' ? f[key] : t(fallback)) : '')
        const next = { name: own('fullName', 'nameRequired'), phone: own('phone', 'phoneRequired'), consent: own('consent', 'consentRequired'),
          promo: own('promoCode', 'promoInvalid'), relName: own('relative.fullName', 'relativeNameRequired'),
          relBirth: own('relative.birthDate', 'relativeBirthInvalid'), relPhone: own('relative.phone', 'relativePhoneInvalid'),
          relRelation: own('relative.relation', 'relativeRelationRequired') }
        if (next.promo) setPromoOpen(true)
        setErrors(Object.values(next).some(Boolean) ? next : { form: errorText(t, e, me.clinicContact) })
      }
    },
  })

  const [commentOpen, setCommentOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const bookLabel = missing === 'service' ? t('nextService') : missing === 'time' ? t('nextTime') : missing === 'data' ? t('nextData') : t('book')
  const next = () => {
    if (!missing) {
      setErrors({})
      book.mutate()
      return
    }
    haptic('warning')
    scrollTo(missing, true)
    if (missing === 'service') setErrors({ form: t('pickService') })
    else if (missing === 'time') setErrors({ time: t('pickTime') })
    else if (who === 'new' && !relativeName) setErrors({ relName: t('relativeNameRequired') })
    else if (askOwnName && !name.trim()) setErrors({ name: t('nameRequired') })
    else if (!phone) setErrors({ phone: t('phoneRequired') })
    else setErrors({ consent: t('consentRequired') })
  }

  /** Телефон — из Telegram: requestContact отдаёт номер боту, сервер сохраняет, ждём его в /api/patient/me. */
  const sharePhone = () => {
    setErrors({})
    const app = telegram()
    if (!app?.requestContact) {
      setErrors({ phone: t('openFromBot') })
      return
    }
    // requestContact — с Bot API 6.9: на старом Telegram вызов молча не срабатывает или падает
    if (app.isVersionAtLeast && !app.isVersionAtLeast('6.9')) {
      setErrors({ phone: t('oldTelegram') })
      return
    }
    const received = async (shared: boolean) => {
      if (!shared) {
        setErrors({ phone: t('needPhone') })
        return
      }
      setSharing(true)
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setTimeout(r, 800))
        try {
          const fresh = await unwrap(api.GET('/api/patient/me'))
          if (fresh.phone) {
            setPhone(fresh.phone)
            if (!name && fresh.fullName) setName(fresh.fullName)
            setSharing(false)
            return
          }
        } catch {
          // повторим
        }
      }
      setSharing(false)
      setErrors({ phone: t('phoneLost') })
    }
    try {
      app.requestContact((shared) => void received(shared))
    } catch {
      setErrors({ phone: t('oldTelegram') })
    }
  }

  const groups = groupByCategory(services)
  const serviceButton = (s: Service) => (
    <button key={s.id} type="button" className="btn service" aria-pressed={service?.id === s.id}
      onClick={() => { setService(s); setChosen(''); setErrors({}); scrollTo('time') }}>
      {/* Одна строка: значок, название с длительностью, цена справа — список короче, чем карточки */}
      <span className="svc-emoji" aria-hidden="true">{serviceEmoji(s.name)}</span>
      <span className="svc-main"><span className="svc-name">{s.name}</span>
        <span className="sr-only"> · {s.durationMinutes} {t('min')}</span>
        <span className="dur" aria-hidden="true">⏱ {s.durationMinutes} {t('min')}</span></span>
      {priceText(lang, s.priceSom) && <span className="price">{priceText(lang, s.priceSom)}</span>}
    </button>
  )

  return (
    <section className="screen">
      <BackButton onBack={many ? () => ctx.go({ name: 'doctors' }) : null} />
      <Hero t={t} title={t('bookTitle')} subtitle={t('pickServiceSub')} doctor={doctor} />
      {many ? <button type="button" className="link" onClick={() => ctx.go({ name: 'doctors' })}>{t('otherDoctor')}</button> : <ClinicCard ctx={ctx} />}

      <section ref={serviceRef} className="step">
        <h2 className="step-title">{t('stepService')}</h2>
        <div className="field services">
          {!services.length ? <p className="hint">{t('unavailable')}</p> : groups.length > 1
            ? groups.map(({ category, items }) => (
              <div key={category ?? '—'} className="services-group">
                <h3>{category || t('otherServices')}</h3>
                {items.map(serviceButton)}
              </div>
            ))
            : services.map(serviceButton)}
        </div>
      </section>

      <section ref={timeRef} className="step">
        <h2 className="step-title">{t('stepTime')}</h2>
        <div className="field"><span>{t('day')}</span>
          <DayStrip t={t} lang={lang} length={daysOf(me)} date={shownDate} onPick={(d) => { setDate(d); setDateTouched(true); setChosen(''); setErrors({}) }} />
        </div>
        <div className="field"><span>{t('time')}</span>
          {errors.time && <p className="error" role="alert">{errors.time}</p>}
          {!service ? <p className="hint">{t('pickServiceFirst')}</p>
            : slots.isPending ? <p className="hint">{t('loading')}</p>
              : slots.error ? <p className="error">{errorText(t, slots.error, ctx.me.clinicContact)}</p>
                : slots.data.noneSoon ? <p className="hint">{t('noFreeSoon')} {callText(t, me.clinicContact)}</p>
                  : <SlotGrid t={t} lang={lang} slots={slots.data.slots} chosen={chosen}
                    onPick={(time) => { setChosen(time); setErrors({}); scrollTo('data') }}
                    empty={slots.data.slots.dayOff ? t('otherDay') : slots.data.slots.workingDay ? t('noFree') : t('dayOff')} />}
          {/* Сам выбрал день без свободного времени — одним нажатием к ближайшему свободному, а не листать ленту */}
          {service && dateTouched && slots.data && !slots.data.slots.starts?.length && (
            <button type="button" className="btn" onClick={() => { setDateTouched(false); setErrors({}) }}>{t('nearestFree')}</button>
          )}
        </div>
      </section>

      <section ref={dataRef} className="step">
        <h2 className="step-title">{t('stepData')}</h2>
        <WhoField ctx={ctx} who={who} onChange={(w) => { setWho(w); setErrors({}) }} />
        {who === 'new' && <RelativeFields ctx={ctx} value={relative} errors={errors}
          onChange={(r) => { setRelative(r); setErrors({}) }} />}
        {askOwnName && (
          <label className="field"><span>{who === 'self' ? t('patientName') : t('yourName')}</span>
            <input value={name} maxLength={200} autoComplete="name" enterKeyHint="done"
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} onChange={(e) => { setName(e.target.value); setErrors({}) }} /></label>
        )}
        {errors.name && <p className="error">{errors.name}</p>}
        <div className="field"><span>{who === 'self' ? t('phone') : t('yourPhone')}</span>
          {phone ? (
            <div className="picked">{formatPhone(phone)}<br /><span className="hint">{t('phoneFromTelegram')}</span></div>
          ) : <button type="button" className="btn" disabled={sharing} onClick={sharePhone}>{sharing ? t('gettingPhone') : t('sharePhone')}</button>}
        </div>
        {errors.phone && <p className="error">{errors.phone}</p>}
        {/* Необязательное — свёрнуто: запись короче, кто хочет — раскроет */}
        {commentOpen ? (
          <label className="field"><span>{t('comment')}</span>
            <textarea rows={2} maxLength={500} autoFocus placeholder={t('commentHint')} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        ) : <button type="button" className="link promo-open" onClick={() => setCommentOpen(true)}>＋ {t('comment')}</button>}
        <PromoField ctx={ctx} value={promo} open={promoOpen} error={errors.promo}
          onOpen={() => setPromoOpen(true)} onChange={(v) => { setPromo(v); setErrors({}) }} />
        {(me.sourceChoices ?? []).length > 0 && !sourceOpen && (
          <button type="button" className="link promo-open" onClick={() => setSourceOpen(true)}>＋ {t('sourceQuestion')}</button>
        )}
        {(me.sourceChoices ?? []).length > 0 && sourceOpen && (
          <div className="field">
            <span>{t('sourceQuestion')}</span>
            <div className="source-chips" role="group" aria-label={t('sourceQuestion')}>
              {(me.sourceChoices ?? []).map((c) => (
                <button key={c.id} type="button" className="source-chip" aria-pressed={sourceId === c.id}
                  onClick={() => setSourceId(sourceId === c.id ? null : c.id!)}>
                  <span aria-hidden="true">{c.emoji}</span> {(lang === 'ky' && c.titleKy) || c.title}
                </button>
              ))}
            </div>
            <span className="hint">{t('sourceOptional')}</span>
          </div>
        )}
        <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors({}) }} />
          {' '}{who === 'self' ? t('consent', { holder: me.clinic?.legalName || t('holderDefault') })
            : t('consentFor', { name: relativeName || t('relativeDefault'), holder: me.clinic?.legalName || t('holderDefault') })}</label>
        <button type="button" className="link privacy-link" onClick={() => ctx.go({ name: 'privacy', back: ctx.screen })}>{t('privacy')}</button>
        {errors.consent && <p className="error">{errors.consent}</p>}
      </section>
      {errors.form && <p className="error" role="alert">{errors.form}</p>}
      <Footer ctx={ctx} />
      <MainButton busy={book.isPending} onClick={next} text={bookLabel} />
    </section>
  )
}

/**
 * «Кого записываем?» — «Себя», родственники этого Telegram (дети и др. из семьи в клинике) и
 * «＋ Ребёнка или родственника». У кого уже есть запись — не выбрать: одна запись на человека.
 */
function WhoField({ ctx, who, onChange }: { ctx: Ctx; who: Who; onChange: (w: Who) => void }) {
  const { me, t } = ctx
  const booked = new Set(bookingsOf(me).map((b) => b.patientId))
  const selfBooked = bookingsOf(me).some((b) => b.self !== false)
  const relatives = me.relatives ?? []
  const chip = (key: Who, label: string, isBooked: boolean) => (
    <button key={String(key)} type="button" className="source-chip who-chip" aria-pressed={who === key} disabled={isBooked}
      onClick={() => onChange(key)}>{label}{isBooked && <small> · {t('whoBooked')}</small>}</button>
  )
  return (
    <div className="field">
      <span id="who-title">{t('whoTitle')}</span>
      <div className="source-chips" role="group" aria-labelledby="who-title">
        {chip('self', t('whoSelf'), selfBooked)}
        {relatives.map((r) => chip(r.id!, r.fullName ?? '', booked.has(r.id)))}
        {relatives.length < (me.maxRelatives ?? 6) && chip('new', t('whoAdd'), false)}
      </div>
    </div>
  )
}

/** Новый родственник: имя, дата рождения (необязательно), кем приходится, телефон (необязательно). */
function RelativeFields({ ctx, value, errors, onChange }: {
  ctx: Ctx; value: NewRelative; errors: Record<string, string>; onChange: (v: NewRelative) => void
}) {
  const { t } = ctx
  return (
    <div className="relative-fields">
      <label className="field"><span>{t('relativeName')}</span>
        <input value={value.fullName} maxLength={200} autoComplete="off" onChange={(e) => onChange({ ...value, fullName: e.target.value })} /></label>
      {errors.relName && <p className="error">{errors.relName}</p>}
      <div className="field">
        <span id="relation-title">{t('relativeRelation')}</span>
        <div className="source-chips" role="group" aria-labelledby="relation-title">
          {RELATIONS.map((r) => (
            <button key={r} type="button" className="source-chip" aria-pressed={value.relation === r}
              onClick={() => onChange({ ...value, relation: r })}>{t(`rel${r}`)}</button>
          ))}
        </div>
      </div>
      {errors.relRelation && <p className="error">{errors.relRelation}</p>}
      <label className="field"><span>{t('relativeBirth')}</span>
        <input type="date" value={value.birthDate} max={todayIn()} onChange={(e) => onChange({ ...value, birthDate: e.target.value })} /></label>
      {errors.relBirth && <p className="error">{errors.relBirth}</p>}
      <label className="field"><span>{t('relativePhone')}</span>
        <input type="tel" inputMode="tel" value={value.phone} maxLength={30} autoComplete="off"
          onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        <span className="hint">{t('relativePhoneHint')}</span></label>
      {errors.relPhone && <p className="error">{errors.relPhone}</p>}
    </div>
  )
}

/** ?promo=КОД в адресе Mini App (ссылка из рекламы); нет — пусто. Код — не личные данные. */
function promoFromUrl(): string {
  try {
    const code = new URLSearchParams(window.location.search).get('promo') ?? ''
    return /^[\p{L}\d]{3,20}$/u.test(code) ? code.toUpperCase() : ''
  } catch {
    return ''
  }
}

/**
 * «Промокод (если есть)»: свёрнут ссылкой «У меня есть промокод», из ссылки рекламы — сразу открыт
 * с кодом. «Проверить» — сервер скажет, подходит ли, и покажет скидку-подсказку: её применяет
 * клиника на приёме. Неподходящий код не даст записаться — его исправляют или убирают.
 */
function PromoField({ ctx, value, open, error, onOpen, onChange }: {
  ctx: Ctx; value: string; open: boolean; error?: string; onOpen: () => void; onChange: (v: string) => void
}) {
  const { t, lang } = ctx
  const check = useMutation<Schemas['BookingViewsPromo'], ApiError, string>({
    mutationFn: (code) => unwrap(api.GET('/api/patient/promo-code', { params: { query: { code } } })),
  })
  if (!open) return <button type="button" className="link promo-open" onClick={onOpen}>{t('promoHave')}</button>
  const accepted = check.data && check.data.code === value.trim().toUpperCase() ? check.data : null
  const failed = check.error && check.variables === value ? (lang === 'ru' ? check.error.fieldErrors.promoCode ?? check.error.message : t('promoInvalid')) : ''
  const discount = accepted ? [accepted.discountPercent ? `−${accepted.discountPercent}%` : '', accepted.discountText ?? ''].filter(Boolean).join(' · ') : ''
  return (
    <div className="field promo-field">
      <label htmlFor="promo-code">{t('promoLabel')}</label>
      <div className="promo-row">
        <input id="promo-code" value={value} maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder={t('promoPlaceholder')}
          enterKeyHint="done" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (value.trim()) check.mutate(value) } }}
          onChange={(e) => { check.reset(); onChange(e.target.value.toUpperCase()) }} />
        <button type="button" className="btn" disabled={!value.trim() || check.isPending} onClick={() => check.mutate(value)}>{t('promoCheck')}</button>
        {value && <button type="button" className="link" onClick={() => { check.reset(); onChange('') }}>{t('promoRemove')}</button>}
      </div>
      {accepted && <p className="tone-ok" role="status">✓ {t('promoAccepted')}{discount ? `: ${discount}` : ''}. {t('promoClinicApplies')}</p>}
      {(failed || error) && <p className="error" role="alert">{failed || error}</p>}
    </div>
  )
}

const STATUS: Record<string, string> = { REQUESTED: 'requested', SCHEDULED: 'scheduled' }

/** «Аружан» в «Моих записях»; своя запись — «Вы». Старый сервер не присылал self — значит, своя. */
function whose(t: T, b: Booking): string {
  return b.self === false ? b.patientName ?? '' : t('forMe')
}

/** «Мои записи»: несколько записей — свои и детей; нажать — открыть запись. */
function MyBookingsScreen({ ctx, bookings }: { ctx: Ctx; bookings: Booking[] }) {
  const { me, t, lang } = ctx
  return (
    <section className="screen">
      <BackButton onBack={null} />
      <Hero t={t} title={t('myBookings')} subtitle={t('waitingYou')} />
      <ul className="my-bookings">
        {bookings.map((b) => (
          <li key={b.id}>
            <button type="button" className="doctor-card my-booking" onClick={() => ctx.go({ name: 'booking', id: b.id })}>
              <span className="doctor-initials" aria-hidden="true">{b.self === false ? initials(b.patientName) : '🙂'}</span>
              <span className="doctor-card-text">
                <strong>{whose(t, b)}</strong>
                <span>📅 {whenAt(lang, b.startAt!)}</span>
                <span className="hint">{serviceEmoji(b.serviceName)} {b.serviceName || t('defaultService')} · {b.doctorName}</span>
                <span className={b.status === 'SCHEDULED' ? 'status tone-ok' : 'status tone-wait'}>{STATUS[b.status ?? ''] ? t(STATUS[b.status!]!) : b.status}</span>
              </span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => ctx.go(bookStart(me))}>{t('bookAnother')}</button>
      <ClinicCard ctx={ctx} />
      <ClinicContacts ctx={ctx} />
      <Footer ctx={ctx} />
    </section>
  )
}

/** Одна запись (своя или ребёнка): когда, что, подтверждена ли; предоплата, «хочу раньше», перенести, отменить. */
function BookingScreen({ ctx, b }: { ctx: Ctx; b: Booking }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
  const doctor = (me.doctors ?? []).find((d) => d.id === b.doctorId)
  const many = bookingsOf(me).length > 1
  const query = { params: { query: { appointmentId: b.id! } } }
  // Старый сервер: «в листе ожидания» — общий флаг me.waiting
  const waiting = b.waiting ?? me.waiting
  const [sure, setSure] = useState(false)
  // «Точно отменить?» — ненадолго: через 5 секунд кнопка снова обычная, случайное второе нажатие позже не отменит
  useEffect(() => {
    if (!sure) return
    const timer = setTimeout(() => setSure(false), 5000)
    return () => clearTimeout(timer)
  }, [sure])
  const cancel = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient/booking/cancel', query)),
    onSuccess: () => {
      haptic('success')
      // Сразу без этой записи (а не «Ваша запись» с «Запись отменена», пока me не пришёл заново)
      client.setQueryData<Me>(['me'], (old) => {
        if (!old) return old
        const rest = bookingsOf(old).filter((x) => x.id !== b.id)
        return { ...old, booking: rest[0], bookings: rest, waiting: rest[0]?.waiting ?? false }
      })
      ctx.reload(t('cancelled'))
    },
  })
  const waitlist = useMutation<unknown, ApiError, boolean>({
    mutationFn: (join) => unwrap(join ? api.POST('/api/patient/waitlist', query) : api.DELETE('/api/patient/waitlist', query)),
    onSuccess: (_r, join) => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? { ...patchBooking(old, b.id!, (x) => ({ ...x, waiting: join })),
        waiting: old.booking?.id === b.id ? join : old.waiting } : old))
    },
  })
  const error = cancel.error ?? waitlist.error
  return (
    <section className="screen">
      <BackButton onBack={many ? () => ctx.go({ name: 'booking' }) : null} />
      {many && <button type="button" className="link" onClick={() => ctx.go({ name: 'booking' })}>{t('allBookings')}</button>}
      <Hero t={t} title={b.self === false ? t('bookingOf', { name: b.patientName ?? '' }) : t('yourBooking')} subtitle={t('waitingYou')}
        doctor={doctor ?? { fullName: b.doctorName }} />
      <div className="booking-card">
        <p className="big">📅 {whenAt(lang, b.startAt!)}</p>
        <div>{serviceEmoji(b.serviceName)} {b.serviceName || t('defaultService')}</div>
        {b.comment && <p className="hint booking-comment">💬 {b.comment}</p>}
        {b.promoCode && <p className="hint">🎟 {t('promoBooking', { code: b.promoCode })}</p>}
        <p><span className={b.status === 'SCHEDULED' ? 'status tone-ok' : 'status tone-wait'}>{STATUS[b.status ?? ''] ? t(STATUS[b.status!]!) : b.status}</span></p>
      </div>
      {b.depositStatus && <PatientDeposit ctx={ctx} b={b} />}
      <button type="button" className="btn" onClick={() => ctx.go({ name: 'reschedule', id: b.id! })}><span aria-hidden="true">🗓️ </span>{t('moveOther')}</button>
      {waiting ? (
        <div className="waitlist-on">
          <p className="hint">{t('waitlistOn')}</p>
          <button type="button" className="link" disabled={waitlist.isPending} onClick={() => waitlist.mutate(false)}>{t('waitlistLeave')}</button>
        </div>
      ) : <button type="button" className="btn" disabled={waitlist.isPending} onClick={() => waitlist.mutate(true)}><span aria-hidden="true">🔔 </span>{t('waitlistJoin')}</button>}
      <button type="button" className="btn" onClick={() => ctx.go(bookStart(me))}>{t('bookAnother')}</button>
      <ClinicCard ctx={ctx} />
      <ClinicContacts ctx={ctx} />
      {error && <p className="error" role="alert">{errorText(t, error, ctx.me.clinicContact)}</p>}
      <Footer ctx={ctx} />
      <div className="danger-zone">
        {/* Отмена — вторым нажатием: случайно отменить запись к врачу обидно */}
        <button type="button" className="btn danger" disabled={cancel.isPending}
          onClick={() => (sure ? cancel.mutate() : setSure(true))}>{sure ? t('cancelSure') : t('cancel')}</button>
      </div>
    </section>
  )
}

/** Предоплата, которую просит клиника: сумма, QR и «как перевести», «Я оплатил(а)» с чеком по желанию. */
function PatientDeposit({ ctx, b }: { ctx: Ctx; b: Booking }) {
  const { t } = ctx
  const client = useQueryClient()
  const sum = new Intl.NumberFormat('ru-RU').format(b.depositSom ?? 0)
  const asked = b.depositStatus !== 'RECEIVED' && b.depositStatus !== 'REPORTED'
  const info = useQuery({
    queryKey: ['patient-deposit', b.id],
    queryFn: () => unwrap(api.GET('/api/patient/deposit', { params: { query: { appointmentId: b.id! } } })),
    enabled: asked,
  })
  const qr = useBlobUrl(asked && info.data?.hasQr ? '/api/patient/deposit/qr' : null)
  const [file, setFile] = useState<File | null>(null)
  const paid = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body = new FormData()
      if (file) body.append('file', file)
      return upload(`/api/patient/deposit/report?appointmentId=${b.id}`, body)
    },
    onSuccess: () => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? patchBooking(old, b.id!, (x) => ({ ...x, depositStatus: 'REPORTED' })) : old))
    },
  })
  if (b.depositStatus === 'RECEIVED') return <div className="deposit-card tone-ok">✅ {t('depositReceived', { sum })}</div>
  if (b.depositStatus === 'REPORTED') return <div className="deposit-card tone-wait">⏳ {t('depositReported', { sum })}</div>
  return (
    <div className="deposit-card">
      <strong>💳 {t('depositAsk', { sum })}</strong>
      <p className="hint">{t('depositWhy')}</p>
      {info.data?.details && <p className="deposit-details">{info.data.details}</p>}
      {qr && qr !== 'error' && <img className="pay-qr" src={qr.url} alt="QR" />}
      <label className="btn"><span aria-hidden="true">📎 </span>{file ? file.name : t('depositReceipt')}
        <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      {paid.error && <p className="error" role="alert">{errorText(t, paid.error, ctx.me.clinicContact)}</p>}
      <button type="button" className="btn primary" disabled={paid.isPending} onClick={() => paid.mutate()}>{t('depositPaid')}</button>
    </div>
  )
}

/** Перенос записи (своей или ребёнка): другой день и время у того же врача; новое время врач подтвердит. */
function RescheduleScreen({ ctx, b }: { ctx: Ctx; b: Booking }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
  // День записи — если он есть в ленте; запись дальше ленты (или в прошлом) — первый день ленты
  const [date, setDate] = useState(() => {
    const days = bookingDays(lang, todayIn(), daysOf(me)).map((d) => d.date)
    const day = dateOf(b.startAt!)
    return days.includes(day) ? day : days[0]!
  })
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState('')
  const slots = useQuery({
    queryKey: ['patient-reschedule-slots', b.id, date],
    queryFn: () => unwrap(api.GET('/api/patient/booking/slots', { params: { query: { date, appointmentId: b.id! } } })),
  })
  const move = useMutation<Booking, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient/booking/reschedule', { body: { startAt: slotInstant(date, minutesOf(chosen)), appointmentId: b.id! } })),
    onSuccess: (moved) => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? patchBooking(old, b.id!, () => moved) : old))
      ctx.go({ name: 'booking', id: b.id! }, t('moved'))
    },
    onError: (e) => {
      haptic('error')
      if (e.code === 'time-taken') {
        setError(t('taken'))
        setChosen('')
        void slots.refetch()
      } else setError(errorText(t, e, ctx.me.clinicContact))
    },
  })
  return (
    <section className="screen">
      <BackButton onBack={() => ctx.go({ name: 'booking', id: b.id! })} />
      <h1>{t('moveTitle')}</h1>
      {b.self === false && <p className="who-line">👤 {b.patientName}</p>}
      <p className="hint">{t('moveNow', { when: whenAt(lang, b.startAt!) })}</p>
      <div className="field"><span>{t('day')}</span>
        <DayStrip t={t} lang={lang} length={daysOf(me)} date={date} onPick={(d) => { setDate(d); setChosen(''); setError('') }} /></div>
      <div className="field"><span>{t('time')}</span>
        {error && <p className="error" role="alert">{error}</p>}
        {slots.isPending ? <p className="hint">{t('loading')}</p> : slots.error ? <p className="error">{errorText(t, slots.error, ctx.me.clinicContact)}</p>
          : <SlotGrid t={t} lang={lang} slots={slots.data} chosen={chosen} onPick={(time) => { setChosen(time); setError('') }}
            empty={slots.data.dayOff ? t('otherDay') : slots.data.workingDay ? t('noFree') : t('dayOff')} />}
      </div>
      <MainButton text={t('move')} busy={move.isPending} onClick={() => (chosen ? move.mutate() : setError(t('pickTime')))} />
    </section>
  )
}

/** Новости клиники: видны всем пациентам клиники; в бот — только если пациент сам включил. */
function NewsScreen({ ctx, back }: { ctx: Ctx; back: Screen }) {
  const { t, lang } = ctx
  const client = useQueryClient()
  const news = useQuery({ queryKey: ['patient-news'], queryFn: () => unwrap(api.GET('/api/patient/news')) })
  const toggle = useMutation<unknown, ApiError, boolean>({
    mutationFn: (subscribed) => unwrap(api.PUT('/api/patient/news/subscription', { body: { subscribed } })),
    onSuccess: () => {
      haptic('success')
      void client.invalidateQueries({ queryKey: ['patient-news'] })
    },
  })
  const d = news.data
  return (
    <section className="screen">
      <BackButton onBack={() => ctx.go(back)} />
      <h1>{t('news')}</h1>
      {news.error && <p className="error">{errorText(t, news.error, ctx.me.clinicContact)}</p>}
      {d && (
        <>
          <p className="hint">{d.subscribed ? t('newsSubscribed') : t('newsOffer')}</p>
          <button type="button" className={d.subscribed ? 'btn' : 'btn primary'} disabled={toggle.isPending}
            onClick={() => toggle.mutate(!d.subscribed)}>{d.subscribed ? t('newsOff') : t('newsOn')}</button>
          {toggle.error && <p className="error" role="alert">{errorText(t, toggle.error, ctx.me.clinicContact)}</p>}
          {d.news?.length ? (
            <ul className="news-list">
              {d.news.map((n, i) => <li key={i} className="news-item"><p className="hint">📰 {n.createdAt ? whenAt(lang, n.createdAt) : ''}</p><p>{n.text}</p></li>)}
            </ul>
          ) : <p className="hint">{t('newsNone')}</p>}
        </>
      )}
    </section>
  )
}

/** Политика обработки данных: кто отвечает, какие данные, зачем, где, права — простыми словами. */
function PrivacyScreen({ ctx, back }: { ctx: Ctx; back: Screen }) {
  const { me, t } = ctx
  const c = me.clinic ?? {}
  const holder = [c.legalName || t('holderDefault'), c.address].filter(Boolean).join(', ')
  const section = (title: string, text: ReactNode) => <><h2>{title}</h2><p>{text}</p></>
  return (
    <section className="screen privacy">
      <BackButton onBack={() => ctx.go(back)} />
      <button type="button" className="link" onClick={() => ctx.go(back)}>{t('back')}</button>
      <h1>{t('privacyTitle')}</h1>
      {section(t('privacyWho'), holder)}
      {section(t('privacyWhat'), t('privacyWhatText'))}
      {section(t('privacyWhy'), t('privacyWhyText'))}
      {section(t('privacyWhere'), t('privacyWhereText'))}
      {section(t('privacyRights'), t('privacyRightsText'))}
      {me.clinicContact && <p>{t('privacyContact', { phone: me.clinicContact })}</p>}
    </section>
  )
}
