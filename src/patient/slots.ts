/** Правила ленты дней и сетки времени — общие для записи в Telegram и на сайте. */

/** Сколько дней в ленте: столько, на сколько вперёд сервер даёт записаться (daysAhead и сегодня); нет — две недели. */
export function stripLength(daysAhead?: number | null): number {
  return daysAhead ? Math.min(daysAhead + 1, 62) : 14
}

/** «10:30» → 630 минут от полуночи. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

/** Часть дня по времени по Бишкеку («10:30»): до 12:00 — утро, до 17:00 — день, дальше — вечер. */
export function partOfDay(time: string): 'morning' | 'afternoon' | 'evening' {
  const h = Number(time.slice(0, 2))
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

/** Специальность — первая строка «Кратко о себе» (как в шапке колонки врача в CRM), остальное — подробнее. */
export function aboutParts(about?: string | null): { specialty: string; rest: string } {
  const lines = (about ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  return { specialty: lines[0] ?? '', rest: lines.slice(1).join(' ') }
}
