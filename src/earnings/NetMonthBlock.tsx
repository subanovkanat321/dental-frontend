import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { seesOwnEarnings } from '../lib/roles'
import { somText } from '../lib/time'
import { materialsWord, monthName, signedSom } from './earnings'

type Me = Schemas['BookingViewsMe']

/**
 * «Чистыми за месяц» в «Мой заработок» — только у частного врача (аренда кресла или «врачи работают
 * независимо»): выручка − аренда − материалы − техник и лаборатория. Врачу за клинику сервер отдаёт
 * row: null — блока нет, маржа клиники не его деньги. Считает сервер (GET /api/me/net-month).
 */
export function NetMonthBlock({ me }: { me: Me }) {
  const q = useQuery({
    queryKey: ['net-month', 'me'],
    queryFn: () => unwrap(api.GET('/api/me/net-month')),
    enabled: seesOwnEarnings(me),
    staleTime: 60_000,
  })
  const r = q.data?.row
  if (!r) return null
  const revenue = r.revenueSom
  const earned = r.earnedSom
  const net = r.doctorNetSom ?? 0
  const unpriced = r.unpricedMaterials
  return (
    <section className="card-block net-month" aria-label="Чистыми за месяц">
      <h2>Чистыми за {monthName(q.data?.month)}</h2>
      <dl className="net-lines">
        <div><dt>Выручка</dt><dd className="num">{somText(revenue)}</dd></div>
        {earned !== revenue && <div><dt>Клинике по условиям (процент)</dt><dd className="num">{signedSom(earned - revenue)}</dd></div>}
        {r.rentSom > 0 && <div><dt>Аренда кресла</dt><dd className="num">−{somText(r.rentSom)}</dd></div>}
        <div><dt>Материалы ≈</dt><dd className="num">−{somText(r.materialsSom)}</dd></div>
        <div><dt>Техник и лаборатория</dt><dd className="num">−{somText(r.expensesSom)}</dd></div>
        <div className="net-total"><dt>Чистыми</dt>
          <dd className={`num strong${net < 0 ? ' tone-bad' : ''}`} aria-label="Чистыми">{signedSom(net)}</dd></div>
      </dl>
      <p className="hint small">
        С 1-го числа по сегодня. Материалы — списанное на ваших приёмах по средней цене покупки (оценка); техник и
        лаборатория — ваши расходы в «Расходах».
        {unpriced > 0 && ` У ${materialsWord(unpriced)} нет цены — их здесь нет: укажите сумму поставки на «Складе».`}
      </p>
    </section>
  )
}
