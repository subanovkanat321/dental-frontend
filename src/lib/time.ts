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

/** Минуты от полуночи по Бишкеку: для места приёма в сетке дня. */
export function minutesOf(instant: string): number {
  const [h, m] = timeOf(instant).split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
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

/** 12500 → «12 500 сом». */
export function somText(som: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(som)} сом`
}

/** 996555123456 → +996 555 123 456. */
export function formatPhone(digits: string): string {
  const kg = /^996(\d{3})(\d{3})(\d{3})$/.exec(digits)
  return kg ? `+996 ${kg[1]} ${kg[2]} ${kg[3]}` : `+${digits}`
}

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
