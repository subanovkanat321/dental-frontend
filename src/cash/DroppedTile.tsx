import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { patientsWord } from '../patients/dropped'
import { somText } from '../lib/time'

/**
 * Плитка «Бросили лечение» в «Аналитике»: сколько пациентов согласились с планом или начали лечение и пропали больше
 * 30 дней назад, и сколько у них не долечено. Только итоги (limit=0) — сами пациенты в «Пациенты → Бросили лечение».
 * Чьих пациентов считать, решает сервер (врач — своих, руководитель — всех). Никого или нет прав — плитки нет.
 */
export function DroppedTile() {
  const data = useQuery({
    queryKey: ['dropped', 'tile'],
    queryFn: () => unwrap(api.GET('/api/dropped', { params: { query: { days: 30, limit: 0 } } })),
    retry: false,
  })
  const r = data.data
  if (!r || r.total === 0) return null
  return (
    <section className="card-block chart dropped-tile" aria-label="Бросили лечение">
      <h2>Бросили лечение</h2>
      <p className="chart-headline"><b className="num">{r.total}</b> {patientsWord(r.total)}
        {r.leftSom > 0 && <span className="hint"> · не долечено на <span className="num">{somText(r.leftSom)}</span></span>}</p>
      <p className="hint small">Согласились с планом или начали лечение, не записаны и не были больше 30 дней.{' '}
        <a href="#/patients/comeback/dropped">Открыть список</a> — позвонить, написать в WhatsApp, записать.</p>
    </section>
  )
}
