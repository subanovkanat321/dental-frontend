import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { plural } from '../lib/plural'
import { openLink } from '../lib/telegram'

type View = Schemas['ClinicReferralsView']

/** Ссылка-приглашение клиники: /join?ref=<код> на том же сайте (tish.kg). */
const inviteLink = (code: string) => `${window.location.origin}/join?ref=${code}`

/** Готовый текст для WhatsApp: что такое Tish и что он бесплатный. */
function inviteText(v: View): string {
  return `Здравствуйте! Мы ведём запись пациентов в Tish: пациенты записываются в Telegram, бот напоминает о приёме, `
    + `карта зубов, касса и склад. Tish бесплатный — подключиться можно по нашей ссылке: ${inviteLink(v.code)}`
}

/**
 * «🎁 Пригласите коллег» («Клиника приводит клинику», V231 бэкенда) — руководителю в «Пригласить коллег»: своя ссылка
 * (скопировать или отправить в WhatsApp с готовым текстом) и сколько клиник пришло. С 2026-11-25 Tish бесплатный — без
 * пилота, месяцев в подарок и «Амбассадора»: эти числа сервер ещё отдаёт, но клинике их не показываем. Нет доступа или
 * ошибка — блока нет.
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
  return (
    <section className="card-block referral-block" aria-label="Пригласите коллег">
      <h2>🎁 Пригласите коллег</h2>
      <p>Tish бесплатный и для других клиник. Отправьте коллегам ссылку — клиника по ней подключается сама за 5 минут.</p>
      <input className="referral-link" readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()} />
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => void copy()}>Скопировать ссылку</button>
        <button type="button" className="btn" onClick={() => openLink(`https://wa.me/?text=${encodeURIComponent(inviteText(v))}`)}>Отправить в WhatsApp</button>
      </div>
      {note && <p className="tone-ok" role="status">{note}</p>}
      {v.invited > 0 && (
        <p aria-label="Статистика приглашений"><strong>По вашей ссылке подключились: {v.invited} {plural(v.invited, 'клиника', 'клиники', 'клиник')}</strong></p>
      )}
      {v.referredBy && <p className="hint">Вы пришли по приглашению клиники «{v.referredBy}».</p>}
    </section>
  )
}
