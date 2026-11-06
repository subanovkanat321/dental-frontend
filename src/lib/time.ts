/** Время клиник — по Бишкеку (UTC+6, без перехода на летнее); в API — UTC ISO-8601. */
export const ZONE = 'Asia/Bishkek'

/** Сегодня по Бишкеку: 'YYYY-MM-DD'. */
export function todayIn(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(now)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** '2026-10-31T04:30:00Z' → '10:30' по Бишкеку. */
export function timeOf(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(instant))
}

/** День по Бишкеку: '2026-10-31T20:30:00Z' → '2026-11-01'. */
export function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/** Минуты от полуночи по Бишкеку: для места приёма в сетке дня. */
export function minutesOf(instant: string): number {
  const [h, m] = timeOf(instant).split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** «Сейчас» в минутах от полуночи по Бишкеку, вниз до 5 минут: поле времени с шагом 5 минут не примет 10:47. */
export function nowMinutes5(now = new Date()): number {
  return Math.floor(minutesOf(now.toISOString()) / 5) * 5
}

/** Шаг поля времени: 5 минут, а для времени не кратного 5 (окно после приёма в 10:47) — минута, иначе форма не отправится. */
export function timeStep(value: string): number {
  return Number(value.slice(3, 5)) % 5 ? 60 : 300
}

/** '09:00' или '09:00:00' → 540. */
export function minutesOfTime(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** «Пятница, 31 октября» — заголовок дня. */
export function dayTitle(date: string): string {
  const text = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${date}T00:00:00Z`))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Пустой день для пустого состояния: «На сегодня записей нет», «На завтра…», «На 12 ноября…»;
 * прошедший день — «Вчера записей не было», «3 ноября записей не было».
 */
export function emptyDayText(date: string, today = todayIn()): string {
  if (date === today) return 'На сегодня записей нет'
  if (date === addDays(today, 1)) return 'На завтра записей нет'
  if (date === addDays(today, -1)) return 'Вчера записей не было'
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`))
  return date < today ? `${dayMonth} записей не было` : `На ${dayMonth} записей нет`
}

/** 12500 → «12 500 сом». */
export function somText(som: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(som)} сом`
}

/** 996555123456 → +996 555 123 456, 77012345678 → +7 701 234 56 78 — правила стран в lib/phone.ts. */
export { formatPhone } from './phone'

/** '2026-10-31' + 630 минут по Бишкеку (UTC+6, без летнего времени) → ISO в UTC. */
export function slotInstant(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return new Date(`${date}T${hh}:${mm}:00+06:00`).toISOString()
}

/** '2026-10-31T04:30:00Z' → «31 окт 2026» (или «31 окт, 10:30» с временем) — по Бишкеку. */
export function shortDate(instant: string, withTime = false): string {
  const d = new Date(instant)
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, day: 'numeric', month: 'short', year: withTime ? undefined : 'numeric' })
    .format(d).replace(/\./g, '').replace(/ г$/, '')
  return withTime ? `${date}, ${timeOf(instant)}` : date
}

/** С понедельника этой недели или с 1-го числа месяца — до сегодня (по Бишкеку). */
export function periodOf(kind: 'day' | 'week' | 'month', today = todayIn()): { from: string; to: string } {
  if (kind === 'day') return { from: today, to: today }
  if (kind === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: weekStart(today), to: today }
}

/** Понедельник недели этого дня: '2026-11-05' (чт) → '2026-11-02'. */
export function weekStart(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 // пн = 0
  return addDays(date, -weekday)
}

/** 'YYYY-MM' → с 1-го по последнее число месяца. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** «1–7 июн» или «29 июн – 5 июл» — подпись недели. */
export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6)
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...opts })
    .format(new Date(`${d}T00:00:00Z`)).replace('.', '')
  return weekStart.slice(0, 7) === end.slice(0, 7)
    ? `${fmt(weekStart, { day: 'numeric' })}–${fmt(end, { day: 'numeric', month: 'short' })}`
    : `${fmt(weekStart, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`
}
