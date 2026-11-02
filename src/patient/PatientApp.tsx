import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { groupByCategory } from '../clinic/services'
import { servicesOfDoctor } from '../lib/doctorServices'
import { formatPhone, slotInstant, timeOf, todayIn, ZONE } from '../lib/time'
import { haptic, openLink, telegram } from '../lib/telegram'
import { useBlobUrl } from '../lib/useBlobUrl'
import { launchSearch } from '../lib/deepLink'
import { ClinicFilters } from '../lib/ClinicFilters'
import { ContactLinks } from '../lib/ContactLinks'
import { useClinicFilter, withCity } from '../lib/clinicSearch'
import { BackButton, MainButton } from '../lib/MainButton'
import { bookingDays, breakNote, initials, normalizeLang, priceText, serviceEmoji, translator, whenAt, type Lang, type T } from './i18n'
import './patient.css'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorView']
type Service = Schemas['ServiceTypeView']
type Slots = Schemas['BookingViewsSlots']

type Screen =
  | { name: 'clinics'; back: Screen | null }
  | { name: 'doctors' }
  | { name: 'book'; doctorId: number }
  | { name: 'booking' }
  | { name: 'reschedule' }
  | { name: 'news'; back: Screen }
  | { name: 'privacy'; back: Screen }

/** go и reload — с подтверждением что вышло («Запись отменена»): без него экран просто сменился, и непонятно, получилось ли. */
type Ctx = { me: Me; t: T; lang: Lang; go: (s: Screen, notice?: string) => void; reload: (notice?: string) => void; screen: Screen }

const dateOf = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))

/**
 * С какого экрана начать: клиник несколько и не выбрана — выбор клиники; есть запись — «Ваша
 * запись» (кнопка бота «Перенести» — ?screen=reschedule); «Записаться снова» — ?doctor=ID; один врач —
 * сразу запись к нему; иначе — выбор врача.
 */
function firstScreen(me: Me): Screen {
  if (me.clinicChoices?.length) return { name: 'clinics', back: null }
  const params = new URLSearchParams(launchSearch())
  const doctors = me.doctors ?? []
  const again = doctors.find((d) => d.id === Number(params.get('doctor')))
  if (me.booking && params.get('screen') === 'reschedule') return { name: 'reschedule' }
  if (me.booking) return { name: 'booking' }
  if (again) return { name: 'book', doctorId: again.id! }
  if (doctors.length === 1) return { name: 'book', doctorId: doctors[0]!.id! }
  return { name: 'doctors' }
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

/** Сколько дней в ленте: столько, на сколько вперёд сервер даёт записаться (daysAhead и сегодня); нет — две недели. */
function stripLength(me: Me): number {
  return me.daysAhead ? Math.min(me.daysAhead + 1, 62) : 14
}

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
  if (me.clinic?.settingUp && !me.booking) {
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

  return (
    <div className="patient">
      {current.name !== 'privacy' && <LangSwitch lang={lang} onChange={setLang} />}
      {notice && <p className="notice tone-ok" role="status">{notice}</p>}
      {me.elsewhere?.booking?.startAt && current.name !== 'privacy' && current.name !== 'clinics' && <Elsewhere ctx={ctx} />}
      {current.name === 'clinics' && <ClinicsScreen ctx={ctx} back={current.back} />}
      {current.name === 'doctors' && <DoctorsScreen ctx={ctx} />}
      {current.name === 'book' && doctor && <BookScreen key={doctor.id} ctx={ctx} doctor={doctor} />}
      {current.name === 'book' && !doctor && <DoctorsScreen ctx={ctx} />}
      {current.name === 'booking' && me.booking && <BookingScreen ctx={ctx} />}
      {current.name === 'reschedule' && me.booking && <RescheduleScreen ctx={ctx} />}
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

/**
 * Свободное и занятое время одной сеткой по порядку: занятое — серым «занято», его не нажать.
 * Перерывы и выходной — подписью над сеткой, чтобы было понятно, куда делось время.
 */
function SlotGrid({ ctx, slots, chosen, onPick, empty }: { ctx: Ctx; slots: Slots; chosen: string; onPick: (time: string) => void; empty: string }) {
  const { t, lang } = ctx
  const notes = [...(slots.breaks ?? []), ...(slots.dayOff ? [slots.dayOff] : [])]
  const cells = [
    ...(slots.starts ?? []).map((s) => ({ at: s, free: true })),
    ...(slots.taken ?? []).map((s) => ({ at: s, free: false })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <div className="slots" role="group" aria-label={t('freeTime')}>
      {notes.map((b, i) => <div key={i} className="break-note">{breakNote(lang, b)}</div>)}
      {slots.starts?.length ? cells.map(({ at, free }) => free ? (
        <button key={at} type="button" className="slot time" aria-pressed={timeOf(at) === chosen} onClick={() => onPick(timeOf(at))}>{timeOf(at)}</button>
      ) : (
        <button key={at} type="button" className="slot time taken" disabled aria-label={`${timeOf(at)} — ${t('busySlot')}`}>{timeOf(at)}<small>{t('busySlot')}</small></button>
      )) : <div className="hint">{empty}</div>}
    </div>
  )
}

function DayStrip({ ctx, date, onPick }: { ctx: Ctx; date: string; onPick: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed=true]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [date])
  return (
    <div ref={ref} className="days" role="group" aria-label={ctx.t('day')}>
      {bookingDays(ctx.lang, todayIn(), stripLength(ctx.me)).map((d) => (
        <button key={d.date} type="button" className="day" aria-pressed={d.date === date} onClick={() => onPick(d.date)}>{d.label}</button>
      ))}
    </div>
  )
}

/** Запись: услуга → день → время → имя, телефон из Telegram, согласие → «Записаться». */
function BookScreen({ ctx, doctor }: { ctx: Ctx; doctor: Doctor }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
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
  const days = bookingDays(lang, todayIn(), stripLength(me)).map((d) => d.date)

  // Пока день не выбран сам — первый день со свободным временем (сегодня мест нет — завтра и т. д.);
  // две недели пусто — сказать, что делать. Перебор — в одном запросе, без мигания пустых сеток
  const slots = useQuery({
    queryKey: ['patient-slots', doctor.id, service?.id, dateTouched ? date : 'first-free'],
    queryFn: async () => {
      const load = (d: string) => unwrap(api.GET('/api/patient/slots', { params: { query: { date: d, doctorId: doctor.id!, serviceTypeId: service!.id! } } }))
      if (dateTouched) return { date, slots: await load(date), noneSoon: false }
      // По неделе за раз, параллельно (а не 14–30 запросов друг за другом); первый день со
      // свободным временем — по порядку дней, а не какой ответ пришёл раньше
      let first: Slots | undefined
      for (let i = 0; i < days.length; i += WEEK) {
        const batch = days.slice(i, i + WEEK)
        const found = await Promise.all(batch.map(load))
        first ??= found[0]
        const free = found.findIndex((x) => x.starts?.length)
        if (free >= 0) return { date: batch[free]!, slots: found[free]!, noneSoon: false }
      }
      return { date: days[0]!, slots: first ?? await load(days[0]!), noneSoon: true }
    },
    enabled: service != null,
  })
  const shownDate = dateTouched ? date : slots.data?.date ?? date

  const missing = !service ? 'service' : !chosen ? 'time' : !name.trim() || !phone || !consent ? 'data' : null
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
        promoCode: promo.trim() || undefined },
    })),
    onSuccess: (booking) => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? { ...old, booking, phone } : old))
      ctx.go({ name: 'booking' })
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
          promo: own('promoCode', 'promoInvalid') }
        if (next.promo) setPromoOpen(true)
        setErrors(Object.values(next).some(Boolean) ? next : { form: errorText(t, e, me.clinicContact) })
      }
    },
  })

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
    else if (!name.trim()) setErrors({ name: t('nameRequired') })
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
      <span aria-hidden="true">{serviceEmoji(s.name)} </span>{s.name}
      <span className="sr-only"> · {s.durationMinutes} {t('min')}</span>
      <span className="dur" aria-hidden="true">⏱ {s.durationMinutes} {t('min')}</span>
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
          <DayStrip ctx={ctx} date={shownDate} onPick={(d) => { setDate(d); setDateTouched(true); setChosen(''); setErrors({}) }} />
        </div>
        <div className="field"><span>{t('time')}</span>
          {errors.time && <p className="error" role="alert">{errors.time}</p>}
          {!service ? <p className="hint">{t('pickServiceFirst')}</p>
            : slots.isPending ? <p className="hint">{t('loading')}</p>
              : slots.error ? <p className="error">{errorText(t, slots.error, ctx.me.clinicContact)}</p>
                : slots.data.noneSoon ? <p className="hint">{t('noFreeSoon')} {callText(t, me.clinicContact)}</p>
                  : <SlotGrid ctx={ctx} slots={slots.data.slots} chosen={chosen}
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
        <label className="field"><span>{t('patientName')}</span>
          <input value={name} maxLength={200} autoComplete="name" enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} onChange={(e) => { setName(e.target.value); setErrors({}) }} /></label>
        {errors.name && <p className="error">{errors.name}</p>}
        <div className="field"><span>{t('phone')}</span>
          {phone ? (
            <div className="picked">{formatPhone(phone)}<br /><span className="hint">{t('phoneFromTelegram')}</span></div>
          ) : <button type="button" className="btn" disabled={sharing} onClick={sharePhone}>{sharing ? t('gettingPhone') : t('sharePhone')}</button>}
        </div>
        {errors.phone && <p className="error">{errors.phone}</p>}
        <label className="field"><span>{t('comment')}</span>
          <textarea rows={2} maxLength={500} placeholder={t('commentHint')} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        <PromoField ctx={ctx} value={promo} open={promoOpen} error={errors.promo}
          onOpen={() => setPromoOpen(true)} onChange={(v) => { setPromo(v); setErrors({}) }} />
        {(me.sourceChoices ?? []).length > 0 && (
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
          {' '}{t('consent', { holder: me.clinic?.legalName || t('holderDefault') })}</label>
        <button type="button" className="link privacy-link" onClick={() => ctx.go({ name: 'privacy', back: ctx.screen })}>{t('privacy')}</button>
        {errors.consent && <p className="error">{errors.consent}</p>}
      </section>
      {errors.form && <p className="error" role="alert">{errors.form}</p>}
      <Footer ctx={ctx} />
      <MainButton busy={book.isPending} onClick={next}
        text={missing === 'service' ? t('nextService') : missing === 'time' ? t('nextTime') : missing === 'data' ? t('nextData') : t('book')} />
    </section>
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

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

/** Сколько дней спрашивать за раз при поиске первого свободного дня. */
const WEEK = 7

const STATUS: Record<string, string> = { REQUESTED: 'requested', SCHEDULED: 'scheduled' }

/** «Ваша запись»: когда, что, подтверждена ли; предоплата, «хочу раньше», перенести, отменить. */
function BookingScreen({ ctx }: { ctx: Ctx }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
  const b = me.booking!
  const doctor = (me.doctors ?? []).find((d) => d.id === b.doctorId)
  const [sure, setSure] = useState(false)
  // «Точно отменить?» — ненадолго: через 5 секунд кнопка снова обычная, случайное второе нажатие позже не отменит
  useEffect(() => {
    if (!sure) return
    const timer = setTimeout(() => setSure(false), 5000)
    return () => clearTimeout(timer)
  }, [sure])
  const cancel = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient/booking/cancel')),
    onSuccess: () => {
      haptic('success')
      // Сразу без записи (а не «Ваша запись» с «Запись отменена», пока me не пришёл заново)
      client.setQueryData<Me>(['me'], (old) => (old ? { ...old, booking: undefined, waiting: false } : old))
      ctx.reload(t('cancelled'))
    },
  })
  const waitlist = useMutation<unknown, ApiError, boolean>({
    mutationFn: (join) => unwrap(join ? api.POST('/api/patient/waitlist') : api.DELETE('/api/patient/waitlist')),
    onSuccess: (_r, join) => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? { ...old, waiting: join } : old))
    },
  })
  const error = cancel.error ?? waitlist.error
  return (
    <section className="screen">
      <BackButton onBack={null} />
      <Hero t={t} title={t('yourBooking')} subtitle={t('waitingYou')} doctor={doctor ?? { fullName: b.doctorName }} />
      <div className="booking-card">
        <p className="big">📅 {whenAt(lang, b.startAt!)}</p>
        <div>{serviceEmoji(b.serviceName)} {b.serviceName || t('defaultService')}</div>
        {b.comment && <p className="hint booking-comment">💬 {b.comment}</p>}
        {b.promoCode && <p className="hint">🎟 {t('promoBooking', { code: b.promoCode })}</p>}
        <p><span className={b.status === 'SCHEDULED' ? 'status tone-ok' : 'status tone-wait'}>{STATUS[b.status ?? ''] ? t(STATUS[b.status!]!) : b.status}</span></p>
      </div>
      {b.depositStatus && <PatientDeposit ctx={ctx} />}
      <button type="button" className="btn" onClick={() => ctx.go({ name: 'reschedule' })}><span aria-hidden="true">🗓️ </span>{t('moveOther')}</button>
      {me.waiting ? (
        <div className="waitlist-on">
          <p className="hint">{t('waitlistOn')}</p>
          <button type="button" className="link" disabled={waitlist.isPending} onClick={() => waitlist.mutate(false)}>{t('waitlistLeave')}</button>
        </div>
      ) : <button type="button" className="btn" disabled={waitlist.isPending} onClick={() => waitlist.mutate(true)}><span aria-hidden="true">🔔 </span>{t('waitlistJoin')}</button>}
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
function PatientDeposit({ ctx }: { ctx: Ctx }) {
  const { me, t } = ctx
  const client = useQueryClient()
  const b = me.booking!
  const sum = new Intl.NumberFormat('ru-RU').format(b.depositSom ?? 0)
  const asked = b.depositStatus !== 'RECEIVED' && b.depositStatus !== 'REPORTED'
  const info = useQuery({ queryKey: ['patient-deposit'], queryFn: () => unwrap(api.GET('/api/patient/deposit')), enabled: asked })
  const qr = useBlobUrl(asked && info.data?.hasQr ? '/api/patient/deposit/qr' : null)
  const [file, setFile] = useState<File | null>(null)
  const paid = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body = new FormData()
      if (file) body.append('file', file)
      return upload('/api/patient/deposit/report', body)
    },
    onSuccess: () => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old?.booking ? { ...old, booking: { ...old.booking, depositStatus: 'REPORTED' } } : old))
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

/** Перенос своей записи: другой день и время у того же врача; новое время врач подтвердит. */
function RescheduleScreen({ ctx }: { ctx: Ctx }) {
  const { me, t, lang } = ctx
  const client = useQueryClient()
  const b = me.booking!
  // День записи — если он есть в ленте; запись дальше ленты (или в прошлом) — первый день ленты
  const [date, setDate] = useState(() => {
    const days = bookingDays(lang, todayIn(), stripLength(me)).map((d) => d.date)
    const day = dateOf(b.startAt!)
    return days.includes(day) ? day : days[0]!
  })
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState('')
  const slots = useQuery({
    queryKey: ['patient-reschedule-slots', date],
    queryFn: () => unwrap(api.GET('/api/patient/booking/slots', { params: { query: { date } } })),
  })
  const move = useMutation<Schemas['BookingViewsBooking'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient/booking/reschedule', { body: { startAt: slotInstant(date, minutesOf(chosen)) } })),
    onSuccess: (booking) => {
      haptic('success')
      client.setQueryData<Me>(['me'], (old) => (old ? { ...old, booking } : old))
      ctx.go({ name: 'booking' }, t('moved'))
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
      <BackButton onBack={() => ctx.go({ name: 'booking' })} />
      <h1>{t('moveTitle')}</h1>
      <p className="hint">{t('moveNow', { when: whenAt(lang, b.startAt!) })}</p>
      <div className="field"><span>{t('day')}</span>
        <DayStrip ctx={ctx} date={date} onPick={(d) => { setDate(d); setChosen(''); setError('') }} /></div>
      <div className="field"><span>{t('time')}</span>
        {error && <p className="error" role="alert">{error}</p>}
        {slots.isPending ? <p className="hint">{t('loading')}</p> : slots.error ? <p className="error">{errorText(t, slots.error, ctx.me.clinicContact)}</p>
          : <SlotGrid ctx={ctx} slots={slots.data} chosen={chosen} onPick={(time) => { setChosen(time); setError('') }}
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
