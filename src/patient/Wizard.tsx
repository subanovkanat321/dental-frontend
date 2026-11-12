import { useEffect, useState, type ReactNode } from 'react'

import type { Schemas } from '../api/client'
import { groupLabel, groupServices } from '../clinic/services'
import { Loading } from '../layout/Loading'
import { servicesOfDoctor } from '../lib/doctorServices'
import { BackButton } from '../lib/MainButton'
import { textMatches } from '../lib/search'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { dayLong, initials, monthTitle, priceText, serviceEmoji, weekdaysShort, type Lang, type T } from './i18n'
import { SlotGrid } from './SlotPicker'
import { aboutParts, minutesOf } from './slots'

type Slots = Schemas['BookingViewsSlots']
/** Услуга в мастере: и из /api/patient/me (ServiceTypeView), и из /web/booking (без active и recallMonths). */
export type WizardService = Schemas['ServiceTypeView'] | Schemas['WebBookingServiceService']
/** Врач в мастере: и из /api/patient/me (DoctorView), и из /web/booking. */
export type WizardDoctor = { id?: number; fullName?: string | null; about?: string | null; photoUrl?: string | null }

export type Step = 'service' | 'doctor' | 'date' | 'time' | 'contacts'

/** «Любой свободный врач»: время — у всех, кто делает услугу; врача на это время назначит сервер. */
export const ANY = 'any'
type DoctorPick = number | typeof ANY

/** Что выбрано к шагу «Контакты». doctorId null — «любой свободный врач». */
export type Chosen = { service: WizardService; doctorId: number | null; doctor?: WizardDoctor; date: string; time: string; startAt: string }

/** Шаг «Контакты» рисует хозяин мастера (бот и сайт спрашивают разное); мастер его не размонтирует. */
export type ContactsArgs = {
  /** null — пока выбрано не всё (пациент вернулся «Изменить») */
  chosen: Chosen | null
  /** шаг «Контакты» на экране — только тогда своя кнопка «Записаться» внизу */
  active: boolean
  /** сервер ответил «время заняли» (409): к шагу «Время» со свежей сеткой */
  onTaken: () => void
}

type Loaded<V> = { ok: true; value: V } | { ok: false; error: unknown }

/** Ответ на ключ (врач, услуга, день…): пока ответа на этот ключ нет — 'loading', старый не показываем. */
function useLoad<V>(key: string | null, load: () => Promise<V>): Loaded<V> | 'loading' | null {
  const [state, setState] = useState<{ key: string; value: Loaded<V> } | null>(null)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    load().then((value) => { if (!cancelled) setState({ key, value: { ok: true, value } }) },
      (error: unknown) => { if (!cancelled) setState({ key, value: { ok: false, error } }) })
    return () => { cancelled = true }
    // key собран из всего, от чего зависит ответ, — по нему и перезапрос
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!key) return null
  return state?.key === key ? state.value : 'loading'
}

/** Услуг столько и больше — над списком поиск. */
const SEARCH_FROM = 8

/**
 * Пошаговая запись (как у хороших онлайн-записей): Услуга → Врач → Дата → Время → Контакты.
 * Сверху — шаги, «‹ Назад» (и «Назад» Telegram) на каждом шаге; с второго шага — «Ваша запись» с
 * «Изменить» у каждой строки. Услуга одна — шага услуги нет; врач для услуги один — нет шага врача.
 * Смена выбора сбрасывает только зависимое: другая услуга или врач — время (длительность и сетка
 * другие), врач, который эту услугу не делает, — и врача; день — время.
 * Общий для записи в Telegram (PatientApp) и на сайте без Telegram (site/WebBooking): разные у них
 * только запросы и шаг «Контакты».
 */
export function BookingWizard({ t, lang, services, doctors, doctorServices, length, initialDoctor, loadFreeDays, loadSlots,
  noneSoon, errorText, intro, outro, onExit, contacts }: {
  t: T; lang: Lang; services: WizardService[]; doctors: WizardDoctor[]; doctorServices?: Schemas['DoctorServicesView'][] | null
  /** сколько дней в календаре (daysAhead и сегодня) */
  length: number
  /** «Записаться снова» к этому врачу (?doctor=ID) */
  initialDoctor?: number | null
  loadFreeDays: (doctorId: number | null, serviceTypeId: number) => Promise<string[]>
  loadSlots: (date: string, doctorId: number | null, serviceTypeId: number) => Promise<Slots>
  /** «В ближайшие дни свободного времени нет. Позвоните…» */
  noneSoon: string
  errorText: (e: unknown) => string
  /** над первым шагом (шапка клиники) и под ним (адрес, новости) */
  intro?: ReactNode
  outro?: ReactNode
  /** «Назад» с первого шага; null — некуда */
  onExit?: (() => void) | null
  contacts: (args: ContactsArgs) => ReactNode
}) {
  const links = doctorServices ?? undefined
  const doesService = (d: WizardDoctor, s: WizardService) => servicesOfDoctor(services, links, d.id).some((x) => x.id === s.id)
  // Услуга, которую не делает ни один врач, — не показываем: записаться на неё нельзя
  const offered = services.filter((s) => doctors.some((d) => doesService(d, s)))
  const [service, setService] = useState<WizardService | null>(null)
  const [doctor, setDoctor] = useState<DoctorPick | null>(() => (doctors.some((d) => d.id === initialDoctor) ? initialDoctor! : null))
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [step, setStep] = useState<Step | null>(null)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')

  // Ни услуг, ни врачей для них — записаться не на что: «позвоните в клинику»
  const empty = !offered.length
  const svc = service ?? (offered.length === 1 ? offered[0]! : null)
  const eligible = svc ? doctors.filter((d) => doesService(d, svc)) : doctors
  const doc: DoctorPick | null = eligible.length === 1 ? eligible[0]!.id!
    : doctor === ANY || eligible.some((d) => d.id === doctor) ? doctor : null
  const doctorId = doc === ANY ? null : doc
  const steps = (['service', 'doctor', 'date', 'time', 'contacts'] as Step[])
    .filter((s) => (s === 'service' ? offered.length > 1 : s === 'doctor' ? eligible.length > 1 : true))
  const missing: Step = !svc ? 'service' : doc == null ? 'doctor' : !date ? 'date' : !time ? 'time' : 'contacts'
  // Шаг — выбранный «Назад» или «Изменить», но не дальше первого невыбранного
  const current: Step = step && steps.includes(step) && steps.indexOf(step) <= steps.indexOf(missing) ? step : missing
  const index = steps.indexOf(current)

  useEffect(() => {
    try {
      window.scrollTo({ top: 0 })
    } catch {
      // jsdom и старые браузеры
    }
  }, [current])

  const freeKey = svc && doc != null ? `${svc.id}|${doc}|${reload}` : null
  const free = useLoad(freeKey, () => loadFreeDays(doctorId, svc!.id))
  const slotsKey = svc && doc != null && date ? `${svc.id}|${doc}|${date}|${reload}` : null
  const slots = useLoad(slotsKey, () => loadSlots(date, doctorId, svc!.id))
  const freeDays = free && free !== 'loading' && free.ok ? free.value : null

  const go = (next: Step | null) => {
    setStep(next)
    setNotice('')
  }
  const back = index > 0 ? () => go(steps[index - 1]!) : onExit ?? null

  const pickService = (s: WizardService) => {
    if (s.id !== svc?.id) {
      setService(s)
      setTime('')
      if (typeof doctor === 'number' && !doctors.some((d) => d.id === doctor && doesService(d, s))) setDoctor(null)
    }
    go(null)
  }
  const pickDoctor = (d: DoctorPick) => {
    if (d !== doc) {
      setDoctor(d)
      setTime('')
    }
    go(null)
  }
  const pickDate = (d: string) => {
    if (d !== date) {
      setDate(d)
      setTime('')
    }
    go(null)
  }
  const pickTime = (tm: string) => {
    setTime(tm)
    go(null)
  }
  const onTaken = () => {
    setTime('')
    setReload((n) => n + 1)
    setStep('time')
    setNotice(t('taken'))
  }

  const chosenDoctor = typeof doc === 'number' ? doctors.find((d) => d.id === doc) : undefined
  const chosen: Chosen | null = svc && doc != null && date && time
    ? { service: svc, doctorId, doctor: chosenDoctor, date, time, startAt: slotInstant(date, minutesOf(time)) }
    : null
  const label: Record<Step, string> = {
    service: t('wizStepService'), doctor: t('wizStepDoctor'), date: t('wizStepDate'), time: t('wizStepTime'), contacts: t('wizStepContacts'),
  }
  const title: Record<Step, string> = {
    service: t('wizServiceTitle'), doctor: t('wizDoctorTitle'), date: t('wizDateTitle'), time: t('wizTimeTitle'), contacts: t('wizContactsTitle'),
  }

  if (empty) {
    return (
      <section className="screen wizard">
        <BackButton onBack={onExit ?? null} />
        {intro}
        <p className="hint" role="status">{t('unavailable')}</p>
        {outro}
      </section>
    )
  }

  return (
    <section className="screen wizard">
      <BackButton onBack={back} />
      {index === 0 && intro}
      <nav className="wiz-steps" aria-label={t('wizStep', { n: index + 1, total: steps.length })}>
        <div className="wiz-steps-top">
          {back ? <button type="button" className="link wiz-back" onClick={back}>{t('back')}</button> : <span />}
          <span className="wiz-count">{t('wizStep', { n: index + 1, total: steps.length })}</span>
        </div>
        <ol className="wiz-progress">
          {steps.map((s, i) => (
            <li key={s} className={i < index ? 'done' : i === index ? 'current' : undefined} aria-current={i === index ? 'step' : undefined}>
              <span className="wiz-bar" aria-hidden="true" />
              <span className="wiz-label">{label[s]}</span>
            </li>
          ))}
        </ol>
      </nav>
      <h2 className="wiz-title">{title[current]}</h2>

      {index > 0 && (
        <Summary t={t} lang={lang} steps={steps} svc={svc} doc={doc} doctor={chosenDoctor} date={date} time={time}
          onChange={(s) => go(s)} />
      )}

      {current === 'service' && (
        <ServiceStep t={t} lang={lang} services={offered} chosen={svc} query={query} onQuery={setQuery} onPick={pickService} />
      )}
      {current === 'doctor' && <DoctorStep t={t} doctors={eligible} chosen={doc} onPick={pickDoctor} />}
      {current === 'date' && (
        free === 'loading' || !free ? <Loading text={t('loading')} offlineText={t('offlineWait')} />
          : !free.ok ? <p className="error" role="alert">{errorText(free.error)}</p>
            : !free.value.length ? <p className="hint" role="status">{noneSoon}</p>
              : <Calendar t={t} lang={lang} length={length} free={free.value} chosen={date} onPick={pickDate} />
      )}
      {current === 'time' && (
        <div className="wiz-time">
          <DayNav t={t} lang={lang} date={date} freeDays={freeDays} onPick={pickDate} />
          {notice && <p className="error" role="alert">{notice}</p>}
          {slots === 'loading' || !slots ? <Loading text={t('loading')} offlineText={t('offlineWait')} />
            : !slots.ok ? <p className="error" role="alert">{errorText(slots.error)}</p>
              : <SlotGrid t={t} lang={lang} slots={slots.value} chosen={time} onPick={pickTime}
                empty={slots.value.dayOff ? t('otherDay') : slots.value.workingDay ? t('noFree') : t('dayOff')} />}
          {/* День без свободного времени — одним нажатием к ближайшему свободному, а не листать */}
          {slots && slots !== 'loading' && slots.ok && !slots.value.starts?.length && freeDays?.some((d) => d !== date) && (
            <button type="button" className="btn" onClick={() => pickDate(freeDays.find((d) => d > date) ?? freeDays[0]!)}>{t('nearestFree')}</button>
          )}
        </div>
      )}
      <div className="wiz-contacts" hidden={current !== 'contacts'}>
        {contacts({ chosen, active: current === 'contacts', onTaken })}
      </div>
      {index === 0 && outro}
    </section>
  )
}

/** «Ваша запись»: услуга, врач, дата, время — у каждой строки «Изменить» (кроме того, что выбрано само). */
function Summary({ t, lang, steps, svc, doc, doctor, date, time, onChange }: {
  t: T; lang: Lang; steps: Step[]; svc: WizardService | null; doc: DoctorPick | null; doctor?: WizardDoctor
  date: string; time: string; onChange: (s: Step) => void
}) {
  const row = (step: Step, icon: ReactNode, what: string, value: ReactNode, extra?: ReactNode) => (
    <div className="wiz-row" key={step}>
      <span className="wiz-row-icon" aria-hidden="true">{icon}</span>
      <div className="wiz-row-text"><span className="wiz-row-label">{what}</span><span className="wiz-row-value">{value}</span>{extra}</div>
      {steps.includes(step) && (
        <button type="button" className="link wiz-change" aria-label={t('wizChangeWhat', { what: what.toLowerCase() })} onClick={() => onChange(step)}>{t('wizChange')}</button>
      )}
    </div>
  )
  const price = svc ? priceText(lang, svc.priceSom) : null
  return (
    <section className="wiz-summary" aria-label={t('wizSummary')}>
      <h3>{t('wizSummary')}</h3>
      {svc && row('service', serviceEmoji(svc.name), t('wizStepService'), svc.name,
        <span className="wiz-row-meta num">{[price, svc.durationMinutes ? `${svc.durationMinutes} ${t('min')}` : ''].filter(Boolean).join(' · ')}</span>)}
      {doc != null && row('doctor', '👩‍⚕️', t('wizStepDoctor'), doc === ANY ? t('anyDoctorShort') : doctor?.fullName ?? '')}
      {date && row('date', '📅', t('wizStepDate'), dayLong(lang, date))}
      {time && row('time', '🕐', t('wizStepTime'), <span className="num">{time}</span>)}
    </section>
  )
}

/** Услуги по разделам (V169), крупными строками: значок, название, длительность, цена «от». Много — поиск. */
function ServiceStep({ t, lang, services, chosen, query, onQuery, onPick }: {
  t: T; lang: Lang; services: WizardService[]; chosen: WizardService | null; query: string; onQuery: (q: string) => void
  onPick: (s: WizardService) => void
}) {
  // Раскрыт раздел выбранной услуги (вернулись по «Изменить»), иначе — ни один
  const [openGroup, setOpenGroup] = useState<string | null>(() => (chosen ? (chosen.group ?? 'OTHER') : null))
  if (!services.length) return <p className="hint">{t('unavailable')}</p>
  const shown = services.filter((s) => textMatches(s.name, query))
  const groups = groupServices(shown)
  const card = (s: WizardService) => (
    <button key={s.id} type="button" className="wiz-card service" aria-pressed={chosen?.id === s.id} onClick={() => onPick(s)}>
      <span className="svc-emoji" aria-hidden="true">{serviceEmoji(s.name)}</span>
      <span className="wiz-card-text">
        <strong>{s.name}</strong>
        {s.durationMinutes ? <span className="hint num">⏱ {s.durationMinutes} {t('min')}</span> : null}
      </span>
      {priceText(lang, s.priceSom) && <span className="price num">{priceText(lang, s.priceSom)}</span>}
    </button>
  )
  return (
    <div className="wiz-list">
      {services.length >= SEARCH_FROM && (
        <input type="search" className="wiz-search" aria-label={t('serviceSearch')} placeholder={`🔍 ${t('serviceSearch')}`}
          value={query} onChange={(e) => onQuery(e.target.value)} />
      )}
      {!shown.length && (
        <div className="empty-filter">
          <p className="hint">{t('serviceNone')}</p>
          <button type="button" className="btn" onClick={() => onQuery('')}>{t('serviceAll')}</button>
        </div>
      )}
      {groups.length > 1 && !query.trim() ? (
        // Много разделов: сначала только разделы (с числом услуг), нажали — раскрылся один
        groups.map(({ group, items }) => <ServiceFold key={group} label={groupLabel(group, lang)} count={items.length}
          open={openGroup === group} onToggle={() => setOpenGroup(openGroup === group ? null : group)}>{items.map(card)}</ServiceFold>)
      ) : groups.length > 1 ? groups.map(({ group, items }) => (
        // Поиск: найденное — по разделам, раскрыто
        <div key={group} className="wiz-group" role="group" aria-label={groupLabel(group, lang)}>
          <h3>{groupLabel(group, lang)}</h3>
          {items.map(card)}
        </div>
      )) : shown.map(card)}
    </div>
  )
}

/** Раздел услуг: заголовок-кнопка «Терапия · 5 ›», раскрыт — услуги под ним. */
function ServiceFold({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`wiz-fold${open ? ' open' : ''}`} role="group" aria-label={label}>
      <button type="button" className="wiz-fold-head" aria-expanded={open} onClick={onToggle}>
        <strong>{label}</strong>
        <span className="hint num">{count} <span className="chevron" aria-hidden="true">{open ? '▾' : '›'}</span></span>
      </button>
      {open && <div className="wiz-fold-body">{children}</div>}
    </div>
  )
}

/** Врачи карточками: фото, специальность, о себе; первым — «Любой свободный врач». */
function DoctorStep({ t, doctors, chosen, onPick }: { t: T; doctors: WizardDoctor[]; chosen: DoctorPick | null; onPick: (d: DoctorPick) => void }) {
  if (!doctors.length) return <p className="hint">{t('unavailable')}</p>
  return (
    <div className="wiz-list">
      <button type="button" className="wiz-card doctor any" aria-pressed={chosen === ANY} onClick={() => onPick(ANY)}>
        <span className="wiz-avatar" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={36} height={36} /></span>
        <span className="wiz-card-text"><strong>{t('anyDoctor')}</strong><span className="hint">{t('anyDoctorSub')}</span></span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
      {doctors.map((d) => {
        const { specialty, rest } = aboutParts(d.about)
        return (
          <button key={d.id} type="button" className="wiz-card doctor" aria-pressed={chosen === d.id} onClick={() => onPick(d.id!)}>
            {d.photoUrl ? <img className="wiz-avatar" src={d.photoUrl} alt="" width={56} height={56} />
              : <span className="wiz-avatar" aria-hidden="true">{initials(d.fullName ?? '')}</span>}
            <span className="wiz-card-text">
              <strong>{d.fullName}</strong>
              {specialty && <span className="wiz-specialty">{specialty}</span>}
              {rest && <span className="hint wiz-about">{rest}</span>}
            </span>
            <span className="chevron" aria-hidden="true">›</span>
          </button>
        )
      })}
    </div>
  )
}

/** День недели с понедельника: 0 — пн … 6 — вс. */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

/**
 * Календарь на столько дней, на сколько можно записаться: по месяцам, неделя с понедельника; дни без
 * свободного времени приглушены и не нажимаются. Сверху — «Ближайшее свободное» одним нажатием.
 */
function Calendar({ t, lang, length, free, chosen, onPick }: {
  t: T; lang: Lang; length: number; free: string[]; chosen: string; onPick: (d: string) => void
}) {
  const today = todayIn()
  const days = Array.from({ length }, (_, i) => addDays(today, i))
  const months: string[][] = []
  for (const d of days) {
    const last = months[months.length - 1]
    if (last && last[0]!.slice(0, 7) === d.slice(0, 7)) last.push(d)
    else months.push([d])
  }
  const freeSet = new Set(free)
  return (
    <div className="wiz-calendar">
      <button type="button" className="btn wiz-nearest" onClick={() => onPick(free[0]!)}>
        {t('nearestDay', { day: lang === 'ru' ? dayLong(lang, free[0]!).toLowerCase() : dayLong(lang, free[0]!) })}
      </button>
      {months.map((month) => (
        <div key={month[0]} className="cal-month" role="group" aria-label={monthTitle(lang, month[0]!)}>
          <h3>{monthTitle(lang, month[0]!)}</h3>
          <div className="cal-grid">
            {weekdaysShort(lang).map((w) => <span key={w} className="cal-weekday" aria-hidden="true">{w}</span>)}
            {Array.from({ length: weekday(month[0]!) }, (_, i) => <span key={`pad${i}`} />)}
            {month.map((d) => {
              const open = freeSet.has(d)
              return (
                <button key={d} type="button" className={d === today ? 'cal-day today' : 'cal-day'} disabled={!open}
                  aria-pressed={d === chosen} aria-label={open ? dayLong(lang, d) : `${dayLong(lang, d)} — ${t('dayFull')}`}
                  onClick={() => onPick(d)}>
                  {Number(d.slice(8))}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Над сеткой времени: выбранный день и стрелки к соседним свободным дням. */
function DayNav({ t, lang, date, freeDays, onPick }: { t: T; lang: Lang; date: string; freeDays: string[] | null; onPick: (d: string) => void }) {
  const prev = freeDays ? [...freeDays].reverse().find((d) => d < date) : undefined
  const next = freeDays?.find((d) => d > date)
  return (
    <div className="day-nav">
      <button type="button" className="day-nav-arrow" aria-label={t('prevDay')} disabled={!prev} onClick={() => prev && onPick(prev)}>‹</button>
      <strong className="day-nav-title">{dayLong(lang, date)}</strong>
      <button type="button" className="day-nav-arrow" aria-label={t('nextDay')} disabled={!next} onClick={() => next && onPick(next)}>›</button>
    </div>
  )
}
