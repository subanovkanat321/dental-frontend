import { somText } from '../lib/time'
import { goalShare, monthName, number, todayOf, type Earnings } from './earnings'

/** Сегодня — заработок по проценту или (без процента) принятое от пациентов. */
function byPercent(e: Earnings): boolean {
  return Number(e.percent ?? 0) > 0
}

/** Тонкая полоса прогресса к цели — без цвета «тревоги»: это ориентир, а не план продаж. */
export function GoalBar({ e }: { e: Earnings }) {
  const share = goalShare(e)
  if (share == null) return null
  return (
    <span className="earn-bar" role="progressbar" aria-label="Путь к цели на месяц" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}>
      <span style={{ width: `${share * 100}%` }} />
    </span>
  )
}

/**
 * Блок «Мой заработок» в «Сводке дня» (компьютер ≥1280px): сегодня, за месяц и путь к цели. Нажать —
 * «Касса → Мой заработок». Компактно: сетку врачей не теснит.
 */
export function EarningsSummary({ e, onOpen }: { e: Earnings; onOpen?: () => void }) {
  const left = e.goalLeftSom
  return (
    <button type="button" className="ds-block ds-money" onClick={onOpen} aria-label="Мой заработок">
      <span className="ds-title">Мой заработок</span>
      <span className="ds-money-sum">{somText(todayOf(e))}</span>
      <span className="hint small">{byPercent(e) ? 'сегодня' : 'сегодня принято от ваших пациентов'}</span>
      <span className="earn-month">За {monthName(e.month)}: <b className="num">{somText(e.monthSom)}</b></span>
      <GoalBar e={e} />
      {left != null && <span className="hint small">{left > 0 ? `до цели ${somText(left)}` : 'цель месяца достигнута'}</span>}
    </button>
  )
}

/** Чип в полосе «Сегодня» (ноутбук поуже и телефон): «12 400 сом мой день». */
export function EarningsChip({ e, onOpen, compact }: { e: Earnings; onOpen?: () => void; compact?: boolean }) {
  return (
    <button type="button" className="stat s-quiet" onClick={onOpen}
      title={`Мой заработок: за ${monthName(e.month)} ${somText(e.monthSom)}`} aria-label={`Мой заработок сегодня: ${somText(todayOf(e))}`}>
      <b>{number(todayOf(e))}</b> {compact ? 'сом мой день' : `сом мой день · ${monthName(e.month)} ${number(e.monthSom)}`}
    </button>
  )
}
