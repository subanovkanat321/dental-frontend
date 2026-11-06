import { useEffect, useRef, useState } from 'react'

import type { Schemas } from '../api/client'
import { groupByCategory } from '../clinic/services'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ContactLinks } from '../lib/ContactLinks'
import { servicesOfDoctor } from '../lib/doctorServices'
import { slotInstant, todayIn } from '../lib/time'
import { bookingDays, initials, priceText, serviceEmoji, translator, whenAt, type Lang, type T } from '../patient/i18n'
import { DayStrip, SlotGrid } from '../patient/SlotPicker'
import { firstFree, minutesOf, stripLength } from '../patient/slots'
import '../patient/patient.css'
import { getJson, postJson, type SiteProblem, type WebBooked, type WebBookingInfo } from './web'
import { Loading } from '../layout/Loading'

type Slots = Schemas['BookingViewsSlots']
type Service = WebBookingInfo['services'][number]
type Found = { date: string; slots: Slots; noneSoon: boolean } | 'error'

/** Адрес открытого API записи с кодом клиники (/c/<код>); кода нет — клиника №1, как у страницы клиники. */
function url(path: string, code: string | null, params: Record<string, string | number> = {}): string {
  const query = new URLSearchParams(Object.entries({ ...(code ? { code } : {}), ...params }).map(([k, v]) => [k, String(v)]))
  const q = query.toString()
  return q ? `${path}?${q}` : path
}

/** Чат WhatsApp клиники с готовым текстом. */
function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

/** «Позвоните в клинику: …» на языке страницы. */
function callText(t: T, phones?: string[] | null): string {
  return phones?.length ? t('callClinic', { phone: phones.map((p) => `+${p}`).join(', ') }) : t('contactClinic')
}

/**
 * Запись на сайте без Telegram (/c/<код>#book) — для тех, у кого Telegram нет (часто пожилые):
 * врач (если несколько) → услуга → день → время → имя, телефон, согласие → «Записаться». Заявку
 * клиника подтверждает звонком. Лента дней, сетка времени и тексты — общие с записью в Telegram.
 * Имя и комментарий — без React-состояния (читаются при отправке): во встроенном браузере Instagram
 * клавиатура закрывалась от перерисовок во время набора (как в форме /join).
 */
export default function WebBooking({ code, lang, onClose }: { code: string | null; lang: Lang; onClose: () => void }) {
  const t = translator(lang)
  const [info, setInfo] = useState<WebBookingInfo | null | 'error'>(null)
  const [pickedDoctor, setDoctorId] = useState<number | null>(null)
  const [pickedService, setService] = useState<Service | null>(null)
  const [date, setDate] = useState(todayIn())
  const [dateTouched, setDateTouched] = useState(false)
  // Ответ о свободном времени — вместе с тем, на что он: врач, услуга, день (иначе показали бы старый)
  const [found, setFound] = useState<{ key: string; value: Found } | null>(null)
  const [reload, setReload] = useState(0)
  const [chosen, setChosen] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [booked, setBooked] = useState<WebBooked | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [commentOpen, setCommentOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const websiteRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLElement>(null)
  const dataRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void getJson<WebBookingInfo>(url('/web/booking', code)).then(({ data }) => setInfo(data ?? 'error'))
  }, [code])

  const ready = info !== null && info !== 'error' ? info : null
  // Врач один — сразу он; у врача одна услуга — сразу она
  const doctorId = pickedDoctor ?? (ready?.doctors.length === 1 ? ready.doctors[0]!.id : null)
  const services = ready && doctorId != null ? servicesOfDoctor(ready.services, ready.doctorServices ?? undefined, doctorId) : []
  const service = pickedService ?? (services.length === 1 ? services[0]! : null)
  const length = stripLength(ready?.daysAhead)
  const key = service ? `${doctorId}|${service.id}|${dateTouched ? date : 'first'}|${reload}` : ''
  const slots = !service ? null : found?.key === key ? found.value : 'loading'

  // Свободное время: пока день не выбран сам — первый день со свободным временем (как в Telegram)
  useEffect(() => {
    if (!key || doctorId == null || !service) return
    let cancelled = false
    const load = async (d: string) => {
      const { data } = await getJson<Slots>(url('/web/booking/slots', code, { date: d, doctorId, serviceTypeId: service.id! }))
      if (!data) throw new Error('slots')
      return data
    }
    const days = bookingDays('ru', todayIn(), length).map((d) => d.date)
    const request = dateTouched ? load(date).then((s) => ({ date, slots: s, noneSoon: false })) : firstFree(days, load)
    request.then((value) => { if (!cancelled) setFound({ key, value }) }, () => { if (!cancelled) setFound({ key, value: 'error' }) })
    return () => { cancelled = true }
    // key собран из врача, услуги, дня и reload — по нему и перезапрос
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, code, length])

  if (info === null) return <Loading className="site-message" text={t('loading')} />
  if (info === 'error') return <p className="site-message">{t('noConnection')}</p>

  const back = <button type="button" className="link web-book-back" onClick={onClose}>{t('webClose')}</button>
  if (!info.available) {
    return (
      <section className="web-book" aria-label={t('webTitle')}>
        {back}
        <p role="status">{info.unavailable === 'setting-up' ? t('settingUp') : t('webOff')} {callText(t, info.phones)}</p>
        <div className="site-actions"><ContactLinks className={null} phones={info.phones} whatsapp={info.whatsapp} waText={t('webWaAsk')}
          texts={{ call: t('call'), whatsapp: t('writeWhatsapp') }} /></div>
      </section>
    )
  }

  if (booked) {
    return (
      <section className="web-book" aria-label={t('webSentTitle')}>
        <h2>✅ {t('webSentTitle')}</h2>
        <p role="status">{t('webSentText')}</p>
        <dl className="web-book-summary">
          <dt>{t('webWhen')}</dt><dd>{whenAt(lang, booked.startAt)}</dd>
          <dt>{t('doctor')}</dt><dd>{booked.doctorName}</dd>
          <dt>{t('service')}</dt><dd>{booked.serviceName}</dd>
          {booked.address && <><dt>{t('webAddress')}</dt><dd>{booked.address}{booked.mapUrl && <> · <a href={booked.mapUrl} target="_blank" rel="noopener noreferrer">2ГИС</a></>}</dd></>}
        </dl>
        {booked.whatsapp && <p className="hint">{t('webWaSendHint')}</p>}
        <div className="site-actions"><ContactLinks className={null} phones={booked.phones} whatsapp={booked.whatsapp}
          waText={t('webWaText', { when: whenAt(lang, booked.startAt), doctor: booked.doctorName, service: booked.serviceName })}
          texts={{ call: t('call'), whatsapp: t('webWaSend') }} /></div>
        {booked.telegramUrl && <p className="hint">{t('webTgHint')} <a href={booked.telegramUrl} target="_blank" rel="noopener noreferrer">{t('webTgLink')}</a></p>}
        {back}
      </section>
    )
  }

  const shownDate = dateTouched ? date : slots && typeof slots === 'object' ? slots.date : date
  const holder = info.legalName || t('holderDefault')

  const fail = (status: number, problem: SiteProblem | null) => {
    if (status === 0 || !problem) {
      setErrors({ form: t('noConnection') })
      return
    }
    if (problem.code === 'time-taken') {
      setErrors({ time: t('taken') })
      setChosen('')
      setReload((n) => n + 1)
      timeRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      return
    }
    if (problem.code === 'phone-booked') {
      setErrors({ form: `${t('webPhoneBooked')}${info.phones?.length ? `: ${info.phones.map((p) => `+${p}`).join(', ')}` : ''}.` })
      return
    }
    if (problem.code === 'too-many') {
      setErrors({ form: `${t('webTooMany')} ${callText(t, info.phones)}` })
      return
    }
    // Ошибки полей — по-русски от сервера; на кыргызском — своими словами
    const fields = Object.fromEntries((problem.errors ?? []).map((e) => [e.field, e.message]))
    const own = (key: string, fallback: string) => (fields[key] ? (lang === 'ru' ? fields[key] : t(fallback)) : '')
    const next = { name: own('fullName', 'nameRequired'), phone: own('phone', 'webPhoneRequired'), consent: own('consent', 'consentRequired'),
      comment: fields.comment ?? '' }
    setErrors(Object.values(next).some(Boolean) ? next : { form: problem.detail || t('noConnection') })
  }

  const submit = async () => {
    const name = nameRef.current?.value.trim() ?? ''
    if (!service) return setErrors({ form: t('pickService') })
    if (!chosen) {
      timeRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      return setErrors({ time: t('pickTime') })
    }
    if (!name) return setErrors({ name: t('nameRequired') })
    if (!phone.trim()) return setErrors({ phone: t('webPhoneRequired') })
    if (!consent) return setErrors({ consent: t('consentRequired') })
    setErrors({})
    setSending(true)
    const { status, data, problem } = await postJson<WebBooked>(url('/web/booking', code), {
      doctorId, serviceTypeId: service.id, startAt: slotInstant(shownDate, minutesOf(chosen)), fullName: name,
      phone: phoneFromInput(phone), comment: commentRef.current?.value ?? '', consent: true, sourceId, website: websiteRef.current?.value ?? '',
    })
    setSending(false)
    if (data) {
      setBooked(data)
      window.scrollTo?.({ top: 0 })
    } else fail(status, problem)
  }

  const doctor = info.doctors.find((d) => d.id === doctorId)
  const groups = groupByCategory(services)
  const serviceButton = (s: Service) => (
    <button key={s.id} type="button" className="btn service" aria-pressed={service?.id === s.id}
      onClick={() => { setService(s); setChosen(''); setDateTouched(false); setErrors({}) }}>
      {/* Одна строка: значок, название с длительностью, цена справа — список короче, чем карточки */}
      <span className="svc-emoji" aria-hidden="true">{serviceEmoji(s.name)}</span>
      <span className="svc-main"><span className="svc-name">{s.name}</span>
        <span className="sr-only"> · {s.durationMinutes} {t('min')}</span>
        <span className="dur" aria-hidden="true">⏱ {s.durationMinutes} {t('min')}</span></span>
      {priceText(lang, s.priceSom) && <span className="price">{priceText(lang, s.priceSom)}</span>}
    </button>
  )
  const err = (k: string) => errors[k] && <p className="error" role="alert">{errors[k]}</p>

  return (
    <form className="web-book" aria-label={t('webTitle')} noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {back}
      <div><h2>{t('webTitle')}</h2><p className="hint">{t('webSub')}</p>
        {info.whatsapp && <p className="hint">{t('webWaPrefer')} <a href={waLink(info.whatsapp, t('webWaAsk'))} target="_blank" rel="noopener noreferrer">{t('webWaPreferLink')}</a></p>}</div>
      {info.doctors.length > 1 && (
        <section className="step">
          <h3 className="step-title">{t('webStepDoctor')}</h3>
          <div className="web-book-doctors" role="group" aria-label={t('webStepDoctor')}>
            {info.doctors.map((d) => (
              <button key={d.id} type="button" className="btn web-book-doctor" aria-pressed={d.id === doctorId}
                onClick={() => { setDoctorId(d.id); setService(null); setChosen(''); setDateTouched(false); setErrors({}) }}>
                {d.photoUrl ? <img src={d.photoUrl} alt="" width={40} height={40} /> : <span className="initials" aria-hidden="true">{initials(d.fullName)}</span>}
                <span><strong>{d.fullName}</strong>{d.about && <span className="hint">{d.about}</span>}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {doctor && (
        <>
          <section className="step">
            <h3 className="step-title">{t('stepService')}</h3>
            <div className="field services">
              {!services.length ? <p className="hint">{t('webNoServices')}</p> : groups.length > 1
                ? groups.map(({ category, items }) => (
                  <div key={category ?? '—'} className="services-group"><h3>{category || t('otherServices')}</h3>{items.map(serviceButton)}</div>
                ))
                : services.map(serviceButton)}
            </div>
          </section>
          <section ref={timeRef} className="step">
            <h3 className="step-title">{t('stepTime')}</h3>
            <div className="field"><span>{t('day')}</span>
              <DayStrip t={t} lang={lang} length={length} date={shownDate} onPick={(d) => { setDate(d); setDateTouched(true); setChosen(''); setErrors({}) }} />
            </div>
            <div className="field"><span>{t('time')}</span>
              {err('time')}
              {!service ? <p className="hint">{t('pickServiceFirst')}</p>
                : slots === 'loading' || slots === null ? <Loading text={t('loading')} />
                  : slots === 'error' ? <p className="error">{t('noConnection')}</p>
                    : slots.noneSoon ? <p className="hint">{t('noFreeSoon')} {callText(t, info.phones)}</p>
                      : <SlotGrid t={t} lang={lang} slots={slots.slots} chosen={chosen}
                        onPick={(time) => { setChosen(time); setErrors({}); dataRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }}
                        empty={slots.slots.dayOff ? t('otherDay') : slots.slots.workingDay ? t('noFree') : t('dayOff')} />}
              {service && dateTouched && slots && typeof slots === 'object' && !slots.slots.starts?.length && (
                <button type="button" className="btn" onClick={() => { setDateTouched(false); setErrors({}) }}>{t('nearestFree')}</button>
              )}
            </div>
          </section>
          <section ref={dataRef} className="step">
            <h3 className="step-title">{t('stepData')}</h3>
            <label className="field"><span>{t('patientName')}</span>
              <input ref={nameRef} name="fullName" maxLength={200} autoComplete="off" /></label>
            {err('name')}
            <label className="field"><span>{t('phone')}</span><PhoneInput label={t('phone')} value={phone} onChange={(v) => { setPhone(v); setErrors({}) }} />
              <span className="hint">{t('webPhoneHint')}</span></label>
            {err('phone')}
            {/* Необязательное — свёрнуто: запись короче, кто хочет — раскроет */}
            {commentOpen ? (
              <label className="field"><span>{t('comment')}</span>
                <textarea ref={commentRef} name="comment" rows={2} maxLength={500} autoFocus placeholder={t('commentHint')} /></label>
            ) : <button type="button" className="link" onClick={() => setCommentOpen(true)}>＋ {t('comment')}</button>}
            {err('comment')}
            {(info.sources ?? []).length > 0 && !sourceOpen && (
              <button type="button" className="link" onClick={() => setSourceOpen(true)}>＋ {t('sourceQuestion')}</button>
            )}
            {(info.sources ?? []).length > 0 && sourceOpen && (
              <div className="field">
                <span>{t('sourceQuestion')}</span>
                <div className="source-chips" role="group" aria-label={t('sourceQuestion')}>
                  {(info.sources ?? []).map((c) => (
                    <button key={c.id} type="button" className="source-chip" aria-pressed={sourceId === c.id}
                      onClick={() => setSourceId(sourceId === c.id ? null : c.id!)}>
                      <span aria-hidden="true">{c.emoji}</span> {(lang === 'ky' && c.titleKy) || c.title}
                    </button>
                  ))}
                </div>
                <span className="hint">{t('sourceOptional')}</span>
              </div>
            )}
            {/* Ловушка для ботов: человек это поле не видит */}
            <input ref={websiteRef} className="trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors({}) }} />
              {' '}{t('consent', { holder })}</label>
            <details className="web-book-privacy">
              <summary>{t('privacy')}</summary>
              <h4>{t('privacyWho')}</h4><p>{[holder, info.address].filter(Boolean).join(', ')}</p>
              <h4>{t('privacyWhat')}</h4><p>{t('webPrivacyText')}</p>
              <h4>{t('privacyWhy')}</h4><p>{t('privacyWhyText')}</p>
              <h4>{t('privacyWhere')}</h4><p>{t('privacyWhereText')}</p>
              <h4>{t('privacyRights')}</h4><p>{t('privacyRightsText')}</p>
            </details>
            {err('consent')}
          </section>
          {err('form')}
          <button type="submit" className="btn primary" disabled={sending}>{sending ? t('webSending') : t('webSubmit')}</button>
          {info.telegramUrl && <p className="hint">{t('webTgHint')} <a href={info.telegramUrl} target="_blank" rel="noopener noreferrer">{t('webTgLink')}</a></p>}
        </>
      )}
    </form>
  )
}
