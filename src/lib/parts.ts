/** Часть целого. `color` — CSS-цвет (лучше переменная темы); без него — следующий слот `--series-N`. */
export type DonutPart = { key: string; name: string; value: number; color?: string; icon?: string; note?: string }

/** Сколько сегментов рисуем: больше — мелкие уходят в «Другое» (dataviz: больше 6 цветов не различить). */
const MAX_PARTS = 6
export const OTHER = '__other'

/**
 * Доли в процентах, в сумме ровно 100 (метод наибольших остатков): 33,3 + 33,3 + 33,3 → 34 + 33 + 33,
 * а не 33 + 33 + 33 = 99. Нули остаются нулями.
 */
export function percents(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0)
  if (!total) return values.map(() => 0)
  const exact = values.map((v) => (Math.max(0, v) / total) * 100)
  const shares = exact.map(Math.floor)
  const left = 100 - shares.reduce((a, b) => a + b, 0)
  exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => { shares[i]! += 1 })
  return shares
}

/**
 * Что рисуем: без нулей; если частей больше `max` — крупные по убыванию, остальные одной частью
 * «Другое (n)» серым. Цвет — по порядку частей во входе, а не по месту после сортировки: у
 * «Наличных» всегда один цвет, сколько бы ни было переводов. Частей во входе больше шести —
 * слотов на всех не хватит, тогда цвет — по месту среди крупных (иначе седьмая повторила бы первую).
 */
export function donutParts(parts: DonutPart[], max = MAX_PARTS): (DonutPart & { color: string })[] {
  const slot = (i: number) => `var(--series-${i + 1})`
  const shown = parts.map((p, i) => ({ ...p, color: p.color ?? slot(i) })).filter((p) => p.value > 0)
  if (parts.length <= max) return shown
  const sorted = [...shown].sort((a, b) => b.value - a.value)
    .map((p, i) => ({ ...p, color: parts.find((x) => x.key === p.key)?.color ?? slot(i) }))
  if (sorted.length <= max) return sorted
  const rest = sorted.slice(max - 1)
  return [...sorted.slice(0, max - 1), {
    key: OTHER, name: `Другое (${rest.length})`, value: rest.reduce((s, p) => s + p.value, 0), color: 'var(--chart-other)',
    note: rest.map((p) => p.name).join(', '),
  }]
}
