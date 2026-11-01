import { addDays } from './time'

export type Range = { from: string; to: string }

/** Сколько дней в периоде, включая оба конца. */
function daysIn({ from, to }: Range): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * С чем честно сравнить период: день — с тем же днём недели неделей раньше (понедельник с
 * понедельником), неделя — с прошлой неделей, месяц — с теми же числами прошлого месяца (идёт
 * 10-е — сравниваем 1–10 с 1–10), любой другой период — с таким же числом дней перед ним.
 */
export function previousRange(kind: 'day' | 'week' | 'month' | 'custom', range: Range): Range & { label: string } {
  if (kind === 'day') return { from: addDays(range.from, -7), to: addDays(range.to, -7), label: 'к тому же дню прошлой недели' }
  if (kind === 'week') return { from: addDays(range.from, -7), to: addDays(range.to, -7), label: 'к прошлой неделе' }
  if (kind === 'month') {
    const [y, m] = range.from.split('-').map(Number) as [number, number]
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const last = new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5)), 0)).getUTCDate()
    const day = Math.min(Number(range.to.slice(8)), last)
    return { from: `${prev}-01`, to: `${prev}-${String(day).padStart(2, '0')}`, label: 'к тем же дням прошлого месяца' }
  }
  const n = daysIn(range)
  return { from: addDays(range.from, -n), to: addDays(range.from, -1), label: `к предыдущим ${n} дн.` }
}

/**
 * «▲ 12%» / «▼ 30%» / «как было» — насколько изменилось. Было 0 — процент не считаем
 * (из нуля любой рост — «бесконечность»), пишем просто «было 0».
 */
export function changeOf(now: number, was: number): { text: string; tone: 'ok' | 'bad' | 'hint' } {
  if (was === 0) return { text: now === 0 ? 'как было' : 'раньше было 0', tone: 'hint' }
  const pct = Math.round(((now - was) / Math.abs(was)) * 100)
  if (pct === 0) return { text: 'как было', tone: 'hint' }
  return pct > 0 ? { text: `▲ ${pct}%`, tone: 'ok' } : { text: `▼ ${Math.abs(pct)}%`, tone: 'bad' }
}

const DAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long' })
const dayText = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`)).replace('.', '')

/** Даты периода словами: «26 окт – 1 нояб»; один день — «1 нояб». */
export function datesText({ from, to }: Range): string {
  return from === to ? dayText(from) : `${dayText(from)} – ${dayText(to)}`
}

/**
 * Подпись под «День / Неделя / Месяц»: какие именно дни считаются — чтобы было видно, почему
 * неделя уже с деньгами, а месяц пуст (1-е число: месяц только начался).
 */
export function periodText(kind: 'day' | 'week' | 'month' | 'custom', range: Range, today: string): string {
  if (kind === 'day') return `${dayText(range.from)}, ${WEEKDAY.format(new Date(`${range.from}T00:00:00Z`))}${range.from === today ? ' — сегодня' : ''}`
  if (kind === 'week') {
    return range.from === range.to ? `${dayText(range.from)} — неделя только началась (понедельник)`
      : `${datesText(range)} — с понедельника${range.to === today ? ' по сегодня' : ''}`
  }
  if (kind === 'month') {
    return range.from === range.to ? `${dayText(range.from)} — месяц только начался, пока один день`
      : `${datesText(range)} — с 1-го числа${range.to === today ? ' по сегодня' : ''}`
  }
  return datesText(range)
}
