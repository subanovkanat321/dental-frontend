import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { monthsText, plural } from '../lib/plural'
import { openLink } from '../lib/telegram'
import { shortDate } from '../lib/time'

type View = Schemas['ClinicReferralsView']

/** Ссылка-приглашение клиники: /join?ref=<код> на том же сайте (tish.kg). */
const inviteLink = (code: string) => `${window.location.origin}/join?ref=${code}`

/** Готовый текст для WhatsApp: что такое Tish и что даёт ссылка. */
function inviteText(v: View): string {
  return `Здравствуйте! Мы ведём запись пациентов в Tish: пациенты записываются в Telegram, бот напоминает о приёме, `
    + `карта зубов, касса и склад. По нашей ссылке — ${monthsText(v.invitedPilotMonths)} бесплатно: ${inviteLink(v.code)}`
}

const bonusText = (months: number) => (months === 12 ? 'год' : monthsText(months))

/**
 * «🎁 Пригласите коллег» («Клиника приводит клинику», V231 бэкенда) — руководителю в «Тарифе и оплате»: своя ссылка
 * (скопировать или отправить в WhatsApp с готовым текстом), правила и статистика своей клиники. Числа (пилот, месяцы,
 * «Амбассадор», потолок) — с сервера: владелец меняет их без кода. Нет доступа или ошибка — блока нет.
 */
export function InviteColleagues() {
  const q = useQuery({ queryKey: ['clinic-referral'], queryFn: () => unwrap(api.GET('/api/clinic/referral')), retry: false })
  const [note, setNote] = useState('')
  if (!q.data) return null
  const v = q.data
  const link = inviteLink(v.code)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setNote('Ссылка скопирована')
    } catch {
      setNote('Не получилось скопировать — выделите ссылку и скопируйте вручную')
    }
  }
  const progress = Math.min(v.paid, v.ambassadorClinics)
  return (
    <section className="card-block referral-block" aria-label="Пригласите коллег">
      <h2>🎁 Пригласите коллег</h2>
      <p>Клиника, которая зарегистрируется по вашей ссылке, пробует Tish <b>{monthsText(v.invitedPilotMonths)} бесплатно</b>.
        Когда она впервые оплатит тариф — вам <b>+{monthsText(v.rewardMonths)} Tish бесплатно</b>.</p>
      <p className="hint">{v.ambassadorClinics} {plural(v.ambassadorClinics, 'клиника', 'клиники', 'клиник')} по вашему приглашению
        оплатили — ещё {bonusText(v.ambassadorMonths)} бесплатно 🏆 Всего за приглашения — до {monthsText(v.maxMonths)}.</p>
      <input className="referral-link" readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()} />
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => void copy()}>Скопировать ссылку</button>
        <button type="button" className="btn" onClick={() => openLink(`https://wa.me/?text=${encodeURIComponent(inviteText(v))}`)}>Отправить в WhatsApp</button>
      </div>
      {note && <p className="tone-ok" role="status">{note}</p>}
      <p aria-label="Статистика приглашений"><strong>Вы пригласили: {v.invited} {plural(v.invited, 'клинику', 'клиники', 'клиник')},
        подключились: {v.paid}, получено месяцев: {v.months}</strong></p>
      {v.ambassador
        ? <p className="tone-ok">🏆 Бонус «Амбассадор» получен — {bonusText(v.ambassadorMonths)} Tish бесплатно</p>
        : (
          <div className="referral-progress">
            <progress max={v.ambassadorClinics} value={progress} aria-label="До бонуса «Амбассадор»" />
            <span className="hint">{progress} из {v.ambassadorClinics} до {v.ambassadorMonths === 12 ? 'года' : monthsText(v.ambassadorMonths)} бесплатно</span>
          </div>
        )}
      {v.waitingMonths > 0 && <p className="hint">{monthsText(v.waitingMonths)} добавятся к сроку, когда начнёте оплачивать Tish.</p>}
      {v.referredBy && (
        <p className="hint">Вы пришли по приглашению клиники «{v.referredBy}»
          {v.pilotUntil ? <> — пилот бесплатно до {shortDate(`${v.pilotUntil}T12:00:00Z`)}</> : null}.</p>
      )}
    </section>
  )
}
