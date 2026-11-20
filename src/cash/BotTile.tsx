import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { coverageText } from '../schedule/botInvite'

/**
 * Плитка «Пациенты в боте: 42 % (120 из 285)» в «Касса → Аналитика» (2026-11-20): сколько действующих пациентов (были за
 * год или записаны) получают напоминания в бот бесплатно. Ссылка — в «Пациенты → Без бота», там «📲 Пригласить» у каждого.
 * Пациентов ещё нет — плитки нет.
 */
export function BotTile() {
  const data = useQuery({
    queryKey: ['no-bot', 'tile'],
    queryFn: () => unwrap(api.GET('/api/patients/bot-coverage')),
    retry: false,
  })
  const c = data.data
  if (!c || c.total === 0) return null
  return (
    <section className="card-block chart bot-tile" aria-label="Пациенты в боте">
      <h2>Пациенты в боте</h2>
      <p className="chart-headline"><b className="num">{c.percent} %</b> <span className="hint num">({c.inBot} из {c.total})</span></p>
      <div className="bot-tile-bar" role="img" aria-label={`В боте ${coverageText(c)}`}><span style={{ width: `${c.percent}%` }} /></div>
      <p className="hint small">Им напоминания уходят в Telegram — бесплатно, ответ «Приду» и перенос — без звонков.{' '}
        {c.inBot < c.total && <><a href="#/patients/nobot">Без бота: {c.total - c.inBot}</a> — пригласите по одному в WhatsApp.</>}</p>
    </section>
  )
}
