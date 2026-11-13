import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { seesOwnEarnings } from '../lib/roles'
import { somText } from '../lib/time'
import { materialsWord, monthName, positions, signedSom } from './earnings'

type Me = Schemas['BookingViewsMe']

/**
 * «Чистыми за месяц» в «Мой заработок» — только у частного врача (аренда кресла или «врачи работают
 * независимо»): выручка за приёмы − аренда − материалы по списанию − потери − мои расходы по статьям −
 * доля общих расходов. Врачу за клинику сервер отдаёт row: null — блока нет, маржа клиники не его деньги.
 * Считает сервер (GET /api/me/net-month); «Мои закупки» — справочно.
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
  const expenses = q.data?.expenses ?? []
  const purchased = q.data?.purchasedSom ?? 0
  return (
    <section className="card-block net-month" aria-label="Чистыми за месяц">
      <h2>Чистыми за {monthName(q.data?.month)}</h2>
      <dl className="net-lines">
        <div><dt>Выручка за приёмы месяца</dt><dd className="num">{somText(revenue)}</dd></div>
        {earned !== revenue && <div><dt>Клинике по условиям (процент)</dt><dd className="num">{signedSom(earned - revenue)}</dd></div>}
        {r.rentSom > 0 && <div><dt>Аренда кресла</dt><dd className="num">−{somText(r.rentSom)}</dd></div>}
        <div><dt>Материалы по списанию ≈{unpriced > 0 && <span className="hint small tone-wait"> · без цены: {unpriced} {positions(unpriced)}</span>}</dt>
          <dd className="num">−{somText(r.materialsSom)}</dd></div>
        {r.lossesSom > 0 && <div><dt>Потери и пересчёт ≈</dt><dd className="num">−{somText(r.lossesSom)}</dd></div>}
        <div><dt>Мои расходы</dt><dd className="num">−{somText(r.expensesSom)}</dd></div>
        {expenses.map((x) => (
          <div key={x.category} className="net-sub"><dt>{x.category}</dt><dd className="num hint">−{somText(x.amountSom)}</dd></div>
        ))}
        {r.sharedExpensesSom > 0 && <div><dt>Доля общих расходов</dt><dd className="num">−{somText(r.sharedExpensesSom)}</dd></div>}
        <div className="net-total"><dt>Чистыми</dt>
          <dd className={`num strong${net < 0 ? ' tone-bad' : ''}`} aria-label="Чистыми">{signedSom(net)}</dd></div>
      </dl>
      <p className="hint small">
        С 1-го числа по сегодня. Выручка — оплаты за ваши приёмы этого месяца. Материалы — списанное на ваших приёмах по средней
        цене покупки (оценка); мои расходы — ваши записи в «Расходах»; доля общих расходов — аренда кабинета и другие общие
        расходы клиники, разделённые между врачами (список — «Касса» → «Расходы»).
        {unpriced > 0 && ` У ${materialsWord(unpriced)} нет цены — их здесь нет: укажите сумму поставки на «Складе».`}
        {purchased > 0 && ` Закуплено на ваш склад за месяц: ${somText(purchased)} — справочно, в «Чистыми» материалы по списанию.`}
      </p>
    </section>
  )
}
