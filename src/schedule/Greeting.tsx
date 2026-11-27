import { useEffect, useState } from 'react'

import { plural } from '../lib/plural'
import { timeOf, ZONE } from '../lib/time'

type Appt = { startAt: string; doctorId?: number; status?: string }

/** Часы по Бишкеку — для «Доброе утро / день / вечер», не по часам компьютера. */
function bishkekHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now))
}

/** «Доброе утро» с 5 до 12, «Добрый день» до 17, «Добрый вечер» до 23; ночью — без приветствия. */
function greetingWord(now: Date): string | null {
  const h = bishkekHour(now)
  if (h >= 5 && h < 12) return 'Доброе утро'
  if (h >= 12 && h < 17) return 'Добрый день'
  if (h >= 17 && h < 23) return 'Добрый вечер'
  return null
}

/** День (по Бишкеку), когда приветствие уже показали на этом устройстве: только дата, без личных данных. */
const SEEN = 'tish.greeting.day'
/** Сколько висит, потом плавно уходит, освобождая место. */
export const GREETING_MS = 8000

function bishkekDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(now)
}

/** Сегодня на этом устройстве уже здоровались? Только читаем (StrictMode зовёт инициализатор дважды), отмечаем — в эффекте. */
function seenToday(day: string): boolean {
  try {
    return localStorage.getItem(SEEN) === day
  } catch {
    return false
  }
}

function markSeen(day: string): void {
  try {
    localStorage.setItem(SEEN, day)
  } catch {
    // хранилище закрыто — в следующий раз покажем снова, ничего страшного
  }
}

/**
 * Приветствие над расписанием (владелец, 2026-11-27, по разбору ProClinic): «Доброе утро, Нурболот 👋 · сегодня
 * 6 записей, первая в 09:00». Только на сегодняшний день и днём; имя — первое слово из профиля. Врач — по своим
 * записям, остальные — по тем, что на экране. Тонкой строкой, чтобы не съедать место. Один раз в день (владелец
 * 2026-11-27: «показать когда зайдут и убрать»): GREETING_MS на экране, потом плавно сворачивается.
 */
export function Greeting({ name, doctorId, appointments, now = new Date() }: {
  name?: string | null
  doctorId?: number | null
  appointments: readonly Appt[]
  now?: Date
}) {
  const word = greetingWord(now)
  const day = bishkekDay(now)
  const [shown, setShown] = useState(() => word != null && !seenToday(day))
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!shown) return
    // Обновили страницу или вернулись в «Расписание» — уже без приветствия
    markSeen(day)
    const fade = window.setTimeout(() => setLeaving(true), GREETING_MS)
    const gone = window.setTimeout(() => setShown(false), GREETING_MS + 600)
    return () => { window.clearTimeout(fade); window.clearTimeout(gone) }
  }, [shown, day])
  const first = (name ?? '').trim().split(/\s+/)[0]
  if (!word || !shown) return null
  const mine = appointments.filter((a) => a.status !== 'CANCELLED' && (doctorId == null || a.doctorId === doctorId))
  const ahead = mine.filter((a) => Date.parse(a.startAt) >= now.getTime()).sort((a, b) => a.startAt.localeCompare(b.startAt))
  const summary = mine.length === 0 ? 'сегодня записей пока нет'
    : `сегодня ${mine.length} ${plural(mine.length, 'запись', 'записи', 'записей')}${ahead[0] ? `, ${ahead.length === mine.length ? 'первая' : 'следующая'} в ${timeOf(ahead[0].startAt)}` : ''}`
  return (
    <p className={leaving ? 'greeting leaving' : 'greeting'}>
      <strong>{word}{first ? `, ${first}` : ''}</strong> <span aria-hidden="true">👋</span>
      <span className="greeting-day"> · {summary}</span>
    </p>
  )
}
