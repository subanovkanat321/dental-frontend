import { useState } from 'react'

import { donutParts, OTHER, percents, type DonutPart } from './parts'

export type { DonutPart } from './parts'

const SIZE = 168
const WIDTH = 22
const R = (SIZE - WIDTH) / 2 - 3 // запас под утолщение выбранного сегмента
const LENGTH = 2 * Math.PI * R
const GAP = 2 // зазор цвета фона между сегментами (dataviz: 2px)

/**
 * «Бублик» — одно целое на 2–6 частей с одного взгляда: кольцо с главным числом в центре и
 * легенда рядом (на узком месте — под кольцом) с суммой и долей каждой части. Чистый SVG.
 *
 * - Наведение, фокус или нажатие на сегмент либо строку легенды подсвечивает пару, в центре — доля
 *   этой части. Строки легенды — кнопки: Tab по частям, Enter/пробел — закрепить (повторно — снять).
 *   С `onPick` нажатие выбирает часть снаружи (например, фильтр списка), выбранная — `picked`.
 * - Для экранного диктора кольцо — `role="img"` с долями словами; легенда — тот же текст списком.
 * - Цвета — переменные темы `--series-1…6` (проверены валидатором dataviz на светлом и тёмном фоне),
 *   «Другое» — серый `--chart-other`; текст — цветом текста, не цветом части.
 */
export function Donut({ parts, label, format = String, center, caption, empty = 'Нет данных за этот период.', picked, onPick }: {
  parts: DonutPart[]
  /** Что за целое: «Способы оплаты» — начало описания для диктора и подпись легенды. */
  label: string
  format?: (v: number) => string
  /** Главное число в центре (по умолчанию — сумма частей). */
  center?: string
  /** Маленькая подпись под ним. */
  caption?: string
  /** Текст, когда все части нулевые. */
  empty?: string
  picked?: string
  onPick?: (key: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const shown = donutParts(parts)
  const total = shown.reduce((s, p) => s + p.value, 0)
  if (!total) return <p className="hint donut-empty">{empty}</p>

  const shares = percents(shown.map((p) => p.value))
  const pressed = onPick ? picked ?? null : pinned
  const lit = hover ?? pressed
  const litIndex = shown.findIndex((p) => p.key === lit)
  const press = (key: string) => {
    if (onPick) { if (key !== OTHER) onPick(key) } else setPinned(pinned === key ? null : key)
  }
  const text = (p: DonutPart, k: number) => `${p.name} ${format(p.value)} (${shares[k]}%)`

  // Сегменты — дуги одной окружности через stroke-dasharray, от 12 часов по часовой
  const lens = shown.map((p) => (p.value / total) * LENGTH)
  const arcs = shown.map((p, k) => {
    const len = lens[k]!
    const gap = shown.length > 1 ? Math.min(GAP, len / 2) : 0
    return { p, k, dash: Math.max(len - gap, 0.5), start: lens.slice(0, k).reduce((a, b) => a + b, 0) }
  })

  return (
    <div className={lit == null ? 'donut' : 'donut lit'}>
      <div className="donut-ring">
        <svg role="img" aria-label={`${label}: ${shown.map(text).join(', ')}`} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map(({ p, k, dash, start }) => (
              <circle key={p.key} className={p.key === lit ? 'donut-seg on' : 'donut-seg'} data-key={p.key}
                cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={p.color} strokeWidth={WIDTH}
                strokeDasharray={`${dash} ${LENGTH - dash}`} strokeDashoffset={-start}
                onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)} onClick={() => press(p.key)}>
                <title>{text(p, k)}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="donut-center" aria-hidden="true">
          {litIndex >= 0 ? (
            <><b className="num">{shares[litIndex]}%</b><span>{shown[litIndex]!.name}</span></>
          ) : (
            <><b className={`num${(center ?? format(total)).length > 8 ? ' long' : ''}`}>{center ?? format(total)}</b>{caption && <span>{caption}</span>}</>
          )}
        </div>
      </div>
      <ul className="donut-legend" aria-label={label}>
        {shown.map((p, k) => (
          <li key={p.key}>
            <button type="button" className={p.key === lit ? 'donut-row on' : 'donut-row'} aria-pressed={pressed === p.key}
              title={p.note ? `${p.name}: ${p.note}` : undefined}
              onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.key)} onBlur={() => setHover(null)} onClick={() => press(p.key)}>
              <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
              <span className="donut-name">{p.icon && <span aria-hidden="true">{p.icon} </span>}{p.name}</span>
              <b className="num">{format(p.value)}</b>
              <span className="donut-share num">{shares[k]}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
