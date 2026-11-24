import './referral.css'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import type { T } from '../patient/i18n'
import { openLink, telegram } from '../lib/telegram'

/**
 * Карточка «🎁 Приведи друга» в Mini App пациента (2026-11-24): условия, «Поделиться с другом» (Telegram сам предложит чат) и
 * «Скопировать ссылку»; сколько друзей пришло и сколько бонусов ждёт. Программа выключена — карточки нет; карточки пациента
 * ещё нет (не записывался) — «ссылка появится после первой записи». Ссылка — не в localStorage: только на экране.
 */
export function FriendCard({ t }: { t: T }) {
  const data = useQuery({ queryKey: ['patient-referral'], queryFn: () => unwrap(api.GET('/api/patient/referral')), retry: false, staleTime: 5 * 60_000 })
  const [copied, setCopied] = useState(false)
  const r = data.data
  if (!r?.enabled) return null
  const url = r.siteUrl ?? r.telegramUrl
  const share = () => {
    if (!url) return
    const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent((r.shareText ?? '').replace(url, '').replace(/:\s*$/, '').trim())}`
    const app = telegram()
    if (app?.openTelegramLink) app.openTelegramLink(link)
    else openLink(link)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.shareText ?? url ?? '')
      setCopied(true)
    }
    catch {
      setCopied(false)
    }
  }
  return (
    <section className="friend-card" aria-label={t('friendTitle')}>
      <h2>{t('friendTitle')}</h2>
      <p>{t('friendText', { friend: r.friendBonus ?? '', inviter: r.inviterBonus ?? '', days: r.validDays })}</p>
      {r.code && url ? (
        <>
          <div className="friend-actions">
            <button type="button" className="btn primary" onClick={share}>{t('friendShare')}</button>
            <button type="button" className="btn" onClick={() => void copy()}>{copied ? t('friendCopied') : t('friendCopy')}</button>
          </div>
          {r.invited > 0 && <p className="hint">{t('friendStats', { invited: r.invited, came: r.came })}</p>}
          {r.rewardsUntil.length > 0 && <p className="tone-ok">{t('friendRewards', { n: r.rewardsUntil.length })}</p>}
          <p className="hint small">{t('friendPrivacy')}</p>
        </>
      ) : <p className="hint">{t('friendAfterBooking')}</p>}
    </section>
  )
}
