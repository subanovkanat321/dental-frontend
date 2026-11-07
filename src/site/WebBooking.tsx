import { useEffect, useRef, useState } from 'react'

import type { Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ContactLinks } from '../lib/ContactLinks'
import { translator, whenAt, type Lang, type T } from '../patient/i18n'
import { stripLength } from '../patient/slots'
import { BookingWizard, type ContactsArgs } from '../patient/Wizard'
import '../patient/patient.css'
import { getJson, postJson, type SiteProblem, type WebBooked, type WebBookingInfo } from './web'
import { Loading } from '../layout/Loading'

type Slots = Schemas['BookingViewsSlots']

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
 * тот же пошаговый мастер, что в Telegram (услуга → врач или «любой свободный» → дата → время), и
 * имя, телефон, согласие → «Записаться». Заявку клиника подтверждает звонком.
 */
export default function WebBooking({ code, lang, onClose }: { code: string | null; lang: Lang; onClose: () => void }) {
  const t = translator(lang)
  const [info, setInfo] = useState<WebBookingInfo | null | 'error'>(null)
  const [booked, setBooked] = useState<WebBooked | null>(null)

  useEffect(() => {
    void getJson<WebBookingInfo>(url('/web/booking', code)).then(({ data }) => setInfo(data ?? 'error'))
  }, [code])

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
        <div className="success-head">
          <span className="success-mark" aria-hidden="true">✓</span>
          <h2>{t('webSentTitle')}</h2>
          <p role="status">{t('webSentText')}</p>
        </div>
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

  const query = (doctorId: number | null, params: Record<string, string | number>) => (doctorId == null ? params : { ...params, doctorId })
  const loadSlots = async (date: string, doctorId: number | null, serviceTypeId: number) => {
    const { data } = await getJson<Slots>(url('/web/booking/slots', code, query(doctorId, { date, serviceTypeId })))
    if (!data) throw new Error('slots')
    return data
  }
  const loadFreeDays = async (doctorId: number | null, serviceTypeId: number) => {
    const { data } = await getJson<string[]>(url('/web/booking/free-days', code, query(doctorId, { serviceTypeId })))
    if (!data) throw new Error('free-days')
    return data
  }

  return (
    <div className="web-book" aria-label={t('webTitle')} role="region">
      {back}
      <BookingWizard t={t} lang={lang} services={info.services} doctors={info.doctors} doctorServices={info.doctorServices}
        length={stripLength(info.daysAhead)} loadFreeDays={loadFreeDays} loadSlots={loadSlots}
        noneSoon={`${t('noFreeSoon')} ${callText(t, info.phones)}`} errorText={() => t('noConnection')}
        intro={<div><h2>{t('webTitle')}</h2><p className="hint">{t('webSub')}</p>
          {info.whatsapp && <p className="hint">{t('webWaPrefer')} <a href={waLink(info.whatsapp, t('webWaAsk'))} target="_blank" rel="noopener noreferrer">{t('webWaPreferLink')}</a></p>}</div>}
        contacts={(args) => <WebContacts {...args} t={t} lang={lang} code={code} info={info} onBooked={(b) => {
          setBooked(b)
          window.scrollTo?.({ top: 0 })
        }} />} />
    </div>
  )
}

/**
 * Шаг «Контакты» на сайте: имя, телефон с маской (+996 по умолчанию), комментарий, «откуда узнали»,
 * согласие. Имя и комментарий — без React-состояния (читаются при отправке): во встроенном браузере
 * Instagram клавиатура закрывалась от перерисовок во время набора (как в форме /join).
 */
function WebContacts({ chosen, active, onTaken, t, lang, code, info, onBooked }: ContactsArgs & {
  t: T; lang: Lang; code: string | null; info: WebBookingInfo; onBooked: (b: WebBooked) => void
}) {
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [commentOpen, setCommentOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const websiteRef = useRef<HTMLInputElement>(null)
  const holder = info.legalName || t('holderDefault')

  const fail = (status: number, problem: SiteProblem | null) => {
    if (status === 0 || !problem) {
      setErrors({ form: t('noConnection') })
      return
    }
    if (problem.code === 'time-taken') {
      // Время успели занять (в том числе гонка в базе — 409): к шагу «Время» со свежей сеткой
      setErrors({})
      onTaken()
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
    if (!chosen) return
    const name = nameRef.current?.value.trim() ?? ''
    if (!name) return setErrors({ name: t('nameRequired') })
    if (!phone.trim()) return setErrors({ phone: t('webPhoneRequired') })
    if (!consent) return setErrors({ consent: t('consentRequired') })
    setErrors({})
    setSending(true)
    const { status, data, problem } = await postJson<WebBooked>(url('/web/booking', code), {
      ...(chosen.doctorId == null ? {} : { doctorId: chosen.doctorId }), serviceTypeId: chosen.service.id, startAt: chosen.startAt, fullName: name,
      phone: phoneFromInput(phone), comment: commentRef.current?.value ?? '', consent: true, sourceId, website: websiteRef.current?.value ?? '',
    })
    setSending(false)
    if (data) onBooked(data)
    else fail(status, problem)
  }
  const err = (k: string) => errors[k] && <p className="error" role="alert">{errors[k]}</p>

  return (
    <form className="contacts-step" aria-label={t('wizStepContacts')} noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="field"><span>{t('patientName')}</span>
        <input ref={nameRef} name="fullName" maxLength={200} autoComplete="off" /></label>
      {err('name')}
      <label className="field"><span>{t('phone')}</span><PhoneInput mask label={t('phone')} value={phone} onChange={(v) => { setPhone(v); setErrors({}) }} />
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
      {err('form')}
      {active && <button type="submit" className="btn primary book-submit" disabled={sending}>{sending ? t('webSending') : t('webSubmit')}</button>}
      {info.telegramUrl && <p className="hint">{t('webTgHint')} <a href={info.telegramUrl} target="_blank" rel="noopener noreferrer">{t('webTgLink')}</a></p>}
    </form>
  )
}
