import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { shortDate } from '../lib/time'
import { visitToothText } from './toothStates'

/**
 * «История по визитам» под картой зубов: дата приёма · врач — какие зубы и что сделали («Зубы этого
 * приёма»). Карта показывает только текущее состояние, а здесь видно, когда и кто. Пусто — блока нет.
 */
export function TeethHistory({ patientId }: { patientId: number }) {
  const history = useQuery({
    queryKey: ['teeth-history', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth/history', { params: { path: { patientId } } })),
    retry: false,
  })
  if (!history.data?.length) return null
  return (
    <section className="card-block" aria-label="История по визитам">
      <h2>История по визитам</h2>
      <ul className="notes">
        {history.data.map((v) => (
          <li key={v.appointmentId}>
            <span className="hint">{v.startAt ? shortDate(v.startAt) : ''}{v.doctorName ? ` · ${v.doctorName}` : ''}</span>
            <p>{(v.teeth ?? []).map((t) => visitToothText(t)).join('; ')}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
