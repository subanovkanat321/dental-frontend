import type { Schemas } from '../api/client'
import { somText } from '../lib/time'

type Money = Schemas['PatientCardMoney']

/**
 * Сводка сверху вкладки «Деньги» карточки пациента: «Начислено · Оплачено · Баланс». Все три числа считает сервер
 * (стоимость состоявшихся приёмов со скидками и старый долг; платежи, с аванса тоже; остаток аванса) и по правилам
 * видимости денег: врач — свои приёмы, ассистент — сводки нет. Баланс: меньше нуля — долг (красный), больше — аванс
 * (зелёный), ноль — «расчёт закрыт».
 */
export function MoneySummary({ money }: { money: Money }) {
  const b = money.balanceSom
  const tone = b < 0 ? 'bad' : b > 0 ? 'ok' : 'zero'
  return (
    <section className="money-summary" aria-label="Итог по деньгам">
      <dl>
        <div>
          <dt>Начислено</dt>
          <dd className="num">{somText(money.chargedSom)}</dd>
        </div>
        <div>
          <dt>Оплачено</dt>
          <dd className="num">{somText(money.paidSom)}</dd>
        </div>
        <div className={`money-balance tone-${tone}`}>
          <dt>Баланс</dt>
          {/* Слово — своей строкой: на телефоне «Долг 3 300 сом» в треть ширины не помещается */}
          {b !== 0 && <dd className="money-word">{b < 0 ? 'Долг' : 'Аванс'}</dd>}
          <dd className="num">{somText(Math.abs(b))}</dd>
          {b === 0 && <dd className="money-closed">расчёт закрыт</dd>}
        </div>
      </dl>
      {/* Аванс входит в баланс — подсказкой, откуда «зелёные» деньги, если начисленное ещё не оплачено */}
      {money.advanceSom > 0 && <p className="hint small">С учётом аванса {somText(money.advanceSom)}</p>}
    </section>
  )
}
