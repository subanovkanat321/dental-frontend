import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { patientsText } from '../patients/groupsModel'

/**
 * Плитка «Группы пациентов» в «Касса → Аналитика» (шаг 9А): за 90 дней — скольким написали и скольким звонили из
 * «Пациенты → Группы» и сколько из них записались в течение 30 дней. Только числа. Ничего не делали или нет прав —
 * плитки нет. Чьих пациентов считать, решает сервер (врач — своих).
 */
export function GroupsTile() {
  const data = useQuery({
    queryKey: ['patient-groups', 'results'],
    queryFn: () => unwrap(api.GET('/api/patient-groups/results', { params: { query: { days: 90 } } })),
    retry: false,
  })
  const r = data.data
  if (!r || r.messaged + r.called === 0) return null
  const reached = r.messaged + r.called
  const booked = r.messagedBooked + r.calledBooked
  return (
    <section className="card-block chart groups-tile" aria-label="Группы пациентов">
      <h2>Группы пациентов</h2>
      <p className="chart-headline"><b className="num">{booked}</b> из <span className="num">{patientsText(reached)}</span> записались</p>
      <p className="hint small">
        За 90 дней: сообщение — <span className="num">{r.messaged}</span>{r.messaged > 0 && <> (записались <span className="num">{r.messagedBooked}</span>)</>},
        {' '}задачи на обзвон — <span className="num">{r.called}</span>{r.called > 0 && <> (записались <span className="num">{r.calledBooked}</span>)</>}.
        {' '}Считаем запись в течение 30 дней. <a href="#/patients/comeback">Открыть «Позвать снова»</a>
      </p>
    </section>
  )
}
