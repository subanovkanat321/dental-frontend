import './referral.css'
import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { somText } from '../lib/time'

/**
 * Плитка «Приведи друга» в «Касса → Аналитика» (2026-11-24): за период — сколько пришли по приглашению, сколько дошли до
 * приёма, выручка от приглашённых, бонусы начислены и использованы, лучшие пригласившие. Деньги клиники — только тому, кто
 * видит всех врачей (сервер: 403 остальным — плитки нет). Программа выключена и приглашённых нет — плитки нет.
 */
export function ReferralTile({ from, to }: { from: string; to: string }) {
  const data = useQuery({
    queryKey: ['referral-report', from, to],
    queryFn: () => unwrap(api.GET('/api/reports/referrals', { params: { query: { from, to } } })),
    retry: false,
  })
  const r = data.data
  if (!r || (!r.enabled && r.invited === 0 && r.rewardsUsed === 0)) return null
  return (
    <section className="card-block chart referral-tile" aria-label="Приведи друга">
      <h2>🎁 Приведи друга</h2>
      {r.invited === 0 ? (
        <p className="hint">За период по приглашению никто не записался. Ссылку пациенту — «⋯ → Ссылка «Приведи друга»» в его карточке.</p>
      ) : (
        <>
          <p className="chart-headline"><b className="num">{r.invited}</b> по приглашению · пришли <b className="num">{r.came}</b>
            {r.revenueSom > 0 && <> · выручка <b className="num">{somText(r.revenueSom)}</b></>}</p>
          {r.top.length > 0 && (
            <>
              <p className="hint small">Лучшие пригласившие:</p>
              <ol className="referral-top">
                {r.top.map((t) => <li key={t.patientId}><span>{t.fullName}</span><span className="num hint">{t.invited} · пришли {t.came}</span></li>)}
              </ol>
            </>
          )}
        </>
      )}
      <p className="hint small">Бонусов пригласившим: начислено <span className="num">{r.rewardsGiven}</span>, использовано{' '}
        <span className="num">{r.rewardsUsed}</span>. Выручка — оплаты за приёмы периода всех приглашённых.</p>
    </section>
  )
}
