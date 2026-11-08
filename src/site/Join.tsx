import { Select } from '../layout/Select'
import { CITIES } from '../lib/clinicSearch'
import { useEffect, useState, type FormEvent } from 'react'

import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { SiteHeader } from './SiteHeader'
import { getJson, inAppBrowser, type JoinCase, type Links, type Tariffs } from './web'

const FEATURES: [string, string, string][] = [
  ['📲', 'Запись в Telegram', 'Пациент выбирает врача, услугу и время сам — врач подтверждает одним нажатием.'],
  ['⏰', 'Напоминания', 'Бот напоминает накануне и за два часа: меньше неявок.'],
  ['🦷', 'Карта зубов и план лечения', 'У каждого пациента — зубы, заметки к визитам и план с ценами.'],
  ['💰', 'Касса и отчёты', 'Выручка по врачам и способам оплаты, отчёт в Excel.'],
  ['📦', 'Склад', 'Остатки материалов и сигнал «заканчивается».'],
  ['👩‍⚕️', 'Вся команда', 'Врачи, регистратура и руководитель — у каждого свои права.'],
]

/**
 * Страница для клиник (/join): что умеет приложение, «попробуйте бесплатно» (срок пилота и цены не показываем) и форма заявки. Заявку разбирает
 * владелец платформы в «Платформа → Клиники». Поле-ловушка website — от ботов: человек его не видит.
 */
export function Join() {
  const [tariffs, setTariffs] = useState<Tariffs | null>(null)
  const [solo, setSolo] = useState(false)
  // Поля — без React-состояния (значения читаются при отправке): на Android во встроенном браузере
  // Instagram клавиатура закрывалась после первой буквы. Меньше перерисовок во время набора — и без
  // автозаполнения (autoComplete=off): его подсказка в браузере Instagram и сбивает клавиатуру.
  const [phone, setPhone] = useState('')
  const [links, setLinks] = useState<Links>({})
  const [story, setStory] = useState<JoinCase | null>(null)
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  useEffect(() => {
    document.title = 'Tish — запись пациентов для стоматологии'
    if (inAppBrowser()) void getJson<Links>('/web/links').then(({ data }) => setLinks(data ?? {}))
    // Кейс владелец заполняет в «Платформа → Настройки»; не заполнен — блока нет
    void getJson<JoinCase>('/web/case').then(({ data }) => setStory(data?.shown ? data : null))
    void getJson<Tariffs>('/web/tariffs').then(({ data }) => {
      setTariffs(data)
      // Пришли по ссылке /join#form (со страницы /go) — к форме, когда страница дорисовалась
      if (window.location.hash) setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView(), 0)
    })
  }, [])
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const field = (k: string) => String(data.get(k) ?? '')
    setErrors({})
    setSending(true)
    try {
      const response = await fetch('/web/clinic-applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicName: field('clinicName'), contactName: field('contactName'), phone: phoneFromInput(phone), telegram: field('telegram').trim() || null,
          city: field('city'), doctors: !solo && field('doctors') ? Number(field('doctors')) : null, message: field('message'), website: field('website'), consent, solo,
        }),
      })
      if (response.ok) {
        setSent(true)
        return
      }
      const problem = await response.json().catch(() => null) as { detail?: string; errors?: { field: string; message: string }[] } | null
      const fields = Object.fromEntries((problem?.errors ?? []).map((x) => [x.field, x.message]))
      setErrors(Object.keys(fields).length ? fields : { form: problem?.detail || 'Не получилось отправить — попробуйте ещё раз.' })
    } catch {
      setErrors({ form: 'Нет связи — проверьте интернет и попробуйте ещё раз.' })
    } finally {
      setSending(false)
    }
  }
  if (sent) {
    return (
      <main className="site-page">
        <SiteHeader />
        <div className="site-message"><h1>Заявка отправлена</h1><p>Мы свяжемся с вами в ближайшее время, чтобы подключить клинику.</p></div>
      </main>
    )
  }
  const err = (k: string) => errors[k] && <p className="error">{errors[k]}</p>
  return (
    <main className="site-page">
      <SiteHeader />
      <div className="site-hero">
        {/* Тишка — как логотип: на главную приложения (расписание; без входа — вход) */}
        <a className="site-hero-home" href="/" aria-label="Открыть Tish — расписание" title="Открыть расписание"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} /></a>
        <div><h1>Запись пациентов для стоматологии</h1>
          <p>Пациенты записываются в Telegram, бот напоминает о приёме. Работать можно в Telegram и на сайте — с телефона и компьютера.</p></div>
      </div>
      {tariffs?.promo && (
        <div className="site-promo">
          <h2>🎁 {tariffs.promo.title}</h2>
          <p>{tariffs.promo.text}</p>
          <ul>{(tariffs.promo.points ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
          <a className="btn primary" href="#form">Подключить бесплатно</a>
        </div>
      )}
      <h2>Что умеет</h2>
      <ul className="site-features">
        {FEATURES.map(([icon, title, text]) => <li key={title}><span className="ico" aria-hidden="true">{icon}</span><span><strong>{title}</strong><span>{text}</span></span></li>)}
      </ul>
      {story && (
        <section className="site-case" aria-label="Как работает в клинике">
          <h2>Как работает в клинике</h2>
          <h3>{story.title}</h3>
          <p>{story.text}</p>
          {(story.metrics?.length ?? 0) > 0 && (
            <ul className="site-case-metrics">
              {story.metrics!.map((m) => <li key={`${m.value}${m.label}`}><b>{m.value}</b><span>{m.label}</span></li>)}
            </ul>
          )}
        </section>
      )}
      {/* Цены пока не показываем (владелец, 2026-11-02): клиника сначала пробует бесплатно, о цене — в разговоре */}
      <h2 id="tariffs">Сколько стоит</h2>
      <p>Попробовать — бесплатно: всё приложение, без ограничений и без предоплаты.
        Понравится — договоримся об условиях; нет — просто перестанете пользоваться.</p>
      <h2 id="form">Подключить клинику</h2>
      <p className="hint">Без предоплаты — оставьте заявку, мы позвоним.</p>
      {inAppBrowser() && (
        <p className="tone-wait">Открыли из Instagram? Если клавиатура закрывается — нажмите ⋮ вверху → «Открыть в браузере»
          {links.supportWhatsapp && <> или <a href={`https://wa.me/${links.supportWhatsapp}?text=${encodeURIComponent('Здравствуйте! Хотим подключить клинику к Tish.')}`}>напишите нам в WhatsApp</a></>}.</p>
      )}
      <form className="form site-card" aria-label="Заявка клиники" onSubmit={(e) => void submit(e)}>
        <div className="segments" role="group" aria-label="Кто вы">
          <button type="button" aria-pressed={!solo} onClick={() => setSolo(false)}>Клиника</button>
          <button type="button" aria-pressed={solo} onClick={() => setSolo(true)}>Частный врач</button>
        </div>
        <p className="hint">{solo
          ? 'Частный врач работает один (например, арендует кабинет): он и ведёт приём, и управляет записью.'
          : 'Клиника — несколько врачей, у каждого своё расписание; регистратура — по желанию.'}</p>
        <label className="field"><span>{solo ? 'Кабинет (как вас найдут пациенты)' : 'Клиника'}</span>
          <input name="clinicName" maxLength={100} autoComplete="off" placeholder={solo ? 'Стоматолог Айгерим Садыкова' : 'Стоматология «Улыбка»'} /></label>
        {err('clinicName')}
        <label className="field"><span>Как к вам обращаться</span>
          <input name="contactName" maxLength={100} autoComplete="off" placeholder="Айгерим" /></label>
        {err('contactName')}
        <label className="field"><span>Телефон или WhatsApp</span><PhoneInput label="Телефон или WhatsApp" value={phone} onChange={setPhone} /></label>
        {err('phone')}
        <label className="field"><span>Telegram — по желанию</span>
          <input name="telegram" maxLength={60} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@username" /></label>
        {err('telegram')}
        {/* Город — из справочника (тот же, что в «О клинике» и фильтре каталога): без «г. Бишкек» и «бишкек» */}
        <label className="field"><span>Город</span>
          <Select name="city" defaultValue="">
            <option value="">Выберите город</option>
            {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="Другой">Другой город — напишите в комментарии</option>
          </Select></label>
        {err('city')}
        {!solo && <label className="field"><span>Сколько врачей</span><input name="doctors" type="number" min={1} max={100} inputMode="numeric" placeholder="2" /></label>}
        {err('doctors')}
        <label className="field"><span>Комментарий</span><textarea name="message" maxLength={1000} rows={3} placeholder="Что важно для вашей клиники" /></label>
        {err('message')}
        <input className="trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Согласен(на), чтобы мои имя и телефон использовали, чтобы связаться со мной по заявке</label>
        {err('consent')}
        {errors.form && <p className="error" role="alert">{errors.form}</p>}
        <button type="submit" className="btn primary" disabled={sending}>Оставить заявку</button>
      </form>
      <footer className="site-footer"><a href="/about">Для клиник: всё о Tish</a> · <a href="/login">Вход для клиники</a> · © {new Date().getFullYear()} Tish</footer>
    </main>
  )
}
