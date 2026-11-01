import { useEffect, useState, type FormEvent } from 'react'

import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { getJson, type Tariffs } from './web'

const FEATURES: [string, string, string][] = [
  ['📲', 'Запись в Telegram', 'Пациент выбирает врача, услугу и время сам — врач подтверждает одним нажатием.'],
  ['⏰', 'Напоминания', 'Бот напоминает накануне и за два часа: меньше неявок.'],
  ['🦷', 'Карта зубов и план лечения', 'У каждого пациента — зубы, заметки к визитам и план с ценами.'],
  ['💰', 'Касса и отчёты', 'Выручка по врачам и способам оплаты, отчёт в Excel.'],
  ['📦', 'Склад', 'Остатки материалов и сигнал «заканчивается».'],
  ['👩‍⚕️', 'Вся команда', 'Врачи, регистратура и администратор — у каждого свои права.'],
]

const som = (n = 0) => `${new Intl.NumberFormat('ru-RU').format(n)} сом`

/**
 * Страница для клиник (/join): что умеет приложение, тарифы и форма заявки. Заявку разбирает
 * владелец платформы в «Платформа → Клиники». Поле-ловушка website — от ботов: человек его не видит.
 */
export function Join() {
  const [tariffs, setTariffs] = useState<Tariffs | null>(null)
  const [solo, setSolo] = useState(false)
  const [f, setF] = useState({ clinicName: '', contactName: '', phone: '', city: '', doctors: '', message: '', website: '' })
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  useEffect(() => {
    document.title = 'Tish — запись пациентов для стоматологии'
    void getJson<Tariffs>('/web/tariffs').then(({ data }) => {
      setTariffs(data)
      // Пришли по ссылке /join#form (со страницы /go) — к форме, когда страница дорисовалась
      if (window.location.hash) setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView(), 0)
    })
  }, [])
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    setSending(true)
    try {
      const response = await fetch('/web/clinic-applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, phone: phoneFromInput(f.phone), doctors: f.doctors ? Number(f.doctors) : null, consent, solo }),
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
        <div className="site-message"><h1>Заявка отправлена</h1><p>Мы свяжемся с вами в ближайшее время, чтобы подключить клинику.</p></div>
      </main>
    )
  }
  const err = (k: string) => errors[k] && <p className="error">{errors[k]}</p>
  return (
    <main className="site-page">
      <div className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={126} height={120} />
        <div><p className="strong">Tish</p><h1>Запись пациентов для стоматологии</h1>
          <p>Пациенты записываются в Telegram, бот напоминает о приёме, всё расписание — в телефоне.</p></div>
      </div>
      {tariffs?.promo && (
        <div className="site-promo">
          <p className="strong">🎁 Бесплатно</p>
          <h2>{tariffs.promo.title}</h2>
          <p>{tariffs.promo.text}</p>
          <ul>{(tariffs.promo.points ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
          <a className="btn primary" href="#form">Подключить бесплатно</a>
        </div>
      )}
      <h2>Что умеет</h2>
      <ul className="site-features">
        {FEATURES.map(([icon, title, text]) => <li key={title}><span className="ico" aria-hidden="true">{icon}</span><span><strong>{title}</strong><span>{text}</span></span></li>)}
      </ul>
      {tariffs && (
        <>
          <h2 id="tariffs">Тарифы</h2>
          <div className="tariffs">
            {(tariffs.tariffs ?? []).map((x) => (
              <div key={x.code} className="tariff">
                <strong>{x.name}</strong><span className="hint">{x.who}</span>
                <span className="tariff-price num">{som(x.monthSom)}<span className="hint"> / месяц</span></span>
                <span className="hint">за год — {som(x.yearSom)} (2 месяца в подарок)</span>
              </div>
            ))}
          </div>
          <p className="hint">Во всех тарифах — всё приложение. Платить — только после {tariffs.pilotMonths} бесплатных месяцев, если решите остаться.</p>
        </>
      )}
      <h2 id="form">Подключить клинику</h2>
      {tariffs?.promo && <p className="tone-ok">🎁 {tariffs.promo.title}. Без предоплаты — оставьте заявку, мы позвоним.</p>}
      <form className="form site-card" aria-label="Заявка клиники" onSubmit={(e) => void submit(e)}>
        <div className="segments" role="group" aria-label="Кто вы">
          <button type="button" aria-pressed={!solo} onClick={() => setSolo(false)}>Клиника</button>
          <button type="button" aria-pressed={solo} onClick={() => setSolo(true)}>Частный врач</button>
        </div>
        <p className="hint">{solo
          ? 'Частный врач работает один (например, арендует кабинет): он и ведёт приём, и управляет записью.'
          : 'Клиника — несколько врачей, у каждого своё расписание; регистратура и администратор — по желанию.'}</p>
        <label className="field"><span>{solo ? 'Кабинет (как вас найдут пациенты)' : 'Клиника'}</span>
          <input value={f.clinicName} maxLength={100} autoComplete="organization" placeholder={solo ? 'Стоматолог Айгерим Садыкова' : 'Стоматология «Улыбка»'} onChange={(e) => set('clinicName')(e.target.value)} /></label>
        {err('clinicName')}
        <label className="field"><span>Как к вам обращаться</span>
          <input value={f.contactName} maxLength={100} autoComplete="name" placeholder="Айгерим" onChange={(e) => set('contactName')(e.target.value)} /></label>
        {err('contactName')}
        <label className="field"><span>Телефон или WhatsApp</span><PhoneInput label="Телефон или WhatsApp" value={f.phone} onChange={set('phone')} /></label>
        {err('phone')}
        <label className="field"><span>Город</span><input value={f.city} maxLength={60} placeholder="Бишкек" onChange={(e) => set('city')(e.target.value)} /></label>
        {err('city')}
        {!solo && <label className="field"><span>Сколько врачей</span><input type="number" min={1} max={100} inputMode="numeric" placeholder="2" value={f.doctors} onChange={(e) => set('doctors')(e.target.value)} /></label>}
        {err('doctors')}
        <label className="field"><span>Комментарий</span><textarea maxLength={1000} rows={3} placeholder="Что важно для вашей клиники" value={f.message} onChange={(e) => set('message')(e.target.value)} /></label>
        {err('message')}
        <input className="trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => set('website')(e.target.value)} />
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Согласен(на), чтобы мои имя и телефон использовали, чтобы связаться со мной по заявке</label>
        {err('consent')}
        {errors.form && <p className="error" role="alert">{errors.form}</p>}
        <button type="submit" className="btn primary" disabled={sending}>Оставить заявку</button>
      </form>
      <footer className="site-footer">© {new Date().getFullYear()}</footer>
    </main>
  )
}
